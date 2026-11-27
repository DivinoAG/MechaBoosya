'use strict';

require('../test-support/quiet-console').quietConsole();

// The progress wiring as runRanking drives it: a slow enough scan must edit the deferred reply
// with the counter, and a quick one must not edit at all. Separate file because the interval and
// the threshold are read once at module load.

process.env.FETCH_DELAY_MS = '40';
process.env.PROGRESS_INTERVAL_MS = '10';
process.env.PROGRESS_MIN_POSTS = '2';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');

const { runRanking } = require('./ranking');

function setup() {
    process.env.EXPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-prog-'));
}

function forumChannel() {
    return {
        id: 'f9',
        name: 'posts',
        type: ChannelType.GuildForum,
        defaultReactionEmoji: { id: null, name: '⭐' },
        availableTags: [],
        permissionsFor: () => ({ has: () => true }),
    };
}

function interaction() {
    const edits = [];
    return {
        edits,
        user: { id: 'u1', username: 'tester', send: async () => {} },
        channelId: 'c1',
        channel: { send: async () => {} },
        client: { user: { id: 'bot' } },
        memberPermissions: { has: () => true },
        options: { getChannel: () => forumChannel(), getInteger: () => null, getBoolean: () => false },
        deferReply: async () => {},
        editReply: async payload => edits.push(payload.content ?? ''),
        reply: async () => {},
        followUp: async () => {},
    };
}

function api(count) {
    const threads = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), name: `post-${i + 1}`, appliedTags: [], count: i }));
    return {
        fetchForumThreads: async () => threads,
        fetchInitialMessage: async thread => ({ reactions: { cache: { find: () => ({ count: thread.count }) } } }),
    };
}

test('a long scan shows the counter as it advances', async () => {
    setup();
    const i = interaction();
    await runRanking(i, { api: api(6) });

    const progress = i.edits.filter(line => line.includes('Scanning'));
    assert.ok(progress.length >= 2, `expected progress edits, got ${i.edits.length}`);
    assert.match(progress[0], /Scanning #posts — \d+ \/ 6 posts/);
});

test('a scan below the threshold stays silent', async () => {
    setup();
    const i = interaction();
    await runRanking(i, { api: api(1) });

    assert.strictEqual(i.edits.filter(line => line.includes('Scanning')).length, 0, 'no progress noise');
    assert.ok(i.edits.length >= 1, 'but the report still arrives');
});
