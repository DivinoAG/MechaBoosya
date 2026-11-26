'use strict';

// The dispatch path without discord.js wiring: loading command files and handling an
// interaction are pure enough to test, so they live here rather than in index.js.

const fs = require('node:fs');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { handleListButton } = require('./utils/list-buttons');

function loadCommands(dir, requireFn = require) {
    const commands = new Map();
    const skipped = [];

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
        const command = requireFn(path.join(dir, file));
        if (!command?.data?.name) {
            skipped.push(file);
            continue;
        }
        commands.set(command.data.name, command);
    }

    return { commands, skipped };
}

function createDispatcher({ commands, store, log = console, listButton = handleListButton }) {
    let active = 0;
    let draining = false;

    async function handle(interaction) {
        if (interaction.isButton?.() && interaction.customId?.startsWith('blist:')) {
            return listButton(interaction, store).catch(error => log.error('[cmd] list button failed:', error));
        }

        if (!interaction.isChatInputCommand?.()) return;

        const context = `[cmd] /${interaction.commandName} user=${interaction.user?.id}(${interaction.user?.username ?? 'unknown'}) guild=${interaction.guildId} channel=${interaction.channelId}`;

        if (draining) {
            log.warn(`${context} rejected: draining`);
            await interaction.reply({ content: 'Restarting, try again in a moment.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const command = commands.get(interaction.commandName);
        if (!command) {
            log.error(`${context} no handler registered`);
            return;
        }

        active += 1;
        const startedAt = Date.now();
        log.log(`${context} start`);

        try {
            await command.execute(interaction);
            log.log(`${context} ok in ${Date.now() - startedAt}ms`);
        } catch (error) {
            log.error(`${context} FAILED after ${Date.now() - startedAt}ms:`, error);
            const payload = { content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral };
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload);
                } else {
                    await interaction.reply(payload);
                }
            } catch (replyError) {
                // Interaction expired (>3s without a reply) or the reply itself was rejected.
                log.error(`${context} could not deliver the error reply:`, replyError);
            }
        } finally {
            active -= 1;
        }
    }

    return {
        handle,
        startDraining() { draining = true; },
        get activeCount() { return active; },
    };
}

module.exports = { loadCommands, createDispatcher };
