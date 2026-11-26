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

module.exports = { exportDir, rankingPath, writeRankingExport, pruneExports, RANKING_KEEP_DAYS, SNAPSHOT_KEEP_DAYS };
