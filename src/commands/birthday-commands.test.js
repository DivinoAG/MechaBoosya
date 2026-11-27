'use strict';

require('../test-support/quiet-console').quietConsole();

// Command paths that were never driven: listing, the test announcement (success and failure),
// status output and removing your own entry.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const birthday = require('./birthday');
const birthdayConfig = require('./birthday-config');
const { getStore } = require('../utils/birthday-store');

const store = getStore();

let guildCounter = 0;
function nextGuild() {
    guildCounter += 1;
    return `g-cmd-${guildCounter}`;
}

function interaction({ sub, guildId, values = {}, manager = true, target = null } = {}) {
    const replies = [];
    const sends = [];
    return {
        replies,
        sends,
        guildId,
        guild: { name: 'Test Guild', members: { me: { id: 'bot' } } },
        user: { id: 'actor', username: 'actor', tag: 'actor#0001' },
        memberPermissions: { has: () => manager },
        client: {
            channels: {
                fetch: async id => ({
                    id,
                    send: async payload => {
                        if (values.failSend) throw new Error('Missing Access');
                        sends.push(payload);
                        return { id: 'm1', pin: async () => {} };
                    },
                }),
            },
        },
        options: {
            getSubcommand: () => sub,
            getUser: () => target,
            getInteger: name => values[name] ?? null,
            getString: name => values[name] ?? null,
            getChannel: name => values[name] ?? null,
            getRole: name => values[name] ?? null,
        },
        reply: async payload => { replies.push(payload); },
        deferReply: async () => { replies.push({ deferred: true }); },
        editReply: async payload => { replies.push(payload); },
        followUp: async payload => { replies.push(payload); },
    };
}

test('/birthday list renders the registry, and says so when it is empty', async () => {
    const emptyGuild = nextGuild();
    const empty = interaction({ sub: 'list', guildId: emptyGuild });
    await birthday.execute(empty);
    assert.match(empty.replies[0].content, /No birthdays registered/);

    const guildId = nextGuild();
    store.upsertBirthday({ guildId, userId: 'u1', month: 3, day: 7 });
    const filled = interaction({ sub: 'list', guildId });
    await birthday.execute(filled);

    const payload = filled.replies[0];
    assert.ok(payload.embeds, 'the list comes as an embed');
    assert.match(payload.embeds[0].data.description, /<@u1>/);
    assert.ok(payload.files, 'and carries the image on a fresh post');
});

test('/birthday test reports success after posting', async () => {
    const guildId = nextGuild();
    store.setSetting(guildId, 'announcement_channel', 'c1');
    store.setSetting(guildId, 'ping_role', 'r1');

    const i = interaction({ sub: 'test', guildId });
    await birthday.execute(i);

    assert.strictEqual(i.sends.length, 1, 'the announcement was sent');
    assert.match(i.sends[0].content, /<@&r1>/, 'with the configured ping');
    assert.match(i.replies.at(-1).content, /Test announcement posted/);
});

test('/birthday test reports the failure instead of throwing', async () => {
    const guildId = nextGuild();
    store.setSetting(guildId, 'announcement_channel', 'c1');

    const i = interaction({ sub: 'test', guildId, values: { failSend: true } });
    await birthday.execute(i);

    assert.match(i.replies.at(-1).content, /Could not post/);
});

test('/birthday test refuses when no announcement channel is configured', async () => {
    const i = interaction({ sub: 'test', guildId: nextGuild() });
    await birthday.execute(i);
    assert.match(i.replies[0].content, /No announcement channel configured/);
});

test('/birthday-config status lists the stored settings', async () => {
    const guildId = nextGuild();
    store.setSetting(guildId, 'announcement_channel', 'c1');
    store.setSetting(guildId, 'log_channel', 'c2');
    store.setSetting(guildId, 'timezone', 'America/Sao_Paulo');

    const i = interaction({ sub: 'status', guildId });
    await birthdayConfig.execute(i);

    const description = i.replies[0].embeds[0].description ?? i.replies[0].embeds[0].data.description;
    assert.match(description, /<#c1>/);
    assert.match(description, /<#c2>/);
    assert.match(description, /America\/Sao_Paulo/);
});

test('a member can remove their own birthday without Manage Server', async () => {
    const guildId = nextGuild();
    store.upsertBirthday({ guildId, userId: 'actor', month: 3, day: 7 });

    const i = interaction({ sub: 'remove', guildId, manager: false });
    await birthday.execute(i);

    assert.match(i.replies[0].content, /removed/i);
    assert.strictEqual(store.getBirthday(guildId, 'actor'), null);
});
