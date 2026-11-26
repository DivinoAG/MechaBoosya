'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatDiscordMessage } = require('./message-formatter');
const { ACCENT } = require('./theme');

test('uses the MechaBoosya accent colour', () => {
    const message = formatDiscordMessage('body', 'title');
    assert.strictEqual(message.embeds[0].data.color, ACCENT);
    assert.strictEqual(ACCENT, 0xbAd7e6);
});

test('keeps the footer only when one is given', () => {
    assert.strictEqual(formatDiscordMessage('body', 'title').embeds[0].data.footer, undefined);
    assert.strictEqual(formatDiscordMessage('body', 'title', 'Cached').embeds[0].data.footer.text, 'Cached');
});

test('truncates descriptions past the embed limit', () => {
    const message = formatDiscordMessage('x'.repeat(5000), 'title');
    const description = message.embeds[0].data.description;
    assert.strictEqual(description.length, 4096);
    assert.ok(description.endsWith('...'));
});
