'use strict';

// Command reference shown by /help. Static on purpose: argument lists and one-line descriptions
// live here, because a slash command's own `description` is a sentence, not a manual.
// `help.test.js` fails if a command file exists that this manifest never mentions.

const { MessageFlags, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const { ACCENT } = require('../utils/theme');

const ANYONE = null;
const MANAGE_SERVER = PermissionsBitField.Flags.ManageGuild;

const SECTIONS = [
    {
        header: '🎂 **Birthdays**',
        entries: [
            { command: '/birthday register', args: ['day', 'month', '[year]'], text: 'Save your birthday. Managers can set it for someone else.', need: ANYONE },
            { command: '/birthday update', args: ['day', 'month', '[year]'], text: 'Change a birthday you already saved.', need: ANYONE },
            { command: '/birthday remove', args: [], text: 'Delete your birthday.', need: ANYONE },
            { command: '/birthday show', args: ['[user]'], text: 'See one birthday.', need: ANYONE },
            { command: '/birthday list', args: [], text: 'The whole list, with page buttons and a refresh button.', need: ANYONE },
        ],
    },
    {
        header: '📊 **Forum rankings**',
        entries: [
            { command: '/forum-rank', args: ['channel', '[number_of_posts]', '[direct_message]', '[include_finished]'], text: 'Top posts by reaction count — from the archive when it is recent.', need: ANYONE },
            { command: '/forum-rank-force', args: ['channel', '[number_of_posts]', '[direct_message]', '[include_finished]'], text: 'The same report, always rescanning every post.', need: MANAGE_SERVER },
        ],
    },
    {
        header: '⚙️ **Birthday configuration**',
        entries: [
            { command: '/birthday-config status', args: [], text: 'What is set right now, and how many birthdays are registered.', need: MANAGE_SERVER },
            { command: '/birthday-config announcement-channel', args: ['[channel]'], text: 'Where announcements go. Empty turns them off.', need: MANAGE_SERVER },
            { command: '/birthday-config ping-role', args: ['[role]'], text: 'Role pinged with each announcement.', need: MANAGE_SERVER },
            { command: '/birthday-config birthday-role', args: ['[role]'], text: 'Role granted for the day and taken back afterwards.', need: MANAGE_SERVER },
            { command: '/birthday-config log-channel', args: ['[channel]'], text: 'Where birthday changes are recorded.', need: MANAGE_SERVER },
            { command: '/birthday-config monthly', args: ['mode', '[channel]'], text: 'The pinned "upcoming birthdays" post.', need: MANAGE_SERVER },
            { command: '/birthday-config timezone', args: ['value'], text: 'The time zone that decides which day it is.', need: MANAGE_SERVER },
            { command: '/birthday test', args: [], text: 'Post a sample announcement for yourself.', need: MANAGE_SERVER },
        ],
    },
    {
        header: '❓ **General**',
        entries: [
            { command: '/help', args: [], text: 'This message.', need: ANYONE },
        ],
    },
];

function allows(permissions, need) {
    if (need === ANYONE) return true;
    return permissions?.has(need) ?? false;
}

function line({ command, args, text }) {
    const suffix = args.map(arg => ` \`${arg}\``).join('');
    return `\`${command}\`${suffix} — ${text}`;
}

// Only the sections the caller can act on, so the list never advertises a refusal.
function render(permissions) {
    return SECTIONS
        .map(section => ({
            header: section.header,
            entries: section.entries.filter(entry => allows(permissions, entry.need)),
        }))
        .filter(section => section.entries.length > 0)
        .map(section => `${section.header}\n${section.entries.map(line).join('\n')}`)
        .join('\n\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List the commands MechaBoosya provides'),

    async execute(interaction) {
        return interaction.reply({
            embeds: [{ color: ACCENT, title: '🎂 MechaBoosya — Commands', description: render(interaction.memberPermissions) }],
            flags: MessageFlags.Ephemeral,
        });
    },

    // Exported for the tests: the reference is data, so it can be checked without a client.
    SECTIONS,
    render,
};
