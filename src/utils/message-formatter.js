const { EmbedBuilder } = require('discord.js');
const { ACCENT } = require('./theme');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;

function formatDiscordMessage(content, title, footer) {

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(content.length > MAX_EMBED_DESCRIPTION_LENGTH ? content.substring(0, MAX_EMBED_DESCRIPTION_LENGTH - 3) + '...' : content)
        .setColor(ACCENT);

    if (footer) {
        embed.setFooter({ text: footer });
    }

    return { embeds: [embed] };
}

module.exports = {
    formatDiscordMessage,
};
