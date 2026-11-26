const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { ACCENT } = require('../utils/theme');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List the commands MechaBoosya provides'),

    async execute(interaction) {
        const visible = [...interaction.client.commands.values()].filter(command => {
            const required = command.data.default_member_permissions;
            if (!required) return true;
            return interaction.memberPermissions?.has(BigInt(required)) ?? false;
        });

        const lines = visible.map(command => {
            const subcommands = (command.data.options ?? [])
                .filter(option => option.type === 1)
                .map(option => option.name);
            const suffix = subcommands.length > 0 ? `\n  ↳ ${subcommands.join(', ')}` : '';
            return `**/${command.data.name}** — ${command.data.description}${suffix}`;
        });

        const isManager = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
        if (isManager) lines.push('\n_Commands requiring Manage Server are only listed for managers._');

        return interaction.reply({
            embeds: [{ color: ACCENT, title: 'MechaBoosya commands', description: lines.join('\n\n') }],
            ephemeral: true,
        });
    },
};
