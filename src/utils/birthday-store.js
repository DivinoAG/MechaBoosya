'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS birthdays (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    year       INTEGER,
    updated_at TEXT    NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS announcements (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    event_date TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, event_date)
);
CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (guild_id, key)
);
CREATE TABLE IF NOT EXISTS monthly_posts (
    guild_id   TEXT    PRIMARY KEY,
    month      INTEGER NOT NULL,
    channel_id TEXT    NOT NULL,
    message_id TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
`;

function openStore(file = process.env.DB_PATH || '/data/db/mecha-boosya.sqlite') {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

    const db = new DatabaseSync(file);
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);

    return {
        db,

        upsertBirthday({ guildId, userId, month, day, year = null }) {
            db.prepare(`
                INSERT INTO birthdays (guild_id, user_id, month, day, year, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    month = excluded.month,
                    day = excluded.day,
                    year = excluded.year,
                    updated_at = excluded.updated_at
            `).run(guildId, userId, month, day, year, new Date().toISOString());
        },

        getBirthday(guildId, userId) {
            return db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?').get(guildId, userId) ?? null;
        },

        deleteBirthday(guildId, userId) {
            const res = db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
            return res.changes > 0;
        },

        listBirthdays(guildId) {
            return db.prepare(
                'SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ? ORDER BY month, day, user_id'
            ).all(guildId);
        },

        birthdaysOn(guildId, month, day) {
            return db.prepare(
                'SELECT user_id, month, day, year FROM birthdays WHERE guild_id = ? AND month = ? AND day = ? ORDER BY user_id'
            ).all(guildId, month, day);
        },

        // Returns true only for the first call for that person and date — the idempotency guard.
        recordAnnouncement(guildId, userId, eventDate) {
            const res = db.prepare(
                'INSERT OR IGNORE INTO announcements (guild_id, user_id, event_date) VALUES (?, ?, ?)'
            ).run(guildId, userId, eventDate);
            return res.changes > 0;
        },

        wasAnnounced(guildId, userId, eventDate) {
            return Boolean(db.prepare(
                'SELECT 1 FROM announcements WHERE guild_id = ? AND user_id = ? AND event_date = ?'
            ).get(guildId, userId, eventDate));
        },

        getSetting(guildId, key) {
            const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
            return row ? row.value : null;
        },

        setSetting(guildId, key, value) {
            if (value === null || value === undefined) {
                db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?').run(guildId, key);
                return;
            }
            db.prepare(`
                INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
            `).run(guildId, key, String(value));
        },

        allSettings(guildId) {
            const rows = db.prepare('SELECT key, value FROM settings WHERE guild_id = ?').all(guildId);
            return Object.fromEntries(rows.map(r => [r.key, r.value]));
        },

        // The single pinned "upcoming birthdays" message per guild.
        getMonthlyPost(guildId) {
            return db.prepare('SELECT * FROM monthly_posts WHERE guild_id = ?').get(guildId) ?? null;
        },

        setMonthlyPost({ guildId, month, channelId, messageId }) {
            db.prepare(`
                INSERT INTO monthly_posts (guild_id, month, channel_id, message_id, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    month = excluded.month,
                    channel_id = excluded.channel_id,
                    message_id = excluded.message_id,
                    updated_at = excluded.updated_at
            `).run(guildId, month, channelId, messageId, new Date().toISOString());
        },

        clearMonthlyPost(guildId) {
            db.prepare('DELETE FROM monthly_posts WHERE guild_id = ?').run(guildId);
        },

        snapshotTo(file) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
            return file;
        },
    };
}

/** @type {ReturnType<typeof openStore> | null} */
let singleton = null;
/** @returns {ReturnType<typeof openStore>} a process-wide singleton */
function getStore() {
    if (!singleton) singleton = openStore();
    return singleton;
}

module.exports = { openStore, getStore };
