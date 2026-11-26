const { MessageFlags, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const { runRanking, addRankingOptions } = require('../utils/ranking');

// Hidden from members without Manage Server, so only they ever see the option to rescan.
module.exports = {
    data: addRankingOptions(
        new SlashCommandBuilder()
            .setName('forum-rank-force')
            .setDescription('Lists top posts by reactions, rescanning every thread instead of using the cache.')
            .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    ),
    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: 'Rescanning requires the Manage Server permission.',
                flags: MessageFlags.Ephemeral,
            });
        }
        return runRanking(interaction, { force: true });
    },
};
