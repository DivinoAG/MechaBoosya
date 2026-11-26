'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { progressText } = require('./ranking');

test('formats counter, percentage and elapsed time', () => {
    assert.strictEqual(
        progressText('cosplay-wishlist', 128, 412, 68_000),
        '🔍 Scanning #cosplay-wishlist — 128 / 412 posts (31%) · 1m08s'
    );
});

test('starts at zero without dividing by zero', () => {
    assert.strictEqual(progressText('forum', 0, 0, 0), '🔍 Scanning #forum — 0 / 0 posts (0%) · 0m00s');
});

test('elapsed under a minute keeps the minute field', () => {
    assert.strictEqual(progressText('f', 5, 10, 9_400), '🔍 Scanning #f — 5 / 10 posts (50%) · 0m09s');
});

test('completes at 100%', () => {
    assert.match(progressText('f', 50, 50, 3_600_000), /\(100%\) · 60m00s$/);
});
