const { SlashCommandBuilder } = require('discord.js');
const { runRanking, addRankingOptions } = require('../utils/ranking');

module.exports = {
    data: addRankingOptions(
        new SlashCommandBuilder()
            .setName('forum-rank')
            .setDescription('Lists top posts in a forum channel by reactions.')
    ),
    async execute(interaction) {
        return runRanking(interaction, { force: false });
    },
};
