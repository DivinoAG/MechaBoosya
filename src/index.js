require('dotenv').config();
const logger = require('./utils/logger');
logger.install({ name: 'bot' });

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const { getStore } = require('./utils/birthday-store');
const { startBirthdayScheduler } = require('./utils/birthday-scheduler');
const { loadCommands, createDispatcher } = require('./runtime');

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

client.on('error', error => console.error('[client] error:', error));
client.on('warn', warning => console.warn('[client] warn:', warning));
client.rest.on('rateLimited', info => console.warn('[rest] rate limited:', info));

// One file per command in src/commands — adding a command means adding a file, nothing here changes.
const { commands, skipped } = loadCommands(path.join(__dirname, 'commands'));
for (const file of skipped) console.warn(`Skipping ${file}: no data.name export`);
client.commands = new Collection(commands);
console.log(`Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ')}`);

const dispatcher = createDispatcher({ commands: client.commands, store: getStore(), log: console });

const activeCommands = () => dispatcher.activeCount;

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

client.on('interactionCreate', interaction => dispatcher.handle(interaction));

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
        dispatcher.startDraining();
        console.log(`${sig} received, draining ${activeCommands()} command(s)`);
        const deadline = Date.now() + DRAIN_MS;
        while (activeCommands() > 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
        }
        if (activeCommands() > 0) console.warn(`Drain timeout with ${activeCommands()} command(s) still running`);
        await client.destroy().catch(() => {});
        process.exit(0);
    });
}

client.login(process.env.DISCORD_BOT_TOKEN);
