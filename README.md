# MechaBoosya

Discord bot for a single community server. Two features: forum post rankings by reaction count, and a birthday tracker with daily announcements.

Runs as a Node process inside its own container, supervised by `src/supervisor.js`, which exposes a small HTTP API for deploys and health.

## Commands

| Command | Who can run it | What it does |
|---|---|---|
| `/forum-rank` | Manage Channels | Ranks threads in a forum channel by the count of the channel's default reaction on the opening post. Served from the newest export when it is younger than `CACHE_TTL_HOURS`. |
| `/forum-rank-force` | Manage Server (hidden from others) | Same report, always rescans every thread. |
| `/birthday register` | Everyone (self) | `day`, `month`, optional `year`, optional `user` for others (managers only). |
| `/birthday update` | Everyone (self) | Same options, requires an existing entry. |
| `/birthday remove` | Everyone (self) | Managers can remove someone else's. |
| `/birthday show` | Everyone | Your birthday, or `user` for someone else. Ephemeral. |
| `/birthday list` | Everyone, public | Month-grouped embed with numbered page buttons; any member can page it, and the buttons keep working across restarts. Pages pack entries until the embed's description budget is reached. |
| `/birthday test` | Manage Server | Posts a real announcement for you in the configured channel. |
| `/birthday-config status` | Manage Server | Current settings and registration count. |
| `/birthday-config announcement-channel` | Manage Server | Channel for announcements; empty disables them. |
| `/birthday-config ping-role` | Manage Server | Role pinged with each announcement. |
| `/birthday-config birthday-role` | Manage Server | Role granted for the day and removed the next. |
| `/birthday-config log-channel` | Manage Server | Channel that receives birthday change events. |
| `/birthday-config monthly` | Manage Server | Pinned "upcoming birthdays" post: `mode` = announcement channel, custom channel, or off. |
| `/birthday-config timezone` | Manage Server | IANA time zone deciding "today" (default `UTC`). |
| `/help` | Everyone | Lists the commands the caller can use. |

Ranking options: `channel` (required), `number_of_posts`, `direct_message`.

## Behaviour

**Rankings.** Active and archived threads are scanned with a delay between requests (`FETCH_DELAY_MS`, default 200 ms). Only the forum's default emoji on the opening post counts. Above `PROGRESS_MIN_POSTS` the deferred reply is edited every `PROGRESS_INTERVAL_MS` (5 s) with `🔍 Scanning #channel — 128 / 412 posts (31%) · 1m08s`. Reports are chunked at 50 entries per embed.

**Caching.** Each scan writes `ranking-<channelId>-<ISO>.json`; later runs inside `CACHE_TTL_HOURS` (default 3, this deployment uses 6) are built from that file and the embed footer states its age. A missing, stale or unparsable file degrades to a rescan. `/forum-rank-force` bypasses the cache.

**Birthdays.** Announcements fire once per person per day after 00:05 in the guild's time zone, so a boot at any hour catches up the same day; a unique `(guild, user, date)` row is the dedupe guard and a failed send is retried on the next tick. Feb 29 is celebrated on Mar 1 in non-leap years. The birthday role is synced once a day: members celebrating get it, everybody else loses it. The bot's role must sit above the birthday role.

**Monthly digest.** On the last day of a month the bot posts the upcoming month's list, pins it, and then edits that same message once a day while the month runs, so late registrations appear without a new post. On rollover the previous message is unpinned and the next one is posted. **Changing the target channel deletes the old post and posts a new one there**, and switching the feature to `off` removes the pinned post. One message per guild, tracked in `monthly_posts`; needs **Manage Messages** to pin.

**Archive.** A Hermes cron job (`/opt/data/scripts/mecha-boosya-ingest.sh`, every 15 min) copies new ranking exports into `llm-wiki/raw/cosplay-wishlist/<yyyy>/<mm>/` and pushes the wiki repo when something changed; a daily job (03:00) also refreshes `llm-wiki/raw/mecha-boosya/db/latest.sqlite`. Both are silent unless they do something or the health check fails.

## Configuration

Everything is read from the environment at call time. **Only variables listed in the stack's `compose.yaml` reach the container** — the stack `.env` on its own does nothing.

| Variable | Default | Purpose |
|---|---|---|
| `DISCORD_BOT_TOKEN` | — | required |
| `DISCORD_GUILD_ID` | — | required, commands are registered per guild |
| `DISCORD_CLIENT_ID` | `client.user.id` | optional |
| `DEPLOY_SECRET` | — | bearer token for `POST /deploy` |
| `DEPLOY_PORT` | `3000` | supervisor HTTP port |
| `EXPORT_DIR` | `/data/exports` | exports, DB snapshots and logs |
| `DB_PATH` | `/data/db/mecha-boosya.sqlite` | SQLite file |
| `CACHE_TTL_HOURS` | `3` | ranking cache window |
| `FETCH_DELAY_MS` | `200` | pause between thread fetches |
| `PROGRESS_MIN_POSTS` / `PROGRESS_INTERVAL_MS` | `50` / `5000` | progress message thresholds |
| `BIRTHDAY_PAGE_CHARS` | `3600` | description budget that decides page breaks |
| `BIRTHDAY_DEFAULT_TIMEZONE` | `UTC` | until the guild overrides it |
| `BIRTHDAY_ANNOUNCE_MINUTE_OF_DAY` | `5` | 00:05 local |
| `RANKING_KEEP_DAYS` / `SNAPSHOT_KEEP_DAYS` | `30` / `7` | retention sweep |
| `LOG_LEVEL` / `LOG_MAX_BYTES` / `LOG_KEEP` | `info` / `5000000` / `3` | log verbosity and rotation |

## Storage

- `DB_PATH` — SQLite via `node:sqlite` (no native dependency): `birthdays`, `announcements`, `settings`.
- `EXPORT_DIR/ranking-*.json` — `{ channelId, channelName, generatedAt, count, requestedBy, limit, threads: [...] }`. The full sorted list is archived even when the report is truncated.
- `EXPORT_DIR/db-YYYY-MM-DD.sqlite` — daily `VACUUM INTO` snapshot, pruned after `SNAPSHOT_KEEP_DAYS`.
- `EXPORT_DIR/logs/bot.log`, `supervisor.log` — rotated at `LOG_MAX_BYTES`, keeping `LOG_KEEP` files.

Retention runs in the bot because the read-only consumer of this volume cannot delete.

## Deployment

`docker compose up -d` runs the `node:24` image, mounts a named volume at `/data`, clones the repo into `/data/repo` on first boot and executes `node src/supervisor.js`. The supervisor owns the bot process for the life of the container.

- `GET /health` → `{ status, childState, pid, uptimeSec, commit, lastRestartAt, crashCount, deploying }`.
- `POST /deploy` with `Authorization: Bearer $DEPLOY_SECRET` → fetch, drain the child, reset to `origin/main`, install dependencies when `package-lock.json` changed, `node --check` every file under `src/`, restart. Any failure rolls back to the previous commit and restarts the old code.
- The child is restarted 3 s after a crash; a child whose heartbeat stalls for 90 s is killed and restarted.
- Watchtower is disabled for this container (`com.centurylinklabs.watchtower.enable: "false"`) so deploys are deliberate.
- Changes to `supervisor.js` need a container recreate: it does not restart itself.

## Development

```bash
npm ci
npm test          # node --test, no framework dependency
node src/index.js # run the bot without the supervisor
```

`src/index.js` loads every `src/commands/*.js` (skipping `*.test.js`), registers them in bulk for `DISCORD_GUILD_ID`, and starts the birthday scheduler once the client is ready.

## Required Discord permissions

View Channels, Send Messages, Read Message History, and Manage Roles when a birthday role is configured (the bot's role must be above it). Manage Channels gates `/forum-rank`; Manage Server gates the config commands and `/forum-rank-force`.

## Layout

```
src/
  index.js              client, command loader, interaction logging, scheduler start
  supervisor.js         process supervisor, /health, /deploy
  commands/             one file per command (birthday, birthday-config, forum-rank, forum-rank-force, help)
  utils/
    ranking.js          scan, cache, progress, report
    exports.js          atomic exports, freshness lookup, retention
    birthday.js         date maths, embeds, pagination
    birthday-store.js   SQLite access
    birthday-scheduler.js  daily announcements, role sync, snapshots
    guild-log.js        log-channel notifications
    logger.js           console mirror + rotating file
    theme.js            accent colour
img/birthday.png        announcement and list thumbnail
```
