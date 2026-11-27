const { ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');
const { fetchForumThreads, fetchInitialMessage } = require('./discord-api');
const { generateReportString } = require('./report-generator');
const { formatDiscordMessage } = require('./message-formatter');
const { writeRankingExport, pruneExports, findFreshExport } = require('./exports');
const { createScanCoordinator, renderProgress } = require('./scan-coordinator');

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_HOURS || 3) * 3_600_000;
const FETCH_DELAY_MS = Number(process.env.FETCH_DELAY_MS || 200);
const PROGRESS_MIN_POSTS = Number(process.env.PROGRESS_MIN_POSTS || 50);
const PROGRESS_INTERVAL_MS = Number(process.env.PROGRESS_INTERVAL_MS || 5_000);

// Module-level so every command invocation in this process shares one scan per channel.
const scans = createScanCoordinator();

function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    const minutes = Math.floor(total / 60);
    return `${minutes}m${String(total % 60).padStart(2, '0')}s`;
}

function progressText(channelName, done, total, elapsedMs) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `🔍 Scanning #${channelName} — ${done} / ${total} posts (${pct}%) · ${formatDuration(elapsedMs)}`;
}

// Who asked, with a name next to the id so a log line read from Dockge is legible.
function requester(interaction) {
    return `user=${interaction.user?.id ?? 'unknown'}(${interaction.user?.username ?? 'unknown'})`;
}

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

// The scan itself. Callers that arrive mid-scan share this run and its progress.
async function scanForum(channel, progress, { requestedBy, limit, api }) {
    const threads = await api.fetchForumThreads(channel);
    progress.total = threads.length;
    console.log(`Found ${threads.length} threads in total.`);

    const defaultReactionEmoji = channel.defaultReactionEmoji;
    const threadData = [];
    // A post we cannot read is not a post with zero votes: it is missing, and saying so is the
    // difference between a ranking and a lie.
    let failures = 0;

    for (const thread of threads) {
        try {
            const initialMessage = await api.fetchInitialMessage(thread);
            if (!initialMessage) {
                failures += 1;
            } else {
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
        } catch (error) {
            failures += 1;
            console.error(`[ranking] could not read thread ${thread.id}: ${error.message}`);
        }

        progress.done += 1;
        await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS));
    }

    threadData.sort((a, b) => b.reactionCount - a.reactionCount);

    // Archive the full sorted list (unlimited) for the wiki ingest; the report may be truncated.
    try {
        const exportFile = writeRankingExport(channel.id, threadData, {
            channelName: channel.name,
            requestedBy,
            limit,
            failures,
        });
        console.log(`Ranking export written to ${exportFile}`);
        const pruned = pruneExports();
        if (pruned.length > 0) console.log(`Pruned ${pruned.length} expired export(s)`);
    } catch (exportError) {
        console.error('Failed to write ranking export:', exportError);
    }

    return { threads: threadData, failures };
}

const DISCORD_API = { fetchForumThreads, fetchInitialMessage };

// `api` is injectable so tests can drive the whole flow without a Discord connection.
async function runRanking(interaction, { force = false, api = DISCORD_API } = {}) {
    if (!interaction.memberPermissions?.has('MANAGE_CHANNELS')) {
        return interaction.reply({
            content: 'You do not have permission to use this command.',
            flags: MessageFlags.Ephemeral,
        });
    }

    const channel = interaction.options.getChannel('channel');
    const numberOfPosts = interaction.options.getInteger('number_of_posts');
    const directMessage = interaction.options.getBoolean('direct_message');

    if (channel.type !== ChannelType.GuildForum) {
        return interaction.reply({
            content: 'The selected channel is not a forum channel. Please select a forum channel.',
            flags: MessageFlags.Ephemeral,
        });
    }

    if (!channel.defaultReactionEmoji) {
        return interaction.reply({
            content: `The forum channel "${channel.name}" does not have a default reaction emoji configured. Cannot process top posts.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    const botPermissions = channel.permissionsFor(interaction.client.user);
    if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel) || !botPermissions.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        return interaction.reply({
            content: 'I need "View Channel" and "Read Message History" permissions in the selected forum channel to work properly.',
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: directMessage ? MessageFlags.Ephemeral : undefined });

    try {
        let threadData;
        let failures = 0;
        /** @type {{ payload: any, ageMs: number, file: string } | null} */
        let cached = null;

        if (!force) {
            cached = findFreshExport(channel.id, CACHE_TTL_MS);
        }

        if (cached) {
            threadData = cached.payload.threads;
            console.log(`Serving cached ranking for ${channel.id}, ${formatAge(cached.ageMs)} old (${threadData.length} posts) — ${requester(interaction)}`);
        } else {
            console.log(`Fetching forum threads... (triggered by /${force ? 'forum-rank-force' : 'forum-rank'} ${requester(interaction)} channel=${channel.name}(${channel.id}))`);

            // A second caller joins the scan already in flight and renders identical progress.
            const { state, joined } = scans.join(channel.id, progress => scanForum(channel, progress, {
                requestedBy: interaction.user.id,
                limit: numberOfPosts || null,
                api,
            }));
            if (joined) console.log(`Joined the running scan for ${channel.id} — ${requester(interaction)}`);

            const rendering = renderProgress({
                interaction,
                state,
                intervalMs: PROGRESS_INTERVAL_MS,
                format: (progress, elapsedMs) => (progress.total >= PROGRESS_MIN_POSTS
                    ? progressText(channel.name, progress.done, progress.total, elapsedMs)
                    : null),
            });

            try {
                const result = await state.promise;
                threadData = result.threads;
                failures = result.failures;
            } finally {
                await rendering;
            }
        }

        const sorted = [...threadData].sort((a, b) => b.reactionCount - a.reactionCount);
        const finalThreadData = numberOfPosts ? sorted.slice(0, numberOfPosts) : sorted;
        const footerParts = [];
        if (cached) footerParts.push(`Cached results from ${formatAge(cached.ageMs)} ago`, `${threadData.length} posts`);
        if (failures > 0) footerParts.push(`${failures} post${failures === 1 ? '' : 's'} unreadable`);
        const footer = footerParts.length > 0 ? footerParts.join(' · ') : null;

        // Nothing to report: the interaction is deferred, so it must be answered or the user
        // stares at "thinking" until the token expires.
        if (finalThreadData.length === 0) {
            return interaction.editReply({
                content: failures > 0
                    ? `No posts could be read from #${channel.name} — ${failures} could not be read.`
                    : `No posts found in #${channel.name}.`,
                flags: MessageFlags.Ephemeral,
            });
        }

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
            await interaction.editReply({ content: 'Report sent to your DMs.', flags: MessageFlags.Ephemeral });
        }

    } catch (error) {
        console.error('Error processing top-posts command:', error);
        await interaction.editReply({
            content: 'An error occurred while processing your request. Please try again later.',
            flags: MessageFlags.Ephemeral,
        });
    }
}

module.exports = { runRanking, addRankingOptions, progressText, requester, CACHE_TTL_MS };
