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

function interaction(channel, { limit = null, dm = false, finished = null } = {}) {
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
            getBoolean: name => (name === 'direct_message' ? dm : finished),
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

test('a member without Manage Channels is served like anyone else', async () => {
    tempExports();
    const api = fakeApi(posts([2, 1]));
    const i = interaction(forumChannel());
    i.memberPermissions = { has: () => false };
    await runRanking(i, { api });

    assert.strictEqual(api.calls.forum, 1, 'the scan runs for a plain member');
    assert.ok(i.sends.some(([kind]) => kind === 'edit'), 'and the report is delivered');
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

test('a thread that cannot be read is skipped and the scan still finishes', async () => {
    const dir = tempExports();
    const threads = posts([5, 3, 1]);
    const api = {
        fetchForumThreads: async () => threads,
        fetchInitialMessage: async thread => {
            if (thread.id === '2') throw new Error('500 after retries');
            return { reactions: { cache: { find: () => ({ count: thread.count }) } } };
        },
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const report = i.sends.find(([kind]) => kind === 'edit')[1];
    assert.match(report.embeds[0].data.description, /post-1/, 'the readable posts are still reported');
    assert.doesNotMatch(report.embeds[0].data.description, /post-2/, 'the unreadable one is not invented');

    const written = JSON.parse(fs.readFileSync(exportFiles(dir)[0], 'utf8'));
    assert.strictEqual(written.failures, 1, 'the export records the gap');
    assert.strictEqual(written.count, 2, 'with only the rows that were read');
});

test('a thread with no starter message counts as unreadable', async () => {
    const api = {
        fetchForumThreads: async () => posts([4, 5]),
        fetchInitialMessage: async thread => (thread.id === '2' ? null : { reactions: { cache: { find: () => ({ count: thread.count }) } } }),
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const footer = i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data.footer;
    assert.match(footer.text, /1 post unreadable/);
});

test('a scan where every post fails still answers the interaction', async () => {
    const api = {
        fetchForumThreads: async () => posts([1]),
        fetchInitialMessage: async () => null,
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const last = i.sends.at(-1);
    assert.strictEqual(last[0], 'edit', 'a deferred reply must always be answered');
    assert.match(last[1].content, /could not be read/);
});

test('the footer states how many posts could not be read', async () => {
    const api = {
        fetchForumThreads: async () => posts([1, 2, 3, 4]),
        fetchInitialMessage: async thread => {
            if (thread.id === '3' || thread.id === '4') throw new Error('gone');
            return { reactions: { cache: { find: () => ({ count: thread.count }) } } };
        },
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const footer = i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data.footer;
    assert.match(footer.text, /2 posts unreadable/, 'plural for more than one');
});

test('a scan with failures is written but never served from cache', async () => {
    const dir = tempExports();
    writeRankingExport('f1', [{ name: 'seed', reactionCount: 1, tags: [] }], { requestedBy: 'seed', failures: 2 });

    const api = fakeApi(posts([3]));
    await runRanking(interaction(forumChannel()), { api });

    assert.strictEqual(api.calls.forum, 1, 'the incomplete export did not answer the request');
    assert.ok(exportFiles(dir).length >= 2, 'and a complete one was written');
});

test('a clean cached serve shows the age and the post count, never the requester', async () => {
    tempExports();
    writeRankingExport('f1', [
        { name: 'a', reactionCount: 3, tags: [] },
        { name: 'b', reactionCount: 2, tags: [] },
        { name: 'c', reactionCount: 1, tags: [] },
    ], { channelName: 'posts', requestedBy: 'the-person-who-asked', limit: null });

    const api = fakeApi(posts([1]));
    const i = interaction(forumChannel());
    await runRanking(i, { api });

    const footer = i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data.footer.text;
    assert.match(footer, /Cached results from \d+m ago/);
    assert.match(footer, /3 posts/);
    assert.doesNotMatch(footer, /the-person-who-asked|u1/, 'the requester stays in the log');
});

test('a scan that keeps failing is abandoned instead of reading hundreds of posts', async () => {
    const dir = tempExports();
    let attempts = 0;

    const api = {
        fetchForumThreads: async () => posts(Array.from({ length: 300 }, (_, i) => i)),
        fetchInitialMessage: async () => { attempts += 1; throw new Error('403 Missing Access'); },
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.ok(attempts <= 21, `stopped early, attempted ${attempts} of 300`);
    assert.deepStrictEqual(exportFiles(dir), [], 'nothing is archived from a blind scan');
    assert.match(i.sends.at(-1)[1].content, /unreadable/i, 'and the user is told why');
});

test('the abort message names how many could not be read', async () => {
    const api = {
        fetchForumThreads: async () => posts(Array.from({ length: 60 }, (_, i) => i)),
        fetchInitialMessage: async () => null,
    };

    const i = interaction(forumChannel());
    await runRanking(i, { api });

    assert.match(i.sends.at(-1)[1].content, /21/);
});

test('a second caller waiting on an aborted scan is told the same thing', async () => {
    const api = {
        fetchForumThreads: async () => posts(Array.from({ length: 60 }, (_, i) => i)),
        fetchInitialMessage: async () => null,
    };
    const channel = forumChannel();
    const first = interaction(channel);
    const second = interaction(channel);

    await Promise.all([runRanking(first, { api }), runRanking(second, { api })]);

    assert.match(first.sends.at(-1)[1].content, /unreadable/i);
    assert.match(second.sends.at(-1)[1].content, /unreadable/i, 'the joiner is not left waiting');
});

// "Finished" means the post is no longer competing: tagged DONE or PLAYED in the forum.

const FINISHED_TAGS = [{ id: 't-done', name: 'DONE' }, { id: 't-played', name: 'Played' }];

function taggedForum() {
    return [
        { id: '1', name: 'competing-top', appliedTags: [], count: 30 },
        { id: '2', name: 'done-post', appliedTags: ['t-done'], count: 99 },
        { id: '3', name: 'played-post', appliedTags: ['t-played'], count: 80 },
        { id: '4', name: 'competing-second', appliedTags: [], count: 10 },
    ];
}

function report(i) {
    return i.sends.find(([kind]) => kind === 'edit')[1].embeds[0].data;
}

test('finished posts are hidden from the report by default and still archived', async () => {
    const dir = tempExports();
    const api = fakeApi(taggedForum());
    const i = interaction(forumChannel({ availableTags: FINISHED_TAGS }));
    await runRanking(i, { api });

    const description = report(i).description;
    assert.match(description, /competing-top/);
    assert.doesNotMatch(description, /done-post/, 'DONE is not competing');
    assert.doesNotMatch(description, /played-post/, 'PLAYED is not competing');

    const file = fs.readdirSync(dir).find(name => name.startsWith('ranking-'));
    const archived = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.strictEqual(archived.threads.length, 4, 'the wiki needs every post, including finished ones');
});

test('include_finished puts them back in the ranking', async () => {
    tempExports();
    const api = fakeApi(taggedForum());
    const i = interaction(forumChannel({ availableTags: FINISHED_TAGS }), { finished: true });
    await runRanking(i, { api });

    const description = report(i).description;
    assert.match(description, /done-post/);
    assert.match(description, /played-post/);
    assert.ok(description.indexOf('done-post') < description.indexOf('competing-top'), 'still ranked by votes');
});

test('only DONE and PLAYED count as finished, whatever the case', async () => {
    tempExports();
    const api = fakeApi([
        { id: '1', name: 'lowercase', appliedTags: ['a'], count: 5 },
        { id: '2', name: 'mixed', appliedTags: ['b'], count: 4 },
        { id: '3', name: 'in-progress', appliedTags: ['c'], count: 3 },
    ]);
    const i = interaction(forumChannel({
        availableTags: [{ id: 'a', name: 'done' }, { id: 'b', name: 'Played' }, { id: 'c', name: 'In Progress' }],
    }));
    await runRanking(i, { api });

    const description = report(i).description;
    assert.match(description, /in-progress/);
    assert.doesNotMatch(description, /lowercase|mixed/);
});

test('the limit counts competing entries, not the hidden ones', async () => {
    tempExports();
    const api = fakeApi(taggedForum());
    const i = interaction(forumChannel({ availableTags: FINISHED_TAGS }), { limit: 2 });
    await runRanking(i, { api });

    const description = report(i).description;
    assert.match(description, /competing-top/);
    assert.match(description, /competing-second/);
    assert.doesNotMatch(description, /done-post/);
});

test('a cached export is filtered the same way, without a rescan', async () => {
    const dir = tempExports();
    const channel = forumChannel({ availableTags: FINISHED_TAGS });
    writeRankingExport('f1', taggedForum().map(thread => ({
        id: thread.id,
        name: thread.name,
        reactionCount: thread.count,
        tags: thread.appliedTags.map(id => FINISHED_TAGS.find(tag => tag.id === id)?.name).filter(Boolean),
    })), { channelName: 'posts', requestedBy: 'u1', limit: null, failures: 0 });

    const api = fakeApi([]);
    const i = interaction(channel);
    await runRanking(i, { api });

    assert.strictEqual(api.calls.forum, 0, 'served from the archive');
    const description = report(i).description;
    assert.match(description, /competing-top/);
    assert.doesNotMatch(description, /done-post/);
    assert.match(report(i).footer.text, /Cached results/);
    assert.ok(fs.readdirSync(dir).length >= 1);
});

test('the footer says how many finished posts were hidden', async () => {
    tempExports();
    const api = fakeApi(taggedForum());
    const i = interaction(forumChannel({ availableTags: FINISHED_TAGS }));
    await runRanking(i, { api });

    assert.match(report(i).footer.text, /2 finished posts hidden/);
});

test('both commands offer the option, off unless asked for', () => {
    const forumRank = require('../commands/forum-rank');
    const force = require('../commands/forum-rank-force');
    for (const command of [forumRank, force]) {
        const option = command.data.options.find(o => o.name === 'include_finished');
        assert.ok(option, `${command.data.name} should offer include_finished`);
        assert.strictEqual(option.required, false);
        assert.strictEqual(option.description.length > 0, true);
    }
});
