'use strict';

// Permission checks must refuse, never throw: a throw here surfaces to the user as the
// generic "There was an error while executing this command!" with no explanation.
// memberPermissions is null outside a guild, which is exactly when this matters.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const forumRank = require('./forum-rank');
const forumRankForce = require('./forum-rank-force');

function interaction({ permissions = null, manager = true } = {}) {
    const replies = [];
    return {
        replies,
        commandName: 'forum-rank',
        guildId: 'g1',
        channelId: 'c1',
        user: { id: 'u1' },
        memberPermissions: permissions === 'fake' ? { has: () => manager } : permissions,
        options: {
            getSubcommand: () => null,
            getBoolean: () => null,
            getChannel: () => null,
            getString: () => null,
        },
        reply: async payload => { replies.push(payload); },
        deferReply: async () => {},
        editReply: async payload => { replies.push(payload); },
        followUp: async payload => { replies.push(payload); },
    };
}

test('/forum-rank-force with no member permissions refuses instead of throwing', async () => {
    const i = interaction({ permissions: null });
    await forumRankForce.execute(i);

    assert.strictEqual(i.replies.length, 1);
    assert.match(i.replies[0].content, /Manage Server/i);
});

test('/forum-rank-force refuses a member without Manage Server', async () => {
    const i = interaction({ permissions: 'fake', manager: false });
    await forumRankForce.execute(i);

    assert.match(i.replies[0].content, /Manage Server/i);
});

test('/forum-rank with no member permissions refuses instead of throwing', async () => {
    const i = interaction({ permissions: null });
    await forumRank.execute(i);

    assert.strictEqual(i.replies.length, 1);
    assert.match(i.replies[0].content, /permission/i);
});

test('/forum-rank refuses a member without Manage Channels', async () => {
    const i = interaction({ permissions: 'fake', manager: false });
    await forumRank.execute(i);

    assert.match(i.replies[0].content, /permission/i);
});

test('/help hides commands the member cannot use', async () => {
    const help = require('./help');
    const i = interaction({ permissions: null });
    i.client = {
        commands: new Map([
            ['visiblecmd', { data: { name: 'visiblecmd', description: 'for everyone', options: [] } }],
            ['admincmd', { data: { name: 'admincmd', description: 'staff only', options: [], default_member_permissions: '32' } }],
        ]),
    };

    await help.execute(i);

    const shown = JSON.stringify(i.replies[0]);
    assert.match(shown, /visiblecmd/);
    assert.doesNotMatch(shown, /admincmd/, 'a null permission set must not reveal staff commands');
});
