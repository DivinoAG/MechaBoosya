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

test('single page shows only the refresh button and says page 1/1', () => {
    const message = birthdayListMessage('Server', entries);

    assert.strictEqual(message.pageCount, 1);
    // Scope change: one page still needs a way to pick up birthdays added since it was posted.
    const ids = message.components.flatMap(row => row.components.map(c => c.data.custom_id));
    assert.deepStrictEqual(ids, ['blist:refresh:0']);
    assert.strictEqual(message.components[0].components[0].data.emoji.name, '🔄️');
    assert.strictEqual(message.embeds[0].data.footer.text, '3 birthday(s) registered · Page 1/1');
});

test('fills pages to the description budget instead of a fixed count', () => {
    const long = Array.from({ length: 300 }, (_, i) => ({
        user_id: '1'.repeat(18) + String(i).padStart(2, '0'),
        month: (i % 12) + 1,
        day: (i % 28) + 1,
        year: null,
    }));

    const pages = buildListPages(long);
    assert.ok(pages.length > 1, 'a 300-entry list needs several pages');
    assert.strictEqual(pages.flatMap(p => p.items).length, 300, 'no entry is dropped');

    for (let i = 0; i < pages.length; i++) {
        const description = birthdayListMessage('Server', long, { page: i }).embeds[0].data.description;
        assert.ok(description.length <= 4096, `page ${i} fits the embed limit (${description.length})`);
        // Every page except the remainder should be packed close to the budget.
        if (i < pages.length - 1) {
            assert.ok(description.length > 3000, `page ${i} is densely filled (${description.length})`);
        }
    }
});

test('a short list stays on a single page', () => {
    assert.strictEqual(buildListPages(entries).length, 1);
});

test('page buttons number the pages and mark the active one disabled', () => {
    const buttons = pageButtons(1, 3)[0].components;

    // Scope change: refresh comes first because it is the only button always present.
    assert.deepStrictEqual(buttons.map(b => b.data.custom_id), ['blist:refresh:1', 'blist:0', 'blist:1', 'blist:2']);
    const numbered = buttons.filter(b => b.data.label);
    assert.deepStrictEqual(numbered.map(b => b.data.label), ['1', '2', '3']);

    const active = buttons.find(b => b.data.custom_id === 'blist:1');
    assert.strictEqual(active.data.disabled, true);
    assert.strictEqual(active.data.style, 1); // Primary
    assert.strictEqual(buttons.find(b => b.data.custom_id === 'blist:0').data.style, 2); // Secondary
});

test('out-of-range pages clamp to the last page', () => {
    const message = birthdayListMessage('Server', many, { page: 99 });
    assert.strictEqual(message.page, message.pageCount - 1);
});
