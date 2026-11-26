const { ChannelType, PermissionsBitField } = require('discord.js');
const { fetchForumThreads, fetchInitialMessage } = require('./discord-api');
const { generateReportString } = require('./report-generator');
const { formatDiscordMessage } = require('./message-formatter');
const { writeRankingExport, pruneExports, findFreshExport } = require('./exports');

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_HOURS || 3) * 3_600_000;
const FETCH_DELAY_MS = Number(process.env.FETCH_DELAY_MS || 200);

// Shared by /forum-rank and /forum-rank-force so the two stay identical.
function addRankingOptions(builder) {
    return builder
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
        );
}

function formatAge(ms) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

async function runRanking(interaction, { force = false } = {}) {
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
        let threadData;
        let cached = null;

        if (!force) {
            cached = findFreshExport(channel.id, CACHE_TTL_MS);
        }

        if (cached) {
            threadData = cached.payload.threads;
            console.log(`Serving cached ranking for ${channel.id}, ${formatAge(cached.ageMs)} old (${threadData.length} posts)`);
        } else {
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

            threadData = [];
            let processedCount = 0;
            for (const thread of threads) {
                console.log(`Processing thread ${++processedCount}/${threads.length}: ${thread.name}`);
                const initialMessage = await fetchInitialMessage(thread);
                if (initialMessage) {
                    const reaction = initialMessage.reactions.cache.find(
                        r => (defaultReactionEmoji.id && r.emoji.id === defaultReactionEmoji.id) ||
                             (defaultReactionEmoji.name && r.emoji.name === defaultReactionEmoji.name)
                    );
                    threadData.push({
                        name: thread.name,
                        reactionCount: reaction ? reaction.count : 0,
                        tags: thread.appliedTags.map(tagId => channel.availableTags.find(tag => tag.id === tagId)?.name).filter(Boolean),
                    });
                }
                await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS));
            }

            threadData.sort((a, b) => b.reactionCount - a.reactionCount);

            // Archive the full sorted list (unlimited) for the wiki ingest; the report below may be truncated.
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
        }

        const sorted = [...threadData].sort((a, b) => b.reactionCount - a.reactionCount);
        const finalThreadData = numberOfPosts ? sorted.slice(0, numberOfPosts) : sorted;
        const footer = cached ? `Cached results from ${formatAge(cached.ageMs)} ago` : null;

        const chunkSize = 50;
        for (let i = 0; i < finalThreadData.length; i += chunkSize) {
            const chunk = finalThreadData.slice(i, i + chunkSize);
            const reportString = generateReportString(chunk, i);
            const title = `Top forum posts by reactions (Entries ${i + 1}-${i + chunk.length})`;
            const messageOptions = formatDiscordMessage(reportString, title, i === 0 ? footer : null);

            if (directMessage) {
                await interaction.user.send(messageOptions);
            } else if (i === 0) {
                await interaction.editReply(messageOptions);
            } else {
                await interaction.channel.send(messageOptions);
            }
        }

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
}

module.exports = { runRanking, addRankingOptions, CACHE_TTL_MS };
