'use strict';

const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { getStore } = require('../utils/birthday-store');
const { ACCENT } = require('../utils/theme');
const {
    isValidDate, formatBirthday, groupByMonth, announcementMessage, MONTHS,
} = require('../utils/birthday');

function managerOnly(interaction) {
    return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
}

function targetUser(interaction) {
    return interaction.options.getUser('user') ?? interaction.user;
}

function dateOptions(options) {
    return {
        month: options.getInteger('month'),
        day: options.getInteger('day'),
        year: options.getInteger('year') ?? null,
    };
}

function upsert(builder) {
    return builder
        .addIntegerOption(o => o.setName('day').setDescription('Day of the month (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption(o => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption(o => o.setName('year').setDescription('Year of birth (optional)').setRequired(false).setMinValue(1900).setMaxValue(2100))
        .addUserOption(o => o.setName('user').setDescription('Set it for someone else (Manage Server only)').setRequired(false));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Birthday tracker')
        .addSubcommand(s => upsert(s.setName('register').setDescription('Register your birthday')))
        .addSubcommand(s => upsert(s.setName('update').setDescription('Update your birthday')))
        .addSubcommand(s => s
            .setName('remove')
            .setDescription('Remove a birthday')
            .addUserOption(o => o.setName('user').setDescription('Remove someone else\'s (Manage Server only)').setRequired(false)))
        .addSubcommand(s => s
            .setName('show')
            .setDescription('Show a birthday')
            .addUserOption(o => o.setName('user').setDescription('Whose birthday to show').setRequired(false)))
        .addSubcommand(s => s.setName('list').setDescription('List all birthdays in this server, by month'))
        .addSubcommand(s => s.setName('test').setDescription('Post a sample announcement for you (Manage Server only)')),

    async execute(interaction) {
        const store = getStore();
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();
        const user = targetUser(interaction);
        const isSelf = user.id === interaction.user.id;

        if (sub === 'list') {
            const entries = store.listBirthdays(guildId);
            if (entries.length === 0) {
                return interaction.reply({ content: 'No birthdays registered in this server yet.', ephemeral: true });
            }
            const groups = groupByMonth(entries);
            const description = groups
                .map(g => `**${g.label}**\n${g.text}`)
                .join('\n\n');
            const embed = {
                color: ACCENT,
                title: 'Birthday List',
                description: description.length > 4096 ? description.slice(0, 4093) + '…' : description,
                footer: { text: `${entries.length} birthday(s) registered` },
            };
            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'test') {
            if (!managerOnly(interaction)) {
                return interaction.reply({ content: 'Manage Server permission required.', ephemeral: true });
            }
            const channelId = store.getSetting(guildId, 'announcement_channel');
            const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
            if (!channel) {
                return interaction.reply({ content: 'No announcement channel configured. Use `/birthday-config announcement-channel`.', ephemeral: true });
            }
            const pingRole = store.getSetting(guildId, 'ping_role');
            await channel.send({
                content: pingRole ? `Test announcement for <@&${pingRole}>` : undefined,
                ...announcementMessage(interaction.user.id),
            });
            return interaction.reply({ content: `Test announcement posted in <#${channel.id}>.`, ephemeral: true });
        }

        if (sub === 'show') {
            const record = store.getBirthday(guildId, user.id);
            if (!record) {
                return interaction.reply({ content: isSelf ? 'You have not registered a birthday yet.' : `<@${user.id}> has not registered a birthday.`, ephemeral: true });
            }
            return interaction.reply({
                content: `<@${user.id}> — ${formatBirthday({ month: record.month, day: record.day, year: record.year })}`,
                ephemeral: true,
            });
        }

        if (sub === 'remove') {
            if (!isSelf && !managerOnly(interaction)) {
                return interaction.reply({ content: 'Manage Server permission required to remove someone else\'s birthday.', ephemeral: true });
            }
            const removed = store.deleteBirthday(guildId, user.id);
            return interaction.reply({
                content: removed
                    ? (isSelf ? 'Your birthday was removed.' : `Removed the birthday of <@${user.id}>.`)
                    : (isSelf ? 'You had no birthday registered.' : `<@${user.id}> had no birthday registered.`),
                ephemeral: true,
            });
        }

        // register / update
        if (!isSelf && !managerOnly(interaction)) {
            return interaction.reply({ content: 'Manage Server permission required to set someone else\'s birthday.', ephemeral: true });
        }

        const { month, day, year } = dateOptions(interaction.options);
        if (!isValidDate(month, day, year)) {
            return interaction.reply({
                content: `${day}/${month}${year ? `/${year}` : ''} is not a valid date (February 29 is allowed without a year).`,
                ephemeral: true,
            });
        }

        const existing = store.getBirthday(guildId, user.id);
        if (sub === 'register' && existing) {
            return interaction.reply({ content: 'That birthday is already registered. Use `/birthday update` to change it.', ephemeral: true });
        }
        if (sub === 'update' && !existing) {
            return interaction.reply({ content: 'No birthday registered yet. Use `/birthday register` first.', ephemeral: true });
        }

        store.upsertBirthday({ guildId, userId: user.id, month, day, year });

        const formatted = formatBirthday({ month, day, year });
        return interaction.reply({
            content: isSelf
                ? `Birthday saved: **${formatted}**.`
                : `Saved <@${user.id}>'s birthday: **${formatted}**.`,
            ephemeral: true,
        });
    },
};
