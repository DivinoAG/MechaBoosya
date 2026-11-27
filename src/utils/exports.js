'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RANKING_KEEP_DAYS = Number(process.env.RANKING_KEEP_DAYS || 30);
const SNAPSHOT_KEEP_DAYS = Number(process.env.SNAPSHOT_KEEP_DAYS || 7);

function exportDir() {
    return process.env.EXPORT_DIR || path.resolve(process.cwd(), 'exports');
}

function stamp(date) {
    return date.toISOString().replace(/:/g, '-');
}

function rankingPath(channelId, date = new Date()) {
    return path.join(exportDir(), `ranking-${channelId}-${stamp(date)}.json`);
}

// Atomic: a reader never sees a half-written file (tmp + rename on the same filesystem).
function writeRankingExport(channelId, threads, meta = {}) {
    const dir = exportDir();
    fs.mkdirSync(dir, { recursive: true });

    const file = rankingPath(channelId);
    const tmp = `${file}.tmp`;
    const payload = {
        channelId,
        generatedAt: new Date().toISOString(),
        count: threads.length,
        ...meta,
        threads,
    };

    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, file);
    return file;
}

function pruneExports({ now = Date.now(), dir = exportDir() } = {}) {
    const removed = [];
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return removed;
    }

    const rules = [
        { pattern: /^ranking-.*\.json$/, maxAgeDays: RANKING_KEEP_DAYS },
        { pattern: /^db-.*\.sqlite$/, maxAgeDays: SNAPSHOT_KEEP_DAYS },
    ];

    for (const name of entries) {
        const rule = rules.find(r => r.pattern.test(name));
        if (!rule) continue;
        const full = path.join(dir, name);
        const ageDays = (now - fs.statSync(full).mtimeMs) / 86_400_000;
        if (ageDays > rule.maxAgeDays) {
            fs.unlinkSync(full);
            removed.push(name);
        }
    }
    return removed;
}

// Newest export for a channel, or null when the newest one is older than ttlMs.
// Filenames are ISO-stamped, so lexicographic order is chronological.
function findFreshExport(channelId, ttlMs, { dir = exportDir(), now = Date.now() } = {}) {
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch {
        return null;
    }

    const prefix = `ranking-${channelId}-`;
    const newest = names
        .filter(n => n.startsWith(prefix) && n.endsWith('.json'))
        .sort()
        .pop();
    if (!newest) return null;

    const file = path.join(dir, newest);
    const ageMs = now - fs.statSync(file).mtimeMs;
    if (ageMs > ttlMs) return null;

    try {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(payload.threads)) return null;
        // A scan that lost posts is an archive, not a cache: the next request rescans.
        if ((payload.failures ?? 0) > 0) return null;
        return { file, payload, ageMs };
    } catch {
        return null;
    }
}

module.exports = { exportDir, rankingPath, writeRankingExport, pruneExports, findFreshExport, RANKING_KEEP_DAYS, SNAPSHOT_KEEP_DAYS };
