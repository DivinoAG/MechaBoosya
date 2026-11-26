'use strict';

const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { getStore } = require('../utils/birthday-store');
const { ACCENT } = require('../utils/theme');
const { DEFAULT_TIMEZONE, isValidTimeZone } = require('../utils/birthday');

function managerOnly(interaction) {
    return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday-config')
        .setDescription('Configure birthday announcements (Manage Server only)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(s => s.setName('status').setDescription('Show the current birthday configuration'))
        .addSubcommand(s => s
            .setName('announcement-channel')
            .setDescription('Channel where birthday announcements are posted')
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Leave empty to disable announcements')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)))
        .addSubcommand(s => s
            .setName('ping-role')
            .setDescription('Role pinged with each announcement')
            .addRoleOption(o => o.setName('role').setDescription('Leave empty to stop pinging a role').setRequired(false)))
        .addSubcommand(s => s
            .setName('timezone')
            .setDescription('Time zone used to decide which day it is')
            .addStringOption(o => o.setName('value').setDescription('IANA name, e.g. America/Sao_Paulo (default UTC)').setRequired(true)))
        .addSubcommand(s => s
            .setName('birthday-role')
            .setDescription('Role given to members on their birthday, removed the next day')
            .addRoleOption(o => o.setName('role').setDescription('Leave empty to stop using a role').setRequired(false)))
        .addSubcommand(s => s
            .setName('monthly')
            .setDescription('Pinned "upcoming birthdays" post, refreshed daily')
            .addStringOption(o => o
                .setName('mode')
                .setDescription('Where the monthly post goes')
                .setRequired(true)
                .addChoices(
                    { name: 'Announcement channel', value: 'announcement' },
                    { name: 'Custom channel', value: 'custom' },
                    { name: 'Off', value: 'off' },
                ))
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Required when mode is Custom channel')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)))
        .addSubcommand(s => s
            .setName('log-channel')
            .setDescription('Channel where birthday changes are logged')
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Leave empty to disable logging')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false))),

    async execute(interaction) {
        if (!managerOnly(interaction)) {
            return interaction.reply({ content: 'Manage Server permission required.', ephemeral: true });
        }

        const store = getStore();
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
            const settings = store.allSettings(guildId);
            const lines = [
                `**Announcement channel:** ${settings.announcement_channel ? `<#${settings.announcement_channel}>` : 'not set (announcements disabled)'}`,
                `**Ping role:** ${settings.ping_role ? `<@&${settings.ping_role}>` : 'none'}`,
                `**Birthday role:** ${settings.birthday_role ? `<@&${settings.birthday_role}>` : 'none'}`,
                `**Log channel:** ${settings.log_channel ? `<#${settings.log_channel}>` : 'none'}`,
                `**Monthly post:** ${settings.monthly_mode === 'off' ? 'off' : settings.monthly_mode === 'custom' ? `<#${settings.monthly_channel}>` : 'announcement channel (default)'}`,
                `**Timezone:** ${settings.timezone || `${DEFAULT_TIMEZONE} (default)`}`,
                `**Registered birthdays:** ${store.listBirthdays(guildId).length}`,
                `**Announcement time:** 00:05 local time`,
            ];
            return interaction.reply({
                embeds: [{ color: ACCENT, title: 'Birthday Configuration', description: lines.join('\n') }],
                ephemeral: true,
            });
        }

        if (sub === 'announcement-channel') {
            const channel = interaction.options.getChannel('channel');
            store.setSetting(guildId, 'announcement_channel', channel ? channel.id : null);
            return interaction.reply({
                content: channel ? `Announcements will be posted in <#${channel.id}>.` : 'Announcements disabled (no channel set).',
                ephemeral: true,
            });
        }

        if (sub === 'ping-role') {
            const role = interaction.options.getRole('role');
            store.setSetting(guildId, 'ping_role', role ? role.id : null);
            return interaction.reply({
                content: role ? `Announcements will ping <@&${role.id}>.` : 'Role ping disabled.',
                ephemeral: true,
            });
        }

        if (sub === 'monthly') {
            const mode = interaction.options.getString('mode');
            const channel = interaction.options.getChannel('channel');

            if (mode === 'custom' && !channel) {
                return interaction.reply({ content: 'Pick a channel when using custom mode.', ephemeral: true });
            }

            store.setSetting(guildId, 'monthly_mode', mode);
            store.setSetting(guildId, 'monthly_channel', mode === 'custom' ? channel.id : null);

            const where = mode === 'custom' ? `<#${channel.id}>` : 'the announcement channel';
            return interaction.reply({
                content: mode === 'off'
                    ? 'Monthly upcoming-birthdays post disabled.'
                    : `Monthly post will go to ${where}: posted on the last day of each month, pinned, refreshed daily. The bot needs Manage Messages to pin.`,
                ephemeral: true,
            });
        }

        if (sub === 'birthday-role') {
            const role = interaction.options.getRole('role');
            store.setSetting(guildId, 'birthday_role', role ? role.id : null);
            return interaction.reply({
                content: role
                    ? `Members will receive <@&${role.id}> on their birthday. Keep the bot's role above it, or assignment will fail.`
                    : 'Birthday role disabled.',
                ephemeral: true,
            });
        }

        if (sub === 'log-channel') {
            const channel = interaction.options.getChannel('channel');
            store.setSetting(guildId, 'log_channel', channel ? channel.id : null);
            return interaction.reply({
                content: channel ? `Birthday changes will be logged in <#${channel.id}>.` : 'Logging disabled.',
                ephemeral: true,
            });
        }

        // timezone
        const value = interaction.options.getString('value').trim();
        if (!isValidTimeZone(value)) {
            return interaction.reply({
                content: `\`${value}\` is not a valid IANA time zone. Try \`America/Sao_Paulo\`, \`Europe/Lisbon\` or \`UTC\`.`,
                ephemeral: true,
            });
        }
        store.setSetting(guildId, 'timezone', value);
        return interaction.reply({ content: `Timezone set to \`${value}\`.`, ephemeral: true });
    },
};
