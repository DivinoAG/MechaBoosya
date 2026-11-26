'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { progressText, requester } = require('./ranking');

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

test('the requester is logged with id and name, so Dockge is readable', () => {
    assert.strictEqual(
        requester({ user: { id: '140241889961050112', username: 'kemwer' } }),
        'user=140241889961050112(kemwer)'
    );
});

test('a missing username still identifies the requester by id', () => {
    assert.strictEqual(requester({ user: { id: '42' } }), 'user=42(unknown)');
    assert.strictEqual(requester({}), 'user=unknown(unknown)');
});
