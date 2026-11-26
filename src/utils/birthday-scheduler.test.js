'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startBirthdayScheduler } = require('./birthday-scheduler');
const { openStore } = require('./birthday-store');

function fakeClient() {
    const sent = [];
    return {
        sent,
        channels: {
            fetch: async id => ({
                id,
                send: async payload => {
                    sent.push(payload);
                    return { id: `m${sent.length}`, pin: async () => {}, edit: async () => {} };
                },
                messages: { fetch: async () => null },
            }),
        },
        guilds: { fetch: async () => ({ roles: { fetch: async () => null } }) },
    };
}

// Drives the real tick() with a fixed clock and a fake Discord client.
function harness({ at, entries = [], settings = {} }) {
    const store = openStore(':memory:');
    store.setSetting('g1', 'announcement_channel', 'c1');
    store.setSetting('g1', 'monthly_mode', 'off');
    store.setSetting('g1', 'timezone', 'UTC');
    for (const [key, value] of Object.entries(settings)) store.setSetting('g1', key, value);
    for (const entry of entries) store.upsertBirthday({ guildId: 'g1', ...entry });

    const client = fakeClient();
    const scheduler = startBirthdayScheduler(client, {
        store, guildId: 'g1', exportDir: null, runOnStart: false,
        now: () => new Date(at),
    });
    return { client, store, scheduler };
}

test('stays silent before 00:05 local', async () => {
    const { client, scheduler } = harness({ at: '2026-05-04T00:04:00Z', entries: [{ userId: 'u1', month: 5, day: 4 }] });
    await scheduler.tick();
    scheduler.stop();
    assert.strictEqual(client.sent.length, 0);
});

test('announces at 00:05 and names the birthday member', async () => {
    const { client, scheduler } = harness({ at: '2026-05-04T00:05:00Z', entries: [{ userId: 'u1', month: 5, day: 4 }] });
    await scheduler.tick();
    scheduler.stop();

    assert.strictEqual(client.sent.length, 1);
    assert.match(client.sent[0].embeds[0].data.description, /<@u1>/);
});

test('a boot later in the day catches up the same date', async () => {
    const { client, scheduler } = harness({ at: '2026-05-04T14:30:00Z', entries: [{ userId: 'u1', month: 5, day: 4 }] });
    await scheduler.tick();
    scheduler.stop();
    assert.strictEqual(client.sent.length, 1);
});

test('nobody else is announced on someone else\'s day', async () => {
    const entries = [
        { userId: 'u1', month: 5, day: 4 },
        { userId: 'u2', month: 5, day: 5 },
        { userId: 'u3', month: 6, day: 4 },
    ];
    const { client, scheduler } = harness({ at: '2026-05-04T09:00:00Z', entries });
    await scheduler.tick();
    scheduler.stop();

    assert.strictEqual(client.sent.length, 1);
    assert.match(client.sent[0].embeds[0].data.description, /<@u1>/);
});

test('posts once per person per day, however often the tick runs', async () => {
    const { client, scheduler } = harness({ at: '2026-05-04T09:00:00Z', entries: [{ userId: 'u1', month: 5, day: 4 }] });
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    scheduler.stop();

    assert.strictEqual(client.sent.length, 1);
});

test('Feb 29 is announced on Mar 1 only in non-leap years', async () => {
    const entries = [{ userId: 'leap', month: 2, day: 29 }];

    const nonLeap = harness({ at: '2026-03-01T00:10:00Z', entries });
    await nonLeap.scheduler.tick();
    nonLeap.scheduler.stop();
    assert.strictEqual(nonLeap.client.sent.length, 1, '2026 is not a leap year: celebrate on Mar 1');

    const leapMar1 = harness({ at: '2028-03-01T00:10:00Z', entries });
    await leapMar1.scheduler.tick();
    leapMar1.scheduler.stop();
    assert.strictEqual(leapMar1.client.sent.length, 0, '2028 is a leap year: not their day');

    const leapFeb29 = harness({ at: '2028-02-29T00:10:00Z', entries });
    await leapFeb29.scheduler.tick();
    leapFeb29.scheduler.stop();
    assert.strictEqual(leapFeb29.client.sent.length, 1, 'their actual day');
});

test('the guild timezone decides which day it is', async () => {
    const entries = [{ userId: 'u1', month: 5, day: 4 }];

    // 02:00Z on May 4 is still May 3 in São Paulo (UTC-3).
    const before = harness({ at: '2026-05-04T02:00:00Z', entries, settings: { timezone: 'America/Sao_Paulo' } });
    await before.scheduler.tick();
    before.scheduler.stop();
    assert.strictEqual(before.client.sent.length, 0);

    // 03:10Z on May 4 is 00:10 on May 4 locally.
    const after = harness({ at: '2026-05-04T03:10:00Z', entries, settings: { timezone: 'America/Sao_Paulo' } });
    await after.scheduler.tick();
    after.scheduler.stop();
    assert.strictEqual(after.client.sent.length, 1);
});
