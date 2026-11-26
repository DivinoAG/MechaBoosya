'use strict';

// Forum scanning: every active and archived thread must be collected exactly once, and
// archived pagination must walk backwards without repeating or looping.

const test = require('node:test');
const assert = require('node:assert');
const { ChannelType } = require('discord.js');

const { fetchForumThreads, fetchInitialMessage } = require('./discord-api');

// The module is chatty by design; keep the test output readable without changing it.
function quiet(fn) {
    return async () => {
        const log = console.log;
        const error = console.error;
        console.log = () => {};
        console.error = () => {};
        try { return await fn(); } finally { console.log = log; console.error = error; }
    };
}

function thread(id) {
    return { id, name: `thread-${id}` };
}

function forumChannel({ active = [], archivedPages = [] } = {}) {
    const calls = [];
    const pages = [...archivedPages];

    return {
        calls,
        name: 'posts',
        type: ChannelType.GuildForum,
        threads: {
            fetchActive: async () => ({
                threads: new Map(active.map(t => [t.id, t])),
            }),
            fetchArchived: async options => {
                calls.push({ ...options });
                return pages.shift() ?? { threads: new Map(), hasMore: false };
            },
        },
    };
}

function page(ids, hasMore) {
    return { threads: new Map(ids.map(id => [id, thread(id)])), hasMore };
}

test('a non-forum channel is rejected', quiet(async () => {
    await assert.rejects(
        () => fetchForumThreads({ type: ChannelType.GuildText, name: 'general' }),
        /not a forum channel/i
    );
}));

test('active threads come first, archived after', quiet(async () => {
    const channel = forumChannel({ active: [thread('30')], archivedPages: [page(['20', '10'], false)] });
    const threads = await fetchForumThreads(channel);

    assert.deepStrictEqual(threads.map(t => t.id), ['30', '20', '10']);
}));

test('archived pagination walks backwards from the oldest id seen', quiet(async () => {
    const channel = forumChannel({
        archivedPages: [page(['90', '80'], true), page(['70', '60'], false)],
    });

    const threads = await fetchForumThreads(channel);

    assert.deepStrictEqual(threads.map(t => t.id), ['90', '80', '70', '60']);
    assert.strictEqual(channel.calls.length, 2);
    assert.strictEqual(channel.calls[0].before, undefined, 'the first page has no cursor');
    assert.strictEqual(channel.calls[1].before, '80', 'the cursor is the lowest id of the previous page');
    assert.strictEqual(channel.calls[0].limit, 100);
}));

test('a thread seen twice is returned once', quiet(async () => {
    const channel = forumChannel({
        active: [thread('50')],
        archivedPages: [page(['50', '40'], true), page(['40', '30'], false)],
    });

    const threads = await fetchForumThreads(channel);

    assert.deepStrictEqual(threads.map(t => t.id), ['50', '40', '30']);
}));

test('an empty archive stops after one call', quiet(async () => {
    const channel = forumChannel({ archivedPages: [] });
    const threads = await fetchForumThreads(channel);

    assert.deepStrictEqual(threads, []);
    assert.strictEqual(channel.calls.length, 1);
}));

test('a thread without a starter message yields null instead of failing the scan', quiet(async () => {
    const broken = { id: '1', fetchStarterMessage: async () => { throw new Error('Unknown Message'); } };
    assert.strictEqual(await fetchInitialMessage(broken), null);

    const ok = { id: '2', fetchStarterMessage: async () => ({ id: 'm2', content: 'hi' }) };
    assert.strictEqual((await fetchInitialMessage(ok)).content, 'hi');
}));
