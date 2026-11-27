'use strict';

// The numbers the process actually loaded, so a compose or .env change can be verified from
// outside the container: `cat stats.json` answers "did that variable land?".

require('../test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { effectiveConfig } = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');

test('the config reports the values the modules use', () => {
    const config = effectiveConfig();

    assert.strictEqual(typeof config.maxUnreadablePosts, 'number');
    assert.strictEqual(typeof config.cacheTtlHours, 'number');
    assert.strictEqual(typeof config.fetchDelayMs, 'number');
    assert.strictEqual(typeof config.progressMinPosts, 'number');
    assert.strictEqual(typeof config.announceMinuteOfDay, 'number');
});

test('the values come from the environment, not from a hardcoded copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-config-'));

    // A fresh process, because these are read once at module load — exactly like the container.
    const script = `
        process.env.EXPORT_DIR = ${JSON.stringify(dir)};
        const { writeStats } = require('./src/utils/stats');
        const { openStore } = require('./src/utils/birthday-store');
        writeStats(openStore(':memory:'), 'g1');
    `;

    execFileSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        env: {
            ...process.env,
            MAX_UNREADABLE_POSTS: '7',
            CACHE_TTL_HOURS: '11',
            FETCH_DELAY_MS: '99',
            PROGRESS_MIN_POSTS: '12',
            BIRTHDAY_ANNOUNCE_MINUTE_OF_DAY: '42',
        },
    });

    const written = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')).config;
    assert.deepStrictEqual(written, {
        maxUnreadablePosts: 7,
        cacheTtlHours: 11,
        fetchDelayMs: 99,
        progressMinPosts: 12,
        announceMinuteOfDay: 42,
    });
});
