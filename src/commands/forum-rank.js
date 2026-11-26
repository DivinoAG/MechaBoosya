const { SlashCommandBuilder, ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');
const { fetchForumThreads, fetchInitialMessage } = require('../utils/discord-api');
const { generateReportString } = require('../utils/report-generator');
const { formatDiscordMessage } = require('../utils/message-formatter');
const { writeRankingExport, pruneExports } = require('../utils/exports');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forum-rank')
        .setDescription('Lists top posts in a forum channel by reactions.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The forum channel to check.')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('number_of_posts')
                .setDescription('Limit the results to the top X posts.')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('direct_message')
                .setDescription('Send the report as a direct message.')
                .setRequired(false)
        ),
    async execute(interaction) {
        if (!interaction.memberPermissions.has('MANAGE_CHANNELS')) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true,
            });
        }

        const channel = interaction.options.getChannel('channel');
        const numberOfPosts = interaction.options.getInteger('number_of_posts');
        const directMessage = interaction.options.getBoolean('direct_message');

        if (channel.type !== ChannelType.GuildForum) {
            return interaction.reply({
                content: 'The selected channel is not a forum channel. Please select a forum channel.',
                ephemeral: true,
            });
        }

        const botPermissions = channel.permissionsFor(interaction.client.user);
        if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel) || !botPermissions.has(PermissionsBitField.Flags.ReadMessageHistory)) {
            return interaction.reply({
                content: 'I need "View Channel" and "Read Message History" permissions in the selected forum channel to work properly.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: directMessage });

        try {
            console.log('Fetching forum threads...');
            const threads = await fetchForumThreads(channel);
            console.log(`Found ${threads.length} threads in total.`);

            const defaultReactionEmoji = channel.defaultReactionEmoji;

            if (!defaultReactionEmoji) {
                await interaction.editReply({
                    content: `The forum channel "${channel.name}" does not have a default reaction emoji configured. Cannot process top posts.`,
                    ephemeral: true,
                });
                return;
            }

            const threadData = [];
            let processedCount = 0;
            for (const thread of threads) {
                console.log(`Processing thread ${++processedCount}/${threads.length}: ${thread.name}`);
                const initialMessage = await fetchInitialMessage(thread);
                if (initialMessage) {
                    const reaction = initialMessage.reactions.cache.find(
                        r => (defaultReactionEmoji.id && r.emoji.id === defaultReactionEmoji.id) ||
                             (defaultReactionEmoji.name && r.emoji.name === defaultReactionEmoji.name)
                    );
                    const reactionCount = reaction ? reaction.count : 0;
                    threadData.push({
                        name: thread.name,
                        reactionCount: reactionCount,
                        tags: thread.appliedTags.map(tagId => channel.availableTags.find(tag => tag.id === tagId)?.name).filter(Boolean),
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between each request
            }

            console.log('Finished processing all threads. Sorting data...');
            // Sort threads by reaction count (descending)
            threadData.sort((a, b) => b.reactionCount - a.reactionCount);

            // Apply limit if specified
            const finalThreadData = numberOfPosts ? threadData.slice(0, numberOfPosts) : threadData;

            // Archive the full sorted list (unlimited) for the wiki ingest; the report below is truncated.
            try {
                const exportFile = writeRankingExport(channel.id, threadData, {
                    channelName: channel.name,
                    requestedBy: interaction.user.id,
                    limit: numberOfPosts || null,
                });
                console.log(`Ranking export written to ${exportFile}`);
                const pruned = pruneExports();
                if (pruned.length > 0) console.log(`Pruned ${pruned.length} expired export(s)`);
            } catch (exportError) {
                console.error('Failed to write ranking export:', exportError);
            }

            const chunkSize = 50;
            for (let i = 0; i < finalThreadData.length; i += chunkSize) {
                const chunk = finalThreadData.slice(i, i + chunkSize);
                const reportString = generateReportString(chunk, i);
                const title = `Top forum posts by reactions (Entries ${i + 1}-${i + chunk.length})`;
                const messageOptions = formatDiscordMessage(reportString, title);

                if (directMessage) {
                    await interaction.user.send(messageOptions);
                } else {
                    // If it's the first message, reply to the interaction. Otherwise, send to the channel.
                    if (i === 0) {
                        await interaction.editReply(messageOptions);
                    } else {
                        await interaction.channel.send(messageOptions);
                    }
                }
            }

            // If the message was a DM, send a confirmation.
            if (directMessage) {
                await interaction.editReply({ content: 'Report sent to your DMs.', ephemeral: true });
            }

        } catch (error) {
            console.error('Error processing top-posts command:', error);
            await interaction.editReply({
                content: 'An error occurred while processing your request. Please try again later.',
                ephemeral: true,
            });
        }
    },
};
