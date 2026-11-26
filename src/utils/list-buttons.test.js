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
