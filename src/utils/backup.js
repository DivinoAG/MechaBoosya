'use strict';

// Opens a backup read-only and reports what is inside. Used by the restore drill: a backup that
// has never been opened is a hypothesis, not a safety net.

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const REQUIRED_TABLES = ['birthdays', 'announcements', 'settings'];

function count(db, table) {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

/**
 * @param {string} file
 * @returns {{ ok: true, file: string, birthdays: number, announcements: number, guilds: number, settingKeys: string[] }
 *   | { ok: false, file: string, reason: string }}
 */
function inspectBackup(file) {
    if (!fs.existsSync(file)) return { ok: false, file, reason: `file not found: ${file}` };

    let db;
    try {
        db = new DatabaseSync(file, { readOnly: true });
    } catch (error) {
        return { ok: false, file, reason: `could not open as sqlite: ${error.message}` };
    }

    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
        const missing = REQUIRED_TABLES.filter(name => !tables.includes(name));
        if (missing.length > 0) {
            return { ok: false, file, reason: `missing table(s): ${missing.join(', ')}` };
        }

        return {
            ok: true,
            file,
            birthdays: count(db, 'birthdays'),
            announcements: count(db, 'announcements'),
            guilds: Number(db.prepare('SELECT COUNT(DISTINCT guild_id) AS n FROM birthdays').get().n),
            settingKeys: db.prepare('SELECT key FROM settings ORDER BY key').all().map(row => row.key),
        };
    } catch (error) {
        return { ok: false, file, reason: `unreadable backup: ${error.message}` };
    } finally {
        db.close();
    }
}

module.exports = { inspectBackup, REQUIRED_TABLES };
