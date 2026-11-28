'use strict';

// Who may run what: /forum-rank is for every member, /forum-rank-force is not. The two used to share
// a Manage Channels gate inside runRanking while Discord showed /forum-rank to everyone, so members
// saw the command in the picker and were refused when running it.

require('../test-support/quiet-console').quietConsole();

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');
const { ChannelType, PermissionsBitField } = require('discord.js');

const forumRank = require('./forum-rank');
const forumRankForce = require('./forum-rank-force');

function interaction({ permissions = null, isForum = true } = {}) {
    const replies = [];
    return {
        replies,
        commandName: 'forum-rank',
        guildId: 'g1',
        channelId: 'c1',
        user: { id: 'u1', username: 'tester' },
        memberPermissions: permissions,
        client: { user: { id: 'bot' } },
        options: {
            getChannel: () => ({
                id: 'f1',
                name: 'posts',
                type: isForum ? ChannelType.GuildForum : ChannelType.GuildText,
                permissionsFor: () => ({ has: () => true }),
            }),
            getInteger: () => null,
            getBoolean: () => false,
        },
        reply: async payload => { replies.push(payload); },
        deferReply: async () => { replies.push({ deferred: true }); },
        editReply: async payload => { replies.push(payload); },
        followUp: async payload => { replies.push(payload); },
    };
}

test('/forum-rank does not refuse a member without Manage Channels', async () => {
    const i = interaction({ permissions: null, isForum: false });
    await forumRank.execute(i);

    const first = i.replies[0];
    assert.doesNotMatch(first.content ?? '', /permission/i, 'no permission refusal for a plain member');
    assert.match(first.content, /not a forum channel/i, 'it got as far as validating the argument');
});

test('/forum-rank-force still requires Manage Server, with or without a permission payload', async () => {
    const missing = interaction({ permissions: null });
    await forumRankForce.execute(missing);
    assert.match(missing.replies[0].content, /Manage Server/i);

    const member = interaction({ permissions: { has: () => false } });
    await forumRankForce.execute(member);
    assert.match(member.replies[0].content, /Manage Server/i);
});

test('the registration declares the permission, so Discord hides /forum-rank-force itself', () => {
    assert.strictEqual(forumRank.data.default_member_permissions, undefined, '/forum-rank is public');
    assert.strictEqual(
        forumRankForce.data.default_member_permissions,
        String(PermissionsBitField.Flags.ManageGuild),
        '/forum-rank-force is hidden from members'
    );
});

// The /help filtering test moved to help.test.js: help is driven by its own manifest rather than by
// the registered command list, so the requirement changed shape with it.
