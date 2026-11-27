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

    // Reuse the attachment already on the message rather than uploading it on every click.
    // A component interaction can carry a partial message, so fetch it before giving up.
    const cached = interaction.message?.attachments?.size ?? 0;
    let imageUrl = interaction.message?.attachments?.first?.()?.url ?? null;
    let fetchedCount = null;
    if (!imageUrl && interaction.message?.fetch) {
        const full = await interaction.message.fetch().catch(() => null);
        fetchedCount = full?.attachments?.size ?? null;
        imageUrl = full?.attachments?.first?.()?.url ?? null;
    }
    console.log(`[list] guild=${interaction.guildId} cachedAttachments=${cached} fetchedAttachments=${fetchedCount} -> ${imageUrl ? 'reusing' : 'uploading'}`);

    const payload = birthdayListMessage(interaction.guild.name, entries, { page, imageUrl });
    // Explicitly replace any attachment this message already had, so repeated clicks cannot
    // pile up copies of the same image.
    if (payload.files && cached > 0) payload.attachments = [];

    const edited = await interaction.editReply(payload);
    console.log(`[list] after edit: attachments=${edited?.attachments?.size ?? 'n/a'} filesSent=${payload.files ? payload.files.length : 0}`);
    return edited;
}

module.exports = { handleListButton };
