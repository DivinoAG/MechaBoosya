'use strict';

// /help must list what the caller can actually run: a plain member sees the member commands, a
// moderator sees the ranking command, a manager sees everything. And it must never fall behind
// the command files.

require('../test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { PermissionsBitField } = require('discord.js');

const help = require('./help');
const { loadCommands } = require('../runtime');

const MEMBER = 0n;
const CHANNELS = PermissionsBitField.Flags.ManageChannels;
const SERVER = PermissionsBitField.Flags.ManageGuild;

function interaction(permissions) {
    const replies = [];
    return {
        replies,
        guildId: 'g1',
        guild: { name: 'Test Guild' },
        user: { id: 'u1', username: 'tester' },
        memberPermissions: permissions === null ? null : { has: flag => (BigInt(flag) & permissions) === BigInt(flag) },
        client: { commands: new Map() },
        options: {},
        reply: async payload => { replies.push(payload); },
        editReply: async payload => { replies.push(payload); },
        deferReply: async () => {},
        followUp: async () => {},
    };
}

function text(i) {
    return i.replies[0].embeds[0].description;
}

test('a member sees the member commands and nothing else', async () => {
    const i = interaction(MEMBER);
    await help.execute(i);
    const shown = text(i);

    for (const command of ['/birthday register', '/birthday update', '/birthday remove', '/birthday show', '/birthday list', '/help']) {
        assert.ok(shown.includes(command), `${command} should be listed`);
    }
    for (const hidden of ['/birthday-config', '/forum-rank', '/birthday test']) {
        assert.ok(!shown.includes(hidden), `${hidden} must not be listed`);
    }
});

test('Manage Channels reveals the ranking command but not the server-only ones', async () => {
    const i = interaction(CHANNELS);
    await help.execute(i);
    const shown = text(i);

    assert.ok(shown.includes('/forum-rank`'), 'the ranking command is listed');
    assert.ok(!shown.includes('/forum-rank-force'), 'forcing a rescan needs Manage Server');
    assert.ok(!shown.includes('/birthday-config'), 'configuration is still hidden');
});

test('Manage Server sees every command', async () => {
    const i = interaction(SERVER);
    await help.execute(i);
    const shown = text(i);

    for (const command of ['/birthday-config status', '/birthday-config monthly', '/birthday test', '/forum-rank-force']) {
        assert.ok(shown.includes(command), `${command} should be listed for a manager`);
    }
});

test('each entry follows its own gate, not a blanket "is an admin"', async () => {
    // Manage Server does not imply Manage Channels, and /forum-rank is gated on the latter.
    const i = interaction(SERVER);
    await help.execute(i);
    assert.ok(!text(i).includes('/forum-rank`'), 'the ranking command needs Manage Channels');
});

test('a missing permission set behaves like a plain member', async () => {
    const i = interaction(null);
    await help.execute(i);

    assert.ok(text(i).includes('/birthday list'));
    assert.ok(!text(i).includes('/birthday-config'));
});

test('the message says it is ephemeral and uses the reference layout', async () => {
    const i = interaction(MEMBER);
    await help.execute(i);

    assert.strictEqual(i.replies[0].flags, 64, 'ephemeral');
    assert.match(text(i), /^`\/birthday register` `day` `month` `\[year\]` — /m, 'inline code, arguments, em dash');
});

test('every command file appears in the manager view', async () => {
    const { commands } = loadCommands(path.join(__dirname));
    const i = interaction(SERVER);
    await help.execute(i);
    const shown = text(i);

    for (const name of commands.keys()) {
        assert.ok(shown.includes(`/${name}`), `help does not mention /${name}`);
    }
});
