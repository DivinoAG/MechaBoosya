'use strict';

const { MessageFlags, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const { getStore } = require('../utils/birthday-store');
const { notify } = require('../utils/guild-log');
const {
    isValidDate, formatBirthday, announcementMessage, birthdayListMessage,
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
                return interaction.reply({ content: 'No birthdays registered in this server yet.', flags: MessageFlags.Ephemeral });
            }

            const payload = birthdayListMessage(interaction.guild.name, entries);
            const { page, pageCount, ...body } = payload;
            return interaction.reply(body);
        }

        if (sub === 'test') {
            if (!managerOnly(interaction)) {
                return interaction.reply({ content: 'Manage Server permission required.', flags: MessageFlags.Ephemeral });
            }
            const channelId = store.getSetting(guildId, 'announcement_channel');
            const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
            if (!channel) {
                return interaction.reply({ content: 'No announcement channel configured. Use `/birthday-config announcement-channel`.', flags: MessageFlags.Ephemeral });
            }
            const pingRole = store.getSetting(guildId, 'ping_role');
            // Sending takes as long as Discord takes: acknowledge before, report after.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                await channel.send({
                    content: pingRole ? `Test announcement for <@&${pingRole}>` : undefined,
                    ...announcementMessage(interaction.user.id),
                });
            } catch (error) {
                return interaction.editReply({ content: `Could not post in <#${channel.id}>: ${error.message}` });
            }
            return interaction.editReply({ content: `Test announcement posted in <#${channel.id}>.` });
        }

        if (sub === 'show') {
            const record = store.getBirthday(guildId, user.id);
            if (!record) {
                return interaction.reply({ content: isSelf ? 'You have not registered a birthday yet.' : `<@${user.id}> has not registered a birthday.`, flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({
                content: `<@${user.id}> — ${formatBirthday({ month: record.month, day: record.day, year: record.year })}`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'remove') {
            if (!isSelf && !managerOnly(interaction)) {
                return interaction.reply({ content: 'Manage Server permission required to remove someone else\'s birthday.', flags: MessageFlags.Ephemeral });
            }
            const removed = store.deleteBirthday(guildId, user.id);
            await interaction.reply({
                content: removed
                    ? (isSelf ? 'Your birthday was removed.' : `Removed the birthday of <@${user.id}>.`)
                    : (isSelf ? 'You had no birthday registered.' : `<@${user.id}> had no birthday registered.`),
                flags: MessageFlags.Ephemeral,
            });
            // The audit trail is best-effort and must never delay the answer: at 3.8 s the
            // interaction expired and the user saw nothing.
            if (removed) notify(interaction.client, store, guildId, `🗑️ ${user.tag} — birthday removed by ${interaction.user.tag}`).catch(() => {});
            return;
        }

        // register / update
        if (!isSelf && !managerOnly(interaction)) {
            return interaction.reply({ content: 'Manage Server permission required to set someone else\'s birthday.', flags: MessageFlags.Ephemeral });
        }

        const { month, day, year } = dateOptions(interaction.options);
        if (!isValidDate(month, day, year)) {
            return interaction.reply({
                content: `${day}/${month}${year ? `/${year}` : ''} is not a valid date (February 29 is allowed without a year).`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const existing = store.getBirthday(guildId, user.id);
        if (sub === 'register' && existing) {
            return interaction.reply({ content: 'That birthday is already registered. Use `/birthday update` to change it.', flags: MessageFlags.Ephemeral });
        }
        if (sub === 'update' && !existing) {
            return interaction.reply({ content: 'No birthday registered yet. Use `/birthday register` first.', flags: MessageFlags.Ephemeral });
        }

        store.upsertBirthday({ guildId, userId: user.id, month, day, year });

        const formatted = formatBirthday({ month, day, year });
        await interaction.reply({
            content: isSelf
                ? `Birthday saved: **${formatted}**.`
                : `Saved <@${user.id}>'s birthday: **${formatted}**.`,
            flags: MessageFlags.Ephemeral,
        });
        notify(
            interaction.client, store, guildId,
            `📝 ${user.tag} — birthday ${existing ? 'updated' : 'registered'} to ${formatted} by ${interaction.user.tag}`
        ).catch(() => {});
    },
};
