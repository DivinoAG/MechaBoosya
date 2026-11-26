'use strict';

const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { getStore } = require('../utils/birthday-store');
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
            .addStringOption(o => o.setName('value').setDescription('IANA name, e.g. America/Sao_Paulo (default UTC)').setRequired(true))),

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
                `**Timezone:** ${settings.timezone || `${DEFAULT_TIMEZONE} (default)`}`,
                `**Registered birthdays:** ${store.listBirthdays(guildId).length}`,
                `**Announcement time:** 00:05 local time`,
            ];
            return interaction.reply({
                embeds: [{ color: 0xbAd7e6, title: 'Birthday Configuration', description: lines.join('\n') }],
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
