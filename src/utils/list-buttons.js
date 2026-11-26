const { MessageFlags } = require('discord.js');
'use strict';

const { birthdayListMessage } = require('./birthday');

// Persistent pagination: the buttons carry no user binding, so anyone can page any list
// message, and they keep working after a deploy because the pages are rebuilt from the DB.
async function handleListButton(interaction, store) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This list only works inside a server.', flags: MessageFlags.Ephemeral });
    }

    const page = Number(interaction.customId.split(':')[1]) || 0;
    const entries = store.listBirthdays(interaction.guildId);

    if (entries.length === 0) {
        return interaction.update({ content: 'No birthdays registered in this server yet.', embeds: [], components: [] });
    }

    return interaction.update(birthdayListMessage(interaction.guild.name, entries, { page }));
}

module.exports = { handleListButton };
