'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_TIMEZONE, ANNOUNCE_AFTER_MINUTE, zonedParts, dateKey, matchesToday, announcementMessage } = require('./birthday');
const { pruneExports } = require('./exports');

// Posts today's birthdays once per person (unique row = idempotent) and keeps a daily DB snapshot.
// Local time is what counts: a boot at 14:00 still announces, hence same-day catch-up for free.
function startBirthdayScheduler(client, { store, guildId, exportDir = process.env.EXPORT_DIR, intervalMs = 60_000 }) {
    let busy = false;
    let lastSnapshot = null;

    async function tick() {
        const settings = store.allSettings(guildId);
        const timeZone = settings.timezone || DEFAULT_TIMEZONE;
        const now = zonedParts(new Date(), timeZone);

        if (now.hour * 60 + now.minute < ANNOUNCE_AFTER_MINUTE) return;

        const key = dateKey(now);

        const candidates = [...store.birthdaysOn(guildId, now.month, now.day)];
        if (now.month === 3 && now.day === 1) candidates.push(...store.birthdaysOn(guildId, 2, 29));

        for (const person of candidates) {
            if (!matchesToday(person, now)) continue;

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
            } catch (error) {
                // Not recorded, so the next tick retries rather than silently losing the day.
                console.error(`[birthday] failed to announce ${person.user_id}:`, error.message);
            }
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
