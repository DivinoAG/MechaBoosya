'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isLastDayOfMonth, nextMonth, monthlyMessage, monthlyAction } = require('./birthday');
const { openStore } = require('./birthday-store');

test('detects the last day of a month, including leap Februaries', () => {
    assert.strictEqual(isLastDayOfMonth({ year: 2026, month: 11, day: 30 }), true);
    assert.strictEqual(isLastDayOfMonth({ year: 2026, month: 11, day: 29 }), false);
    assert.strictEqual(isLastDayOfMonth({ year: 2026, month: 2, day: 28 }), true);
    assert.strictEqual(isLastDayOfMonth({ year: 2024, month: 2, day: 28 }), false);
    assert.strictEqual(isLastDayOfMonth({ year: 2024, month: 2, day: 29 }), true);
    assert.strictEqual(isLastDayOfMonth({ year: 2026, month: 12, day: 31 }), true);
});

test('rolls December into January', () => {
    assert.strictEqual(nextMonth(11), 12);
    assert.strictEqual(nextMonth(12), 1);
});

test('monthly embed lists only that month', () => {
    const entries = [
        { user_id: 'u1', month: 12, day: 26, year: null },
        { user_id: 'u2', month: 12, day: 5, year: 1990 },
        { user_id: 'u3', month: 1, day: 3, year: null },
    ];
    const data = monthlyMessage(12, entries).embeds[0].data;

    assert.strictEqual(data.title, 'Upcoming birthdays of December');
    assert.match(data.description, /^<@u2> — 05\. December 1990\n<@u1> — 26\. December$/);
    assert.strictEqual(data.footer.text, '2 birthday(s) in December');
    assert.strictEqual(data.thumbnail.url, 'attachment://birthday.png');
});

test('monthly embed stays useful when the month is empty', () => {
    const data = monthlyMessage(3, [{ user_id: 'u1', month: 1, day: 1, year: null }]).embeds[0].data;
    assert.match(data.description, /No birthdays registered for March yet\./);
    assert.strictEqual(data.footer.text, '0 birthday(s) in March');
});

test('the pinned post record round-trips and is replaced on rollover', () => {
    const store = openStore(':memory:');
    assert.strictEqual(store.getMonthlyPost('g1'), null);

    store.setMonthlyPost({ guildId: 'g1', month: 12, channelId: 'c1', messageId: 'm1' });
    assert.strictEqual(store.getMonthlyPost('g1').month, 12);

    store.setMonthlyPost({ guildId: 'g1', month: 1, channelId: 'c1', messageId: 'm2' });
    const row = store.getMonthlyPost('g1');
    assert.strictEqual(row.month, 1);
    assert.strictEqual(row.message_id, 'm2');

    store.clearMonthlyPost('g1');
    assert.strictEqual(store.getMonthlyPost('g1'), null);
});

test('picks refresh, rollover, move or post for the pinned message', () => {
    const existing = { channel_id: 'c1', month: 12, message_id: 'm1' };

    assert.strictEqual(monthlyAction(null, { channelId: 'c1', targetMonth: 12 }), 'post');
    assert.strictEqual(monthlyAction(existing, { channelId: 'c1', targetMonth: 12 }), 'refresh');
    assert.strictEqual(monthlyAction(existing, { channelId: 'c1', targetMonth: 1 }), 'rollover');
    assert.strictEqual(monthlyAction(existing, { channelId: 'c2', targetMonth: 12 }), 'move');
    // A channel change outranks a month change: the old post must be deleted, not just unpinned.
    assert.strictEqual(monthlyAction(existing, { channelId: 'c2', targetMonth: 1 }), 'move');
});
