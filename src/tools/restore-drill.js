#!/usr/bin/env node
'use strict';

// Restore drill: prove the off-machine backup is a usable database.
//
//   node src/tools/restore-drill.js [path] [--live <stats.json>] [--expect <n>]
//
// The backup is a copy of a point-in-time snapshot, so its count is expected to lag the live one:
// registrations since the snapshot are not loss. What the drill fails on is a backup that cannot
// be read, holds no rows, holds *more* rows than the live database, or is older than the archive
// cadence — each of those means the safety net is gone rather than merely behind.
//
// `--expect` is a strict equality check, for verifying a snapshot you just took.

const fs = require('node:fs');
const path = require('node:path');
const { inspectBackup } = require('../utils/backup');

const DEFAULT_BACKUP = '/opt/data/workspace/llm-wiki/raw/mecha-boosya/db/latest.sqlite';
const DEFAULT_LIVE = '/mecha-boosya-exports/stats.json';
const MAX_AGE_H = 36;   // the archive runs daily; beyond this the job itself is broken

/** @param {string[]} argv */
function parseArgs(argv) {
    let file = DEFAULT_BACKUP;
    let live = DEFAULT_LIVE;
    /** @type {number | null} */
    let expected = null;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--expect') { expected = Number(argv[++i]); continue; }
        if (argv[i] === '--live') { live = argv[++i]; continue; }
        if (!argv[i].startsWith('--')) file = argv[i];
    }

    return { file, live, expected };
}

function readLiveCount(livePath) {
    try {
        return Number(JSON.parse(fs.readFileSync(livePath, 'utf8')).birthdays);
    } catch {
        return null;
    }
}

function main(argv) {
    const { file, live, expected } = parseArgs(argv);
    const result = inspectBackup(file);

    if (!result.ok) {
        console.error(`[drill] FAILED: ${result.reason}`);
        return 1;
    }

    const ageHours = Math.round((Date.now() - fs.statSync(file).mtimeMs) / 3_600_000);
    const liveCount = readLiveCount(live);

    console.log(`[drill] ${path.basename(file)}: ${result.birthdays} birthdays, ${result.announcements} announcements, ${result.guilds} guild(s), ${ageHours}h old`);
    console.log(`[drill] settings: ${result.settingKeys.join(', ') || '(none)'}`);
    if (liveCount !== null) {
        console.log(`[drill] live reports ${liveCount} birthday(s) — ${liveCount - result.birthdays} registered since the snapshot`);
    }

    if (result.birthdays === 0) {
        console.error('[drill] FAILED: the backup holds no birthdays');
        return 1;
    }

    if (ageHours > MAX_AGE_H) {
        console.error(`[drill] FAILED: the backup is ${ageHours}h old; the archive job has not run`);
        return 1;
    }

    if (liveCount !== null && result.birthdays > liveCount) {
        console.error(`[drill] FAILED: the backup holds ${result.birthdays} rows but the live database only ${liveCount}`);
        return 1;
    }

    if (expected !== null && result.birthdays !== expected) {
        console.error(`[drill] FAILED: expected ${expected} birthdays, the backup has ${result.birthdays}`);
        return 1;
    }

    console.log('[drill] OK: the backup opens, holds rows, and is current enough to restore from');
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { parseArgs, main, readLiveCount, MAX_AGE_H };
