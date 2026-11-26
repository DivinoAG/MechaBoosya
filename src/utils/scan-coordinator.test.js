'use strict';

// One scan per channel at a time. A second caller joins the running scan, renders the same
// progress, and gets the same result — instead of a duplicate scan that doubles API traffic.

const test = require('node:test');
const assert = require('node:assert');

const { createScanCoordinator, renderProgress } = require('./scan-coordinator');

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

test('a second caller joins the running scan instead of starting another', async () => {
    const coordinator = createScanCoordinator();
    let started = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const first = coordinator.join('ch1', async () => { started += 1; await gate; return ['a']; });
    const second = coordinator.join('ch1', async () => { started += 1; return ['b']; });

    await tick();
    assert.strictEqual(started, 1, 'only one scan runs');
    assert.strictEqual(first.joined, false);
    assert.strictEqual(second.joined, true);
    assert.strictEqual(second.state, first.state, 'both share one state');

    release();
    assert.deepStrictEqual(await first.state.promise, ['a']);
    assert.deepStrictEqual(await second.state.promise, ['a'], 'the joiner gets the starter\'s result');
});

test('the joiner sees the progress of the scan already running', async () => {
    const coordinator = createScanCoordinator();
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const starter = coordinator.join('ch2', async progress => {
        progress.total = 200;
        progress.done = 75;
        await gate;
        return [];
    });
    const joiner = coordinator.join('ch2', async () => []);

    await tick();
    assert.strictEqual(joiner.state.progress.done, 75);
    assert.strictEqual(joiner.state.progress.total, 200);

    const seen = [];
    const edit = who => async payload => seen.push([who, payload.content]);
    const format = progress => `${progress.done} / ${progress.total}`;

    const a = renderProgress({ interaction: { editReply: edit('starter') }, state: starter.state, format, intervalMs: 5 });
    const b = renderProgress({ interaction: { editReply: edit('joiner') }, state: joiner.state, format, intervalMs: 5 });

    await tick(20);
    release();
    await Promise.all([a, b]);

    const joinerLine = seen.find(([who]) => who === 'joiner');
    assert.ok(joinerLine, 'the joiner rendered a progress line');
    assert.strictEqual(joinerLine[1], '75 / 200', 'with the same numbers as the starter');
});

test('a finished scan is forgotten, so the next call starts a new one', async () => {
    const coordinator = createScanCoordinator();
    const first = coordinator.join('ch3', async () => ['one']);
    await first.state.promise;

    assert.strictEqual(coordinator.active, 0);

    const second = coordinator.join('ch3', async () => ['two']);
    assert.strictEqual(second.joined, false);
    assert.deepStrictEqual(await second.state.promise, ['two']);
});

test('a failed scan rejects both callers and leaves nothing cached', async () => {
    const coordinator = createScanCoordinator();
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const starter = coordinator.join('ch4', async () => { await gate; throw new Error('discord down'); });
    const joiner = coordinator.join('ch4', async () => []);

    await tick();
    release();

    await assert.rejects(() => starter.state.promise, /discord down/);
    await assert.rejects(() => joiner.state.promise, /discord down/, 'the joiner is not left hanging');
    assert.strictEqual(coordinator.active, 0, 'a failure is not remembered');
});

test('progress rendering stops as soon as the scan settles', async () => {
    const coordinator = createScanCoordinator();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scan = coordinator.join('ch5', async progress => {
        progress.total = 200;
        progress.done = 10;
        await gate;
        return [];
    });

    let edits = 0;
    const rendering = renderProgress({
        interaction: { editReply: async () => { edits += 1; } },
        state: scan.state,
        format: progress => `${progress.done} / ${progress.total}`,
        intervalMs: 10_000,
    });

    await tick(20);
    release();

    const startedAt = Date.now();
    await rendering;
    assert.ok(Date.now() - startedAt < 1_000, 'settling wakes the renderer, it does not wait out the interval');
    assert.ok(edits <= 1);
});

test('a null format skips the edit — how small scans avoid progress noise', async () => {
    const coordinator = createScanCoordinator();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scan = coordinator.join('ch6', async progress => {
        progress.total = 3;
        progress.done = 1;
        await gate;
        return [];
    });

    let edits = 0;
    const rendering = renderProgress({
        interaction: { editReply: async () => { edits += 1; } },
        state: scan.state,
        format: progress => (progress.total >= 50 ? 'progress' : null),
        intervalMs: 5,
    });

    await tick(20);
    release();
    await rendering;

    assert.strictEqual(edits, 0);
});
