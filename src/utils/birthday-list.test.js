'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { birthdayListMessage } = require('./birthday');

const entries = [
    { user_id: 'u2', month: 2, day: 1, year: null },
    { user_id: 'u1', month: 1, day: 6, year: null },
    { user_id: 'u3', month: 1, day: 12, year: 1997 },
];

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

test('counts registrations in the footer and truncates very long lists', () => {
    assert.strictEqual(birthdayListMessage('Server', entries).embeds[0].data.footer.text, '3 birthday(s) registered');

    const many = Array.from({ length: 400 }, (_, i) => ({
        user_id: `user${i}`, month: (i % 12) + 1, day: (i % 28) + 1, year: null,
    }));
    const description = birthdayListMessage('Server', many).embeds[0].data.description;
    assert.strictEqual(description.length, 4096);
    assert.ok(description.endsWith('…'));
});
