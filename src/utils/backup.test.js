'use strict';

// Reading a backup without trusting it: the drill has to open the file the wiki holds and report
// what is actually inside, or say why it could not.

require('../test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectBackup } = require('./backup');
const { openStore } = require('./birthday-store');

function tempFile(name = 'latest.sqlite') {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-backup-')), name);
}

test('a snapshot written by the bot can be read back', () => {
    const store = openStore(':memory:');
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 3, day: 7 });
    store.upsertBirthday({ guildId: 'g1', userId: 'u2', month: 4, day: 8 });
    store.setSetting('g1', 'announcement_channel', 'c1');

    const file = tempFile();
    store.snapshotTo(file);

    const result = inspectBackup(file);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.birthdays, 2);
    assert.strictEqual(result.announcements, 0);
    assert.deepStrictEqual(result.settingKeys, ['announcement_channel']);
    assert.strictEqual(result.guilds, 1);
});

test('a missing file is reported, not thrown', () => {
    const result = inspectBackup(path.join(os.tmpdir(), 'not-here', 'nope.sqlite'));
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /not found/i);
});

test('a file that is not a database is reported, not thrown', () => {
    const file = tempFile('garbage.sqlite');
    fs.writeFileSync(file, 'this is not sqlite');

    const result = inspectBackup(file);
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /sqlite|database|malformed|not a database/i);
});

test('a database without the expected tables is reported', () => {
    const file = tempFile('empty.sqlite');
    openStore(file);   // creates the schema, then we drop the tables to simulate a foreign file
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('DROP TABLE birthdays; DROP TABLE announcements; DROP TABLE settings;');
    db.close();

    const result = inspectBackup(file);
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /table/i);
});
