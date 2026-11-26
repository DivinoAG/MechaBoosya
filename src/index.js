require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { getStore } = require('./utils/birthday-store');
const { startBirthdayScheduler } = require('./utils/birthday-scheduler');

const HEARTBEAT_PATH = process.env.HEARTBEAT_PATH || '/data/run/child.heartbeat';
const DRAIN_MS = Number(process.env.DRAIN_MS || 60_000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
    ],
});

// One file per command in src/commands — adding a command means adding a file, nothing here changes.
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    const command = require(path.join(commandsDir, file));
    if (!command?.data?.name) {
        console.warn(`Skipping ${file}: no data.name export`);
        continue;
    }
    client.commands.set(command.data.name, command);
}
console.log(`Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ')}`);

let activeCommands = 0;
let draining = false;

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    const applicationId = process.env.DISCORD_CLIENT_ID || client.user.id;
    const guildId = process.env.DISCORD_GUILD_ID;

    try {
        const body = [...client.commands.values()].map(c => c.data.toJSON());
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
        console.log(`Registered ${body.length} command(s) on guild ${guildId}`);
    } catch (error) {
        console.error('Failed to register application commands:', error);
    }

    touchHeartbeat();
    setInterval(touchHeartbeat, 30_000).unref();

    startBirthdayScheduler(client, {
        store: getStore(),
        guildId,
        exportDir: process.env.EXPORT_DIR,
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (draining) {
        await interaction.reply({ content: 'Restarting, try again in a moment.', ephemeral: true }).catch(() => {});
        return;
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    activeCommands += 1;
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        const payload = { content: 'There was an error while executing this command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    } finally {
        activeCommands -= 1;
    }
});

function touchHeartbeat() {
    try {
        fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
        try {
            const now = new Date();
            fs.utimesSync(HEARTBEAT_PATH, now, now);
        } catch {
            fs.writeFileSync(HEARTBEAT_PATH, String(Date.now()));
        }
    } catch {
        // heartbeat is advisory; never take the bot down over it
    }
}

// Deploys signal SIGTERM: finish the command in flight, then close the gateway cleanly.
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        draining = true;
        console.log(`${sig} received, draining ${activeCommands} command(s)`);
        const deadline = Date.now() + DRAIN_MS;
        while (activeCommands > 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
        }
        if (activeCommands > 0) console.warn(`Drain timeout with ${activeCommands} command(s) still running`);
        await client.destroy().catch(() => {});
        process.exit(0);
    });
}

client.login(process.env.DISCORD_BOT_TOKEN);
