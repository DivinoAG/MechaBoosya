'use strict';

// A readable count of what the bot holds, written next to the exports. The live database is
// inside the container and cannot be read from outside; without this, any count quoted is only
// as fresh as the last daily snapshot.

require('../test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeStats } = require('./stats');
const { openStore } = require('./birthday-store');

function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-stats-'));
    process.env.EXPORT_DIR = dir;
    return dir;
}

test('writes the current counts where the exports live', () => {
    const dir = tempDir();
    const store = openStore(':memory:');
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 3, day: 7 });
    store.upsertBirthday({ guildId: 'g1', userId: 'u2', month: 4, day: 8 });
    store.recordAnnouncement('g1', 'u1', '2026-03-07');

    const file = writeStats(store, 'g1');
    assert.strictEqual(file, path.join(dir, 'stats.json'));

    const stats = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(stats.birthdays, 2);
    assert.strictEqual(stats.announcements, 1);
    assert.strictEqual(stats.guildId, 'g1');
    assert.match(stats.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a later write reflects a registration made since', () => {
    tempDir();
    const store = openStore(':memory:');
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 3, day: 7 });
    writeStats(store, 'g1');

    store.upsertBirthday({ guildId: 'g1', userId: 'u2', month: 4, day: 8 });
    const stats = JSON.parse(fs.readFileSync(writeStats(store, 'g1'), 'utf8'));

    assert.strictEqual(stats.birthdays, 2, 'the count is not cached');
});

test('no leftover tmp file and no throw when the directory is unusable', () => {
    const dir = tempDir();
    const store = openStore(':memory:');
    writeStats(store, 'g1');
    assert.deepStrictEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), []);

    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x');
    process.env.EXPORT_DIR = blocked;

    assert.strictEqual(writeStats(store, 'g1'), null, 'a bad path returns null instead of throwing');
});
