'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { openStore } = require('./birthday-store');

test('registers, reads, updates and removes a birthday', () => {
    const store = openStore(':memory:');
    const guildId = 'g1';

    store.upsertBirthday({ guildId, userId: 'u1', month: 5, day: 4, year: 1990 });
    assert.deepStrictEqual(
        { ...store.getBirthday(guildId, 'u1') },
        { guild_id: 'g1', user_id: 'u1', month: 5, day: 4, year: 1990, updated_at: store.getBirthday(guildId, 'u1').updated_at }
    );

    store.upsertBirthday({ guildId, userId: 'u1', month: 5, day: 5, year: null });
    assert.strictEqual(store.getBirthday(guildId, 'u1').day, 5);
    assert.strictEqual(store.getBirthday(guildId, 'u1').year, null);

    assert.strictEqual(store.deleteBirthday(guildId, 'u1'), true);
    assert.strictEqual(store.deleteBirthday(guildId, 'u1'), false);
    assert.strictEqual(store.getBirthday(guildId, 'u1'), null);
});

test('list is ordered by month then day and scoped to the guild', () => {
    const store = openStore(':memory:');
    store.upsertBirthday({ guildId: 'g1', userId: 'u2', month: 12, day: 3 });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 1, day: 21 });
    store.upsertBirthday({ guildId: 'g2', userId: 'u3', month: 6, day: 1 });

    assert.deepStrictEqual(store.listBirthdays('g1').map(r => r.user_id), ['u1', 'u2']);
    assert.strictEqual(store.listBirthdays('g2').length, 1);
});

test('the same announcement is recorded only once per day', () => {
    const store = openStore(':memory:');
    assert.strictEqual(store.recordAnnouncement('g1', 'u1', '2026-05-04'), true);
    assert.strictEqual(store.recordAnnouncement('g1', 'u1', '2026-05-04'), false);
    assert.strictEqual(store.recordAnnouncement('g1', 'u1', '2027-05-04'), true);
    assert.strictEqual(store.recordAnnouncement('g1', 'u2', '2026-05-04'), true);
});

test('settings round-trip and clear on null', () => {
    const store = openStore(':memory:');
    store.setSetting('g1', 'announcement_channel', '123');
    store.setSetting('g1', 'timezone', 'America/Sao_Paulo');
    assert.deepStrictEqual(store.allSettings('g1'), { announcement_channel: '123', timezone: 'America/Sao_Paulo' });

    store.setSetting('g1', 'announcement_channel', null);
    assert.strictEqual(store.getSetting('g1', 'announcement_channel'), null);
    assert.deepStrictEqual(store.allSettings('g1'), { timezone: 'America/Sao_Paulo' });
});

test('snapshot produces a readable copy of the database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-snap-'));
    const store = openStore(':memory:');
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 5, day: 4 });

    const file = store.snapshotTo(path.join(dir, 'db-2026-05-04.sqlite'));
    assert.ok(fs.existsSync(file));

    const copy = new DatabaseSync(file);
    assert.strictEqual(copy.prepare('SELECT COUNT(*) AS n FROM birthdays').get().n, 1);
    copy.close();
});
