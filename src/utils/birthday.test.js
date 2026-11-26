'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const {
    isLeapYear, isValidDate, isValidTimeZone, zonedParts, dateKey,
    matchesToday, formatBirthday, groupByMonth, daysInMonth, announcementMessage,
} = require('./birthday');

test('leap years follow the gregorian rule', () => {
    assert.ok(isLeapYear(2024));
    assert.ok(isLeapYear(2000));
    assert.ok(!isLeapYear(1900));
    assert.ok(!isLeapYear(2026));
    assert.strictEqual(daysInMonth(2, 2024), 29);
    assert.strictEqual(daysInMonth(2, 2026), 28);
    assert.strictEqual(daysInMonth(4, 2026), 30);
});

test('validates dates, allowing Feb 29 without a year', () => {
    assert.ok(isValidDate(1, 29, null));
    assert.ok(isValidDate(2, 29, null));
    assert.ok(!isValidDate(2, 29, 2023));
    assert.ok(isValidDate(2, 29, 2024));
    assert.ok(!isValidDate(2, 30, null));
    assert.ok(!isValidDate(4, 31, null));
    assert.ok(!isValidDate(13, 1, null));
    assert.ok(!isValidDate(1, 0, null));
});

test('formats entries with and without a year', () => {
    assert.strictEqual(formatBirthday({ month: 1, day: 1, year: null }), '01. January');
    assert.strictEqual(formatBirthday({ month: 7, day: 13, year: 2001 }), '13. July 2001');
});

test('groups by month and sorts chronologically inside each month', () => {
    const groups = groupByMonth([
        { user_id: 'a', month: 7, day: 13, year: null },
        { user_id: 'b', month: 1, day: 21, year: 2001 },
        { user_id: 'c', month: 1, day: 1, year: null },
    ]);
    assert.deepStrictEqual(groups.map(g => g.label), ['January', 'July']);
    assert.match(groups[0].text, /^<@c> — 01\. January\n<@b> — 21\. January 2001$/);
});

test('Feb 29 birthdays land on Mar 1 in non-leap years only', () => {
    const feb29 = { month: 2, day: 29 };
    assert.strictEqual(matchesToday(feb29, { year: 2026, month: 3, day: 1 }), true);
    assert.strictEqual(matchesToday(feb29, { year: 2028, month: 3, day: 1 }), false);
    assert.strictEqual(matchesToday(feb29, { year: 2028, month: 2, day: 29 }), true);
    assert.strictEqual(matchesToday({ month: 5, day: 4 }, { year: 2026, month: 5, day: 5 }), false);
});

test('zonedParts converts to the requested zone', () => {
    const instant = new Date('2026-01-01T02:30:00Z');
    assert.deepStrictEqual(zonedParts(instant, 'UTC'), { year: 2026, month: 1, day: 1, hour: 2, minute: 30 });
    assert.deepStrictEqual(zonedParts(instant, 'America/Sao_Paulo'), { year: 2025, month: 12, day: 31, hour: 23, minute: 30 });
    assert.strictEqual(dateKey(zonedParts(instant, 'America/Sao_Paulo')), '2025-12-31');
});

test('timezone validation accepts IANA names only', () => {
    assert.ok(isValidTimeZone('America/Sao_Paulo'));
    assert.ok(isValidTimeZone('UTC'));
    assert.ok(!isValidTimeZone('Mars/Olympus'));
    assert.ok(!isValidTimeZone(''));
});

test('announcement embeds the bundled image as an attachment', () => {
    const message = announcementMessage('123456789');

    assert.strictEqual(message.embeds[0].data.thumbnail.url, 'attachment://birthday.png');
    assert.strictEqual(message.files[0].name, 'birthday.png');
    assert.ok(fs.existsSync(message.files[0].attachment), 'img/birthday.png must ship in the repo');
    assert.match(message.embeds[0].data.description, /<@123456789>/);
    assert.strictEqual(message.embeds[0].data.color, 0xbAd7e6);
});
