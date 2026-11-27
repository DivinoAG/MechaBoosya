'use strict';

// The drill is only worth having if it fails when it should: every outcome here is driven
// against a real snapshot, and the failure cases are the interesting ones.

require('../test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, main } = require('./restore-drill');
const { openStore } = require('../utils/birthday-store');

function snapshotWith(count, { ageHours = 0 } = {}) {
    const store = openStore(':memory:');
    for (let i = 0; i < count; i++) {
        store.upsertBirthday({ guildId: 'g1', userId: `u${i}`, month: (i % 12) + 1, day: (i % 28) + 1 });
    }
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-drill-')), 'latest.sqlite');
    store.snapshotTo(file);

    if (ageHours > 0) {
        const when = new Date(Date.now() - ageHours * 3_600_000);
        fs.utimesSync(file, when, when);
    }
    return file;
}

function statsFile(birthdays) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-live-')), 'stats.json');
    fs.writeFileSync(file, JSON.stringify({ birthdays, generatedAt: new Date().toISOString() }));
    return file;
}

function quietly(fn) {
    const log = console.log;
    const error = console.error;
    console.log = () => {};
    console.error = () => {};
    try { return fn(); } finally { console.log = log; console.error = error; }
}

test('arguments: the path, the live file and the expected count are read separately', () => {
    const args = parseArgs(['/tmp/backup.sqlite', '--live', '/tmp/stats.json', '--expect', '7']);
    assert.deepStrictEqual(args, { file: '/tmp/backup.sqlite', live: '/tmp/stats.json', expected: 7 });

    const defaults = parseArgs(['--expect', '45']);
    assert.strictEqual(defaults.expected, 45);
    assert.match(defaults.file, /latest\.sqlite$/, 'the value after --expect is not a path');
});

test('a behind-but-current backup passes, because a lag is not loss', () => {
    const file = snapshotWith(30);
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(45)])), 0);
});

test('a backup with no birthdays fails', () => {
    const file = snapshotWith(0);
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(0)])), 1);
});

test('a stale backup fails, because the archive job stopped running', () => {
    const file = snapshotWith(5, { ageHours: 48 });
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(5)])), 1);
});

test('a backup holding more rows than the live database fails', () => {
    const file = snapshotWith(50);
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(45)])), 1);
});

test('strict equality holds when a count is expected', () => {
    const file = snapshotWith(3);
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(3), '--expect', '3'])), 0);
    assert.strictEqual(quietly(() => main([file, '--live', statsFile(3), '--expect', '4'])), 1);
});

test('a missing backup fails instead of crashing', () => {
    assert.strictEqual(quietly(() => main(['/tmp/definitely-not-here.sqlite'])), 1);
});
