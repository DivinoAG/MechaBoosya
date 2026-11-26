'use strict';

// Permission boundaries and option handling for the birthday commands.
// These are security-relevant: a regression here lets a member edit other people's data
// or change server configuration.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const birthday = require('./birthday');
const birthdayConfig = require('./birthday-config');
const { getStore } = require('../utils/birthday-store');

const store = getStore();

function fakeChannel({ canPost = true, id = 'c1' } = {}) {
    return {
        id,
        permissionsFor: () => ({ has: () => canPost }),
        send: async () => ({}),
    };
}

function interaction({
    sub,
    manager = true,
    guildId = `g-${Math.random().toString(36).slice(2)}`,
    actor = 'actor',
    target = null,
    values = {},
}) {
    const replies = [];
    const reply = async payload => { replies.push(payload); };

    return {
        replies,
        guildId,
        guild: { name: 'Test Guild', members: { me: { id: 'bot' } } },
        user: { id: actor, tag: `${actor}#0001` },
        memberPermissions: { has: () => manager },
        client: { channels: { fetch: async () => null } },
        options: {
            getSubcommand: () => sub,
            getUser: () => target,
            getInteger: name => values[name] ?? null,
            getString: name => values[name] ?? null,
            getChannel: name => values[name] ?? null,
            getRole: name => values[name] ?? null,
        },
        reply,
        deferReply: async () => {},
        editReply: reply,
        followUp: reply,
    };
}

const other = { id: 'someone-else', tag: 'other#0001' };

test('a member cannot register a birthday for someone else', async () => {
    const i = interaction({ sub: 'register', manager: false, target: other, values: { day: 4, month: 5 } });
    await birthday.execute(i);

    assert.match(i.replies[0].content, /Manage Server/i);
    assert.strictEqual(store.getBirthday(i.guildId, other.id), null, 'nothing was written');
});

test('a manager can register for someone else', async () => {
    const i = interaction({ sub: 'register', manager: true, target: other, values: { day: 4, month: 5 } });
    await birthday.execute(i);

    assert.match(i.replies[0].content, /Saved <@someone-else>/);
    assert.strictEqual(store.getBirthday(i.guildId, other.id).day, 4);
});

test('a member cannot remove someone else\'s birthday', async () => {
    const i = interaction({ sub: 'remove', manager: false, target: other });
    await birthday.execute(i);

    assert.match(i.replies[0].content, /Manage Server/i);
});

test('registering twice is refused, pointing at update', async () => {
    const guildId = 'g-dupe';
    const first = interaction({ sub: 'register', guildId, values: { day: 4, month: 5 } });
    await birthday.execute(first);

    const second = interaction({ sub: 'register', guildId, values: { day: 6, month: 5 } });
    await birthday.execute(second);

    assert.match(second.replies[0].content, /already registered/i);
    assert.strictEqual(store.getBirthday(guildId, 'actor').day, 4, 'the original value survives');
});

test('an impossible date is rejected before it reaches the store', async () => {
    const i = interaction({ sub: 'register', values: { day: 30, month: 2 } });
    await birthday.execute(i);

    assert.match(i.replies[0].content, /not a valid date/i);
    assert.strictEqual(store.getBirthday(i.guildId, 'actor'), null);
});

test('a member cannot change server configuration', async () => {
    const i = interaction({ sub: 'announcement-channel', manager: false, values: { channel: fakeChannel() } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /Manage Server/i);
    assert.strictEqual(store.getSetting(i.guildId, 'announcement_channel'), null);
});

test('an invalid timezone is refused', async () => {
    const i = interaction({ sub: 'timezone', values: { value: 'Mars/Olympus' } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /not a valid IANA time zone/i);
    assert.strictEqual(store.getSetting(i.guildId, 'timezone'), null);
});

test('custom monthly mode requires a channel', async () => {
    const i = interaction({ sub: 'monthly', values: { mode: 'custom' } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /Pick a channel/i);
    assert.strictEqual(store.getSetting(i.guildId, 'monthly_mode'), null);
});

test('a channel the bot cannot post in is refused as an announcement channel', async () => {
    const i = interaction({ sub: 'announcement-channel', values: { channel: fakeChannel({ canPost: false }) } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /can(no|')?t post|permission/i);
    assert.strictEqual(store.getSetting(i.guildId, 'announcement_channel'), null, 'a broken setting is not saved');
});

test('a channel the bot cannot post in is refused as a log channel', async () => {
    const i = interaction({ sub: 'log-channel', values: { channel: fakeChannel({ canPost: false }) } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /can(no|')?t post|permission/i);
    assert.strictEqual(store.getSetting(i.guildId, 'log_channel'), null);
});

test('a usable channel is saved', async () => {
    const i = interaction({ sub: 'announcement-channel', values: { channel: fakeChannel() } });
    await birthdayConfig.execute(i);

    assert.match(i.replies[0].content, /Announcements will be posted/);
    assert.strictEqual(store.getSetting(i.guildId, 'announcement_channel'), 'c1');
});

test('the bot member is fetched when the guild cache has not filled yet', async () => {
    let fetched = 0;
    const me = { id: 'bot' };
    const channel = fakeChannel();

    const i = interaction({ sub: 'announcement-channel', values: { channel } });
    i.guild.members = { me: null, fetchMe: async () => { fetched += 1; return me; } };
    channel.permissionsFor = member => ({ has: () => member === me });

    await birthdayConfig.execute(i);

    assert.strictEqual(fetched, 1, 'fetched once instead of trusting a null cache');
    assert.match(i.replies[0].content, /Announcements will be posted/);
    assert.strictEqual(store.getSetting(i.guildId, 'announcement_channel'), 'c1');
});
