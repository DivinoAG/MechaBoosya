'use strict';

// The audit trail must never be on the answer's critical path. At 20:25 a /birthday that
// awaited its log-channel delivery took 3.8 s, the interaction expired, and the user got
// nothing at all.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const birthday = require('./birthday');
const { getStore } = require('../utils/birthday-store');

const store = getStore();

function interaction({ guildId, neverResolve = true }) {
    const calls = [];
    return {
        calls,
        guildId,
        guild: { name: 'Test Guild' },
        user: { id: 'actor', tag: 'actor#0001' },
        memberPermissions: { has: () => true },
        client: {
            channels: {
                fetch: async () => {
                    calls.push('log-fetch');
                    if (neverResolve) return new Promise(() => {});
                    return { send: async () => { calls.push('log-send'); } };
                },
            },
        },
        options: {
            getSubcommand: () => 'register',
            getUser: () => null,
            getInteger: name => ({ day: 4, month: 5, year: null })[name] ?? null,
        },
        reply: async () => { calls.push('reply'); },
        deferReply: async () => { calls.push('defer'); },
        editReply: async () => { calls.push('editReply'); },
        followUp: async () => {},
    };
}

test('a register answers even when the log channel never responds', async () => {
    const guildId = 'g-log-1';
    store.setSetting(guildId, 'log_channel', 'c1');

    const i = interaction({ guildId, neverResolve: true });
    const outcome = await Promise.race([
        birthday.execute(i).then(() => 'done'),
        new Promise(resolve => setTimeout(() => resolve('hung'), 300)),
    ]);

    assert.strictEqual(outcome, 'done', 'the command must not wait on the log delivery');
    assert.deepStrictEqual(i.calls.includes('reply'), true, 'the user was answered');
});

test('the reply goes out before the log delivery is attempted', async () => {
    const guildId = 'g-log-2';
    store.setSetting(guildId, 'log_channel', 'c1');

    const i = interaction({ guildId, neverResolve: false });
    await birthday.execute(i);

    assert.deepStrictEqual(i.calls, ['reply', 'log-fetch', 'log-send'], `got ${i.calls.join(' → ')}`);
});
