'use strict';

require('../test-support/quiet-console').quietConsole();

// The parts of the daily tick that are easy to get wrong and hard to notice: the birthday role
// sync (grant today, strip everyone else, skip when the role outranks the bot) and the monthly
// pinned post (post, refresh, move, rollover, disable).

const test = require('node:test');
const assert = require('node:assert');

const { startBirthdayScheduler } = require('./birthday-scheduler');
const { openStore } = require('./birthday-store');

const DAY = '2026-11-26T14:00:00Z';
const LAST_DAY = '2026-11-30T14:00:00Z';

function makeStore(settings = {}) {
    const store = openStore(':memory:');
    store.setSetting('g1', 'timezone', 'UTC');
    for (const [key, value] of Object.entries(settings)) store.setSetting('g1', key, value);
    return store;
}

// Channels, guild members and roles in one fake client, recording what happened.
function makeClient({ roleMembers = [], highest = 10, rolePosition = 5, messages = {} } = {}) {
    const log = { sends: [], edits: [], deletes: [], unpins: [], pins: [], roleAdd: [], roleRemove: [] };

    const members = new Map();
    for (const id of ['u1', 'u2']) {
        members.set(id, {
            id,
            roles: {
                cache: { has: () => false },
                add: async () => log.roleAdd.push(id),
                remove: async () => log.roleRemove.push(id),
            },
        });
    }

    // Realistic shape: role.members holds the same member objects the guild cache does.
    const role = {
        id: 'r1',
        position: rolePosition,
        members: new Map(roleMembers.map(id => [id, members.get(id)])),
    };

    const channels = {};
    function channel(id) {
        if (!channels[id]) {
            channels[id] = {
                id,
                send: async payload => {
                    log.sends.push({ id, payload });
                    return { id: `msg-${log.sends.length}`, pin: async () => log.pins.push(id) };
                },
                messages: {
                    fetch: async messageId => messages[messageId] ?? {
                        id: messageId,
                        edit: async () => log.edits.push(messageId),
                        unpin: async () => log.unpins.push(messageId),
                        delete: async () => log.deletes.push(messageId),
                    },
                },
            };
        }
        return channels[id];
    }

    const client = {
        channels: { fetch: async id => channel(id) },
        guilds: {
            fetch: async () => ({
                roles: { fetch: async () => role },
                members: { me: { roles: { highest: { position: highest } } }, fetch: async () => {}, cache: members },
            }),
        },
    };

    return { client, log };
}

function scheduler(store, client, at = DAY) {
    return startBirthdayScheduler(client, {
        store, guildId: 'g1', exportDir: null, runOnStart: false,
        now: () => new Date(at),
    });
}

test('the role is granted to today\'s celebrant and stripped from everyone else', async () => {
    const store = makeStore({ announcement_channel: 'c1', birthday_role: 'r1' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 11, day: 26 });
    const { client, log } = makeClient({ roleMembers: ['u2'] });

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.deepStrictEqual(log.roleAdd, ['u1'], 'u1 got the role');
    assert.deepStrictEqual(log.roleRemove, ['u2'], 'yesterday\'s holder lost it');
});

test('the role is skipped when it sits at or above the bot\'s highest role', async () => {
    const store = makeStore({ announcement_channel: 'c1', birthday_role: 'r1' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 11, day: 26 });
    const { client, log } = makeClient({ highest: 5, rolePosition: 5 });

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.deepStrictEqual(log.roleAdd, [], 'no assignment attempted');
    assert.deepStrictEqual(log.roleRemove, []);
});

test('the first monthly post is pinned and remembered', async () => {
    const store = makeStore({ announcement_channel: 'c1', monthly_mode: 'announcement' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 12, day: 3 });
    const { client, log } = makeClient();

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.strictEqual(log.sends.length >= 1, true, 'the list was posted');
    assert.deepStrictEqual(log.pins, ['c1'], 'and pinned');
    const record = store.getMonthlyPost('g1');
    assert.ok(record, 'the message id is stored for tomorrow\'s refresh');
    assert.strictEqual(record.channel_id, 'c1');
});

test('a channel change deletes the old post instead of leaving it orphaned', async () => {
    const store = makeStore({ announcement_channel: 'c1', monthly_mode: 'custom', monthly_channel: 'c2' });
    store.setMonthlyPost({ guildId: 'g1', month: 11, channelId: 'c1', messageId: 'm1' });
    const { client, log } = makeClient();

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.deepStrictEqual(log.deletes, ['m1'], 'the old message was removed');
    assert.strictEqual(store.getMonthlyPost('g1').channel_id, 'c2', 'and the record moved');
});

test('on the last day of the month the old post is unpinned and the next month posted', async () => {
    const store = makeStore({ announcement_channel: 'c1', monthly_mode: 'announcement' });
    store.setMonthlyPost({ guildId: 'g1', month: 11, channelId: 'c1', messageId: 'm1' });
    const { client, log } = makeClient();

    const s = scheduler(store, client, LAST_DAY);
    await s.tick();
    s.stop();

    assert.deepStrictEqual(log.unpins, ['m1'], 'November was unpinned, not deleted');
    assert.deepStrictEqual(log.deletes, []);
    assert.strictEqual(store.getMonthlyPost('g1').month, 12, 'December took over the record');
});

test('disabling the monthly post deletes the message and clears the record', async () => {
    const store = makeStore({ announcement_channel: 'c1', monthly_mode: 'off' });
    store.setMonthlyPost({ guildId: 'g1', month: 11, channelId: 'c1', messageId: 'm1' });
    const { client, log } = makeClient();

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.deepStrictEqual(log.deletes, ['m1']);
    assert.strictEqual(store.getMonthlyPost('g1'), null);
});

test('an announcement send failure is not recorded, so the next tick retries', async () => {
    const store = makeStore({ announcement_channel: 'c1' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 11, day: 26 });

    const { client } = makeClient();
    client.channels.fetch = async id => ({ id, send: async () => { throw new Error('500 Internal Server Error'); } });

    const s = scheduler(store, client);
    await s.tick();
    s.stop();

    assert.strictEqual(store.wasAnnounced('g1', 'u1', '2026-11-26'), false, 'the day stays open for a retry');
});

test('an unreachable announcement channel is logged and skipped, not thrown', async () => {
    const store = makeStore({ announcement_channel: 'gone' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 11, day: 26 });

    const { client } = makeClient();
    client.channels.fetch = async () => null;

    const s = scheduler(store, client);
    await assert.doesNotReject(() => s.tick());
    s.stop();

    assert.strictEqual(store.wasAnnounced('g1', 'u1', '2026-11-26'), false);
});

test('the daily snapshot is written once and reused within the day', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-snap-'));

    const store = makeStore({ announcement_channel: 'c1' });
    store.upsertBirthday({ guildId: 'g1', userId: 'u1', month: 12, day: 1 });
    const { client } = makeClient();

    const s = startBirthdayScheduler(client, {
        store, guildId: 'g1', exportDir: dir, runOnStart: false, now: () => new Date(DAY),
    });
    await s.tick();
    await s.tick();
    s.stop();

    const snapshots = fs.readdirSync(dir).filter(name => name.startsWith('db-'));
    assert.strictEqual(snapshots.length, 1, `expected one snapshot, got ${snapshots.join(',')}`);
});
