'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { handleListButton } = require('./list-buttons');
const { openStore } = require('./birthday-store');

function fakeInteraction(customId, { guild = true, entries = [] } = {}) {
    const calls = { update: null, reply: null };
    return {
        calls,
        customId,
        guildId: 'g1',
        guild: guild ? { name: 'Irina Meier - Official Discord' } : null,
        async update(payload) { calls.update = payload; },
        async reply(payload) { calls.reply = payload; },
        store: (() => {
            const store = openStore(':memory:');
            for (const entry of entries) store.upsertBirthday({ guildId: 'g1', ...entry });
            return store;
        })(),
    };
}

test('any member can page the list — no user check on the button', async () => {
    const interaction = fakeInteraction('blist:0', {
        entries: [
            { userId: 'u1', month: 12, day: 26 },
            { userId: 'u2', month: 1, day: 3 },
        ],
    });

    await handleListButton(interaction, interaction.store);

    assert.ok(interaction.calls.update, 'update was called');
    assert.strictEqual(interaction.calls.reply, null, 'no permission refusal');
    assert.strictEqual(interaction.calls.update.embeds[0].data.title, 'Birthday List - Irina Meier - Official Discord');
});

test('the custom id selects the page', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
        userId: '1'.repeat(18) + String(i).padStart(2, '0'),
        month: (i % 12) + 1,
        day: (i % 28) + 1,
    }));
    const first = fakeInteraction('blist:0', { entries });
    await handleListButton(first, first.store);

    const second = fakeInteraction('blist:1', { entries });
    await handleListButton(second, second.store);

    assert.match(first.calls.update.embeds[0].data.footer.text, /Page 1\//);
    assert.match(second.calls.update.embeds[0].data.footer.text, /Page 2\//);
    assert.notStrictEqual(first.calls.update.embeds[0].data.description, second.calls.update.embeds[0].data.description);
});

test('an empty registry degrades to a notice instead of an empty embed', async () => {
    const interaction = fakeInteraction('blist:0');
    await handleListButton(interaction, interaction.store);

    assert.match(interaction.calls.update.content, /No birthdays registered/);
    assert.deepStrictEqual(interaction.calls.update.components, []);
});

test('a single-page list still offers the refresh button', async () => {
    const interaction = fakeInteraction('blist:0', { entries: [{ userId: 'u1', month: 5, day: 4 }] });
    await handleListButton(interaction, interaction.store);

    const ids = interaction.calls.update.components.flatMap(row => row.components.map(c => c.data.custom_id));
    assert.deepStrictEqual(ids, ['blist:refresh:0'], 'refresh is the only button needed on one page');
});

test('the refresh button carries the page being looked at', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
        userId: '1'.repeat(18) + String(i).padStart(2, '0'),
        month: (i % 12) + 1,
        day: (i % 28) + 1,
    }));
    const interaction = fakeInteraction('blist:1', { entries });
    await handleListButton(interaction, interaction.store);

    const ids = interaction.calls.update.components.flatMap(row => row.components.map(c => c.data.custom_id));
    assert.ok(ids.includes('blist:refresh:1'), `refresh keeps the current page, got ${ids.join(',')}`);
});

test('refresh re-reads the store, so birthdays added since are shown', async () => {
    const interaction = fakeInteraction('blist:refresh:0', { entries: [{ userId: 'u1', month: 5, day: 4 }] });

    // Someone registers after the list was posted.
    interaction.store.upsertBirthday({ guildId: 'g1', userId: 'u2', month: 6, day: 9 });

    await handleListButton(interaction, interaction.store);
    await handleListButton(interaction, interaction.store);

    const description = interaction.calls.update.embeds[0].data.description;
    assert.match(description, /<@u2>/, 'the new birthday appears without asking for a fresh list');
    assert.strictEqual(interaction.calls.reply, null);
});

test('a page past the end clamps to the last page instead of rendering empty', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
        userId: '1'.repeat(18) + String(i).padStart(2, '0'),
        month: (i % 12) + 1,
        day: (i % 28) + 1,
    }));
    const interaction = fakeInteraction('blist:999', { entries });
    await handleListButton(interaction, interaction.store);

    const footer = interaction.calls.update.embeds[0].data.footer.text;
    const [, page, total] = footer.match(/Page (\d+)\/(\d+)/);
    assert.strictEqual(page, total, 'clamped to the last page');
    assert.ok(interaction.calls.update.embeds[0].data.description.length > 100, 'the page has content');
});
