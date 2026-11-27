const { MessageFlags } = require('discord.js');
'use strict';

const { birthdayListMessage } = require('./birthday');

// Persistent pagination: the buttons carry no user binding, so anyone can page any list
// message, and they keep working after a deploy because the pages are rebuilt from the DB.
async function handleListButton(interaction, store) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This list only works inside a server.', flags: MessageFlags.Ephemeral });
    }

    // Acknowledge before any work: Discord invalidates the token after 3 s, and a rebuild
    // that also uploads the image takes longer than that.
    await interaction.deferUpdate();

    // 'blist:3' selects page 3; 'blist:refresh:3' re-renders page 3 from current data.
    const [, kind, arg] = interaction.customId.split(':');
    const page = kind === 'refresh' ? Number(arg) || 0 : Number(kind) || 0;
    const entries = store.listBirthdays(interaction.guildId);

    if (entries.length === 0) {
        return interaction.editReply({ content: 'No birthdays registered in this server yet.', embeds: [], components: [] });
    }

    // Discord does not report the attachments of a webhook-edited message, so the image is
    // always re-sent; clearing `attachments` makes that a replacement instead of an append,
    // keeping exactly one copy however often the button is pressed.
    const imageUrl = interaction.message?.attachments?.first?.()?.url ?? null;
    const payload = birthdayListMessage(interaction.guild.name, entries, { page, imageUrl });
    if (payload.files) payload.attachments = [];

    console.log(`[list] page ${page + 1}/${payload.pageCount} rebuilt for guild ${interaction.guildId} (${imageUrl ? 'reusing image' : 're-uploading image'})`);
    return interaction.editReply(payload);
}

module.exports = { handleListButton };
