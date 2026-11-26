'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { birthdayListMessage, buildListPages, pageButtons } = require('./birthday');

const entries = [
    { user_id: 'u2', month: 2, day: 1, year: null },
    { user_id: 'u1', month: 1, day: 6, year: null },
    { user_id: 'u3', month: 1, day: 12, year: 1997 },
];

const many = Array.from({ length: 23 }, (_, i) => ({
    user_id: `user${String(i).padStart(2, '0')}`,
    month: (i % 12) + 1,
    day: (i % 28) + 1,
    year: null,
}));

test('titles the list with the server name and shows the register hint', () => {
    const data = birthdayListMessage('Irina Meier - Official Discord', entries).embeds[0].data;

    assert.strictEqual(data.title, 'Birthday List - Irina Meier - Official Discord');
    assert.match(data.description, /^➤ Register your Birthday with\n`\/birthday register <day> <month> \[year\]`\n\n/);
});

test('groups by month in order, with the year only when known', () => {
    const description = birthdayListMessage('Server', entries).embeds[0].data.description;

    assert.match(description, /\*\*January\*\*\n<@u1> — 06\. January\n<@u3> — 12\. January 1997\n\n\*\*February\*\*\n<@u2> — 01\. February$/);
});

test('carries the birthday art as an attachment thumbnail', () => {
    const message = birthdayListMessage('Server', entries);

    assert.strictEqual(message.embeds[0].data.thumbnail.url, 'attachment://birthday.png');
    assert.strictEqual(message.files[0].name, 'birthday.png');
    assert.strictEqual(message.embeds[0].data.color, 0xbAd7e6);
});

test('single page has no buttons and says page 1/1', () => {
    const message = birthdayListMessage('Server', entries);

    assert.strictEqual(message.pageCount, 1);
    assert.deepStrictEqual(message.components, []);
    assert.strictEqual(message.embeds[0].data.footer.text, '3 birthday(s) registered · Page 1/1');
});

test('splits long lists into pages of ten, each with its own month headers', () => {
    const pages = buildListPages(many, 10);
    assert.strictEqual(pages.length, 3);
    assert.strictEqual(pages[0].items.length, 10);
    assert.strictEqual(pages[2].items.length, 3);
    assert.ok(pages[0].groups.length >= 1);

    const message = birthdayListMessage('Server', many, { page: 1, pageSize: 10 });
    assert.strictEqual(message.page, 1);
    assert.strictEqual(message.embeds[0].data.footer.text, '23 birthday(s) registered · Page 2/3');
});

test('page buttons number the pages and mark the active one disabled', () => {
    const rows = pageButtons(1, 3);
    const buttons = rows[0].components;

    assert.deepStrictEqual(buttons.map(b => b.data.label), ['1', '2', '3']);
    assert.deepStrictEqual(buttons.map(b => b.data.custom_id), ['blist:0', 'blist:1', 'blist:2']);
    assert.strictEqual(buttons[1].data.disabled, true);
    assert.strictEqual(buttons[1].data.style, 1); // Primary
    assert.strictEqual(buttons[0].data.style, 2); // Secondary
});

test('out-of-range pages clamp to the last page', () => {
    const message = birthdayListMessage('Server', many, { page: 99, pageSize: 10 });
    assert.strictEqual(message.page, 2);
});
