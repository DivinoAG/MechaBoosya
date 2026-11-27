'use strict';

require('../test-support/quiet-console').quietConsole();

// The scan orchestration: cache decision, export write, report chunking, DM path, ordering
// and the failure contract. Discord is faked through the injected `api` and the interaction;
// the export directory is a temp dir read at call time.

// Read at module load, so they must be set before the require below: no artificial per-post
// delay in tests, and a threshold high enough that progress edits cannot be mistaken for reports.
process.env.FETCH_DELAY_MS = '0';
process.env.PROGRESS_MIN_POSTS = '100000';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType } = require('discord.js');

const { runRanking } = require('./ranking');
const { writeRankingExport } = require('./exports');

function tempExports() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-exp-'));
    process.env.EXPORT_DIR = dir;
    return dir;
}

function forumChannel(overrides = {}) {
    return {
        id: 'f1',
        name: 'posts',
        type: ChannelType.GuildForum,
        defaultReactionEmoji: { id: null, name: '⭐' },
        availableTags: [],
        permissionsFor: () => ({ has: () => true }),
        ...overrides,
    };
}

function posts(counts) {
    return counts.map((count, i) => ({ id: String(i + 1), name: `post-${i + 1}`, appliedTags: [], count }));
}

function fakeApi(threads, { fail = false } = {}) {
    const calls = { forum: 0, starters: 0 };
    return {
        calls,
        fetchForumThreads: async () => {
            calls.forum += 1;
            if (fail) throw new Error('discord exploded');
            return threads;
        },
        fetchInitialMessage: async thread => {
            calls.starters += 1;
            return { reactions: { cache: { find: () => ({ count: thread.count }) } } };
        },
    };
}

function interaction(channel, { limit = null, dm = false } = {}) {
    const sends = [];
    const order = [];
    return {
        sends,
        order,
        user: { id: 'u1', username: 'tester', send: async payload => sends.push(['dm', payload]) },
        channelId: 'c1',
        channel: { send: async payload => sends.push(['channel', payload]) },
        client: { user: { id: 'bot' } },
        memberPermissions: { has: () => true },
        options: {
            getChannel: () => channel,
            getInteger: () => limit,
            getBoolean: () => dm,
        },
        deferReply: async () => { order.push('defer'); },
        editReply: async payload => { order.push('edit'); sends.push(['edit', payload]); },
        reply: async payload => { order.push('reply'); sends.push(['reply', payload]); },
        followUp: async payload => { order.push('followUp'); sends.push(['followUp', payload]); },
    };
}

function exportFiles(dir) {
    return fs.readdirSync(dir).filter(name => name.startsWith('ranking-')).map(name => path.join(dir, name));
}

test('a fresh export is served without touching the forum', async () => {
    const dir = tempExports();
    writeRankingExport('f1', [{ name: 'seed', reactionCount: 7, tags: [] }], { channelName: 'posts', requestedBy: 'seed', limit: null });

    const api = fakeApi(posts([1, 2, 3]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.strictEqual(api.calls.forum, 0, 'no scan on a fresh export');
    assert.match(JSON.stringify(i.sends), /Cached results from/, 'the footer says the data is cached');
    assert.strictEqual(exportFiles(dir).length, 1, 'serving the cache writes nothing');
});

test('a stale export is rescanned and the footer drops the cache note', async () => {
    const dir = tempExports();
    const file = writeRankingExport('f1', [{ name: 'old', reactionCount: 1, tags: [] }], { requestedBy: 'seed' });
    const old = new Date(Date.now() - 4 * 3_600_000);
    fs.utimesSync(file, old, old);

    const api = fakeApi(posts([5, 2]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.strictEqual(api.calls.forum, 1, 'a stale export triggers a scan');
    assert.doesNotMatch(JSON.stringify(i.sends), /Cached results from/);
    assert.strictEqual(exportFiles(dir).length, 2, 'the scan wrote a new export');
});

test('force rescans even when the export is fresh', async () => {
    tempExports();
    writeRankingExport('f1', [{ name: 'seed', reactionCount: 1, tags: [] }], { requestedBy: 'seed' });

    const api = fakeApi(posts([1]));
    await runRanking(interaction(forumChannel()), { api, force: true });

    assert.strictEqual(api.calls.forum, 1);
});

test('the export records who asked and the requested limit', async () => {
    const dir = tempExports();
    const api = fakeApi(posts([3, 1, 2]));
    await runRanking(interaction(forumChannel(), { limit: 2 }), { api });

    const files = exportFiles(dir);
    assert.strictEqual(files.length, 1, 'exactly one export per scan');
    const written = JSON.parse(fs.readFileSync(files[0], 'utf8'));
    assert.strictEqual(written.requestedBy, 'u1');
    assert.strictEqual(written.limit, 2);
    assert.strictEqual(written.count, 3, 'the archive keeps every post, not the truncated report');
});

test('a failed export write still delivers the report', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-exp-'));
    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x');
    process.env.EXPORT_DIR = blocked;

    const api = fakeApi(posts([1, 2]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.ok(i.sends.some(([kind]) => kind === 'edit'), 'the user still got the report');
    assert.doesNotMatch(JSON.stringify(i.sends), /error occurred/i, 'and it is the report, not an error');
});

test('a long report is chunked: first edit, then channel messages', async () => {
    tempExports();
    const api = fakeApi(posts(Array.from({ length: 120 }, (_, i) => i)));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const edits = i.sends.filter(([kind]) => kind === 'edit');
    const channelPosts = i.sends.filter(([kind]) => kind === 'channel');
    assert.strictEqual(edits.length, 1, 'the interaction edits its own reply once');
    assert.strictEqual(channelPosts.length, 2, 'the remaining 70 entries go to the channel');
});

test('the direct-message path sends every chunk privately and confirms', async () => {
    tempExports();
    const api = fakeApi(posts(Array.from({ length: 120 }, (_, i) => i)));
    const i = interaction(forumChannel(), { dm: true });
    await runRanking(i, { api });

    const dms = i.sends.filter(([kind]) => kind === 'dm');
    const channels = i.sends.filter(([kind]) => kind === 'channel');
    assert.strictEqual(dms.length, 3, 'all three chunks went to the user');
    assert.strictEqual(channels.length, 0, 'nothing was posted publicly');
    assert.match(JSON.stringify(i.sends), /Report sent to your DMs/);
});

test('the limit is applied before chunking, so it cannot spill into the channel', async () => {
    tempExports();
    const api = fakeApi(posts(Array.from({ length: 120 }, (_, i) => i)));
    const i = interaction(forumChannel(), { limit: 5 });
    await runRanking(i, { api });

    assert.strictEqual(i.sends.filter(([kind]) => kind === 'channel').length, 0);
    const report = i.sends.find(([kind]) => kind === 'edit')[1];
    // Entries are rendered as "**1) title**"; the limit must cap them before chunking.
    assert.strictEqual((report.embeds[0].data.description.match(/\*\*\d+\) /g) || []).length, 5);
});

test('the interaction is deferred before the forum is fetched', async () => {
    tempExports();
    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.deepStrictEqual(i.order[0], 'defer', `order was ${i.order.join(',')}`);
});

test('a scan failure becomes the generic error reply, not a crash', async () => {
    tempExports();
    const api = fakeApi([], { fail: true });
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const last = i.sends.at(-1);
    assert.strictEqual(last[0], 'edit');
    assert.match(last[1].content, /error occurred/i);
});

test('a forum without a default reaction is refused before deferring', async () => {
    tempExports();
    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel({ defaultReactionEmoji: null }));
    await runRanking(i, { api });

    assert.deepStrictEqual(i.order, ['reply'], 'answered without deferring');
    assert.match(i.sends[0][1].content, /default reaction emoji/i);
    assert.strictEqual(api.calls.forum, 0, 'and without scanning');
});

test('entries are ordered by reaction count, highest first', async () => {
    tempExports();
    const api = fakeApi(posts([1, 9, 4]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const description = i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data.description;
    assert.ok(description.indexOf('post-2') < description.indexOf('post-3'), '9 votes before 4');
    assert.ok(description.indexOf('post-3') < description.indexOf('post-1'), '4 votes before 1');
});

test('a member without Manage Channels is refused before anything else', async () => {
    tempExports();
    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel());
    i.memberPermissions = { has: () => false };
    await runRanking(i, { api });

    assert.deepStrictEqual(i.order, ['reply']);
    assert.match(i.sends[0][1].content, /permission/i);
    assert.strictEqual(api.calls.forum, 0);
});

test('a channel that is not a forum is refused', async () => {
    tempExports();
    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel({ type: ChannelType.GuildText }));
    await runRanking(i, { api });

    assert.match(i.sends[0][1].content, /not a forum channel/i);
    assert.strictEqual(api.calls.forum, 0);
});

test('missing read permissions in the forum are refused', async () => {
    tempExports();
    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel({ permissionsFor: () => ({ has: () => false }) }));
    await runRanking(i, { api });

    assert.match(i.sends[0][1].content, /View Channel/i);
    assert.strictEqual(api.calls.forum, 0);
});

test('the default reaction is matched by name when the emoji has no id', async () => {
    tempExports();
    // A real predicate over two reactions: the named one must win.
    const api = {
        fetchForumThreads: async () => [{ id: '1', name: 'post-1', appliedTags: [], count: 0 }],
        fetchInitialMessage: async () => ({
            reactions: { cache: { find: predicate => [{ emoji: { id: 'custom', name: 'other' }, count: 2 }, { emoji: { id: null, name: '⭐' }, count: 9 }].find(predicate) } },
        }),
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.match(i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data.description, /Votes: 9/);
});

test('the cache footer switches to hours once the export is old enough', async () => {
    const dir = tempExports();
    const file = writeRankingExport('f1', [{ name: 'seed', reactionCount: 1, tags: [] }], { requestedBy: 'seed' });
    const ninetyMinutes = new Date(Date.now() - 90 * 60_000);
    fs.utimesSync(file, ninetyMinutes, ninetyMinutes);

    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.match(JSON.stringify(i.sends), /Cached results from 1h\d\dm/);
    assert.strictEqual(api.calls.forum, 0);
    assert.ok(exportFiles(dir).length === 1);
});
