'use strict';

// A readable count of what the bot holds, next to the exports. The live database sits inside the
// container and cannot be read from outside, so without this every count quoted from the agent
// side is only as fresh as the last daily snapshot.

const fs = require('node:fs');
const path = require('node:path');
const { effectiveConfig } = require('./config');

function statsDir() {
    return process.env.EXPORT_DIR || path.resolve(process.cwd(), 'exports');
}

// Best-effort: a stats file is a convenience, never a reason to fail a registration.
function writeStats(store, guildId) {
    try {
        const dir = statsDir();
        fs.mkdirSync(dir, { recursive: true });

        const file = path.join(dir, 'stats.json');
        const tmp = `${file}.tmp`;
        const payload = {
            generatedAt: new Date().toISOString(),
            guildId,
            birthdays: store.listBirthdays(guildId).length,
            announcements: store.countAnnouncements(guildId),
            config: effectiveConfig(),
        };

        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
        fs.renameSync(tmp, file);
        return file;
    } catch (error) {
        console.error('[stats] could not write stats.json:', error.message);
        return null;
    }
}

module.exports = { writeStats };
