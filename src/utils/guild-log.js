'use strict';

// Mirrors birthday events into the configured log channel. Never throws: logging is best effort.
async function notify(client, store, guildId, text) {
    const channelId = store.getSetting(guildId, 'log_channel');
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;
        await channel.send({ content: text, allowedMentions: { parse: [] } });
    } catch (error) {
        console.error(`[log] could not deliver to ${channelId}:`, error.message);
    }
}

module.exports = { notify };
