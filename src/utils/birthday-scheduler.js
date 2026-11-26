'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_TIMEZONE, ANNOUNCE_AFTER_MINUTE, zonedParts, dateKey, matchesToday, announcementMessage } = require('./birthday');
const { pruneExports } = require('./exports');
const { notify } = require('./guild-log');

// Posts today's birthdays once per person (unique row = idempotent) and keeps a daily DB snapshot.
// Local time is what counts: a boot at 14:00 still announces, hence same-day catch-up for free.
function startBirthdayScheduler(client, { store, guildId, exportDir = process.env.EXPORT_DIR, intervalMs = 60_000 }) {
    let busy = false;
    let lastSnapshot = null;
    let lastRoleSync = null;

    // Birthday role is synced once per day (and once per boot); members who left are skipped.
    async function syncRole(settings, celebrants) {
        const roleId = settings.birthday_role;
        if (!roleId) return;

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        const role = guild ? await guild.roles.fetch(roleId).catch(() => null) : null;
        if (!guild || !role) {
            console.error(`[birthday] birthday role ${roleId} not found`);
            return;
        }

        const me = guild.members.me;
        if (me && me.roles.highest.position <= role.position) {
            console.warn('[birthday] birthday role sits above the bot role; cannot assign');
            return;
        }

        await guild.members.fetch().catch(() => {});
        const changed = [];

        for (const id of celebrants) {
            const member = guild.members.cache.get(id);
            if (member && !member.roles.cache.has(roleId)) {
                await member.roles.add(role).catch(error => console.error('[birthday] role add failed:', error.message));
                changed.push(`+<@${id}>`);
            }
        }

        for (const member of role.members.values()) {
            if (!celebrants.has(member.id)) {
                await member.roles.remove(role).catch(error => console.error('[birthday] role remove failed:', error.message));
                changed.push(`-<@${member.id}>`);
            }
        }

        if (changed.length > 0) {
            console.log(`[birthday] role sync: ${changed.join(' ')}`);
            await notify(client, store, guildId, `🎭 Birthday role updated: ${changed.join(' ')}`);
        }
    }

    async function tick() {
        const settings = store.allSettings(guildId);
        const timeZone = settings.timezone || DEFAULT_TIMEZONE;
        const now = zonedParts(new Date(), timeZone);

        if (now.hour * 60 + now.minute < ANNOUNCE_AFTER_MINUTE) return;

        const key = dateKey(now);

        const candidates = [...store.birthdaysOn(guildId, now.month, now.day)];
        if (now.month === 3 && now.day === 1) candidates.push(...store.birthdaysOn(guildId, 2, 29));

        const celebrants = new Set();

        for (const person of candidates) {
            if (!matchesToday(person, now)) continue;
            celebrants.add(person.user_id);

            const channelId = settings.announcement_channel;
            if (!channelId) break;

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                console.error(`[birthday] channel ${channelId} not reachable`);
                break;
            }

            try {
                await channel.send({
                    content: settings.ping_role ? `<@&${settings.ping_role}>` : undefined,
                    ...announcementMessage(person.user_id),
                });
                store.recordAnnouncement(guildId, person.user_id, key);
                console.log(`[birthday] announced ${person.user_id} for ${key}`);
                await notify(client, store, guildId, `🎂 Announced birthday for <@${person.user_id}> (${key})`);
            } catch (error) {
                // Not recorded, so the next tick retries rather than silently losing the day.
                console.error(`[birthday] failed to announce ${person.user_id}:`, error.message);
            }
        }

        if (settings.birthday_role && lastRoleSync !== key) {
            await syncRole(settings, celebrants);
            lastRoleSync = key;
        }

        if (exportDir && lastSnapshot !== key) {
            try {
                const file = path.join(exportDir, `db-${key}.sqlite`);
                if (!fs.existsSync(file)) {
                    store.snapshotTo(file);
                    pruneExports({ dir: exportDir });
                    console.log(`[birthday] snapshot written to ${file}`);
                }
                lastSnapshot = key;
            } catch (error) {
                console.error('[birthday] snapshot failed:', error.message);
            }
        }
    }

    const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        tick().catch(error => console.error('[birthday] tick failed:', error.message)).finally(() => { busy = false; });
    }, intervalMs);
    timer.unref();

    // Run once at startup: catches up the same day and writes today's snapshot after a deploy.
    tick().catch(error => console.error('[birthday] initial tick failed:', error.message));

    return { stop: () => clearInterval(timer), tick };
}

module.exports = { startBirthdayScheduler };
