# MechaBoosya

Discord bot for a single community server. Two features: forum post rankings by reaction count, and a birthday tracker with daily announcements.

Runs as a Node process inside its own container, supervised by `src/supervisor.js`, which exposes a small HTTP API for deploys and health. Deployed from `main`; every commit passes lint, types, a syntax check and the test suite (`.githooks/pre-commit`), and the same four run again on every push (GitHub Actions).

## Commands

| Command | Who can run it | What it does |
|---|---|---|
| `/forum-rank` | Everyone | Ranks threads in a forum channel by the count of the channel's default reaction on the opening post. Served from the newest export when it is younger than `CACHE_TTL_HOURS`. |
| `/forum-rank-force` | Manage Server (hidden from others) | Same report, always rescans every thread. |
| `/birthday register` | Everyone (self) | `day`, `month`, optional `year`, optional `user` for others (managers only). |
| `/birthday update` | Everyone (self) | Same options, requires an existing entry. |
| `/birthday remove` | Everyone (self) | Managers can remove someone else's. |
| `/birthday show` | Everyone | Your birthday, or `user` for someone else. Ephemeral. |
| `/birthday list` | Everyone, public | Month-grouped embed with numbered page buttons and a `🔄 Refresh` button; any member can use either, and they keep working across restarts. Pages pack entries until the embed's description budget is reached. |
| `/birthday test` | Manage Server | Posts a real announcement for you in the configured channel. |
| `/birthday-config status` | Manage Server | Current settings and registration count. |
| `/birthday-config announcement-channel` | Manage Server | Channel for announcements; empty disables them. Refuses a channel the bot cannot post in. |
| `/birthday-config ping-role` | Manage Server | Role pinged with each announcement. |
| `/birthday-config birthday-role` | Manage Server | Role granted for the day and removed the next. |
| `/birthday-config log-channel` | Manage Server | Channel that receives birthday change events. Refuses a channel the bot cannot post in. |
| `/birthday-config monthly` | Manage Server | Pinned "upcoming birthdays" post: `mode` = announcement channel, custom channel, or off. |
| `/birthday-config timezone` | Manage Server | IANA time zone deciding "today" (default `UTC`). |
| `/help` | Everyone | Lists the commands the caller can use. |

Ranking options: `channel` (required), `number_of_posts`, `direct_message`, `include_finished`.

Interactions are acknowledged before any work starts (`deferReply`, or `deferUpdate` for buttons), because the 3-second token is shorter than a forum scan or an image upload.

## Behaviour

**Rankings.** Active and archived threads are scanned with a delay between requests (`FETCH_DELAY_MS`, default 200 ms). Only the forum's default emoji on the opening post counts. Above `PROGRESS_MIN_POSTS` the deferred reply is edited every `PROGRESS_INTERVAL_MS` (5 s) with `🔍 Scanning #channel — 128 / 412 posts (31%) · 1m08s`. Reports are chunked at 50 entries per embed.

**Finished entries.** Posts tagged `DONE` or `PLAYED` are left out of the posted ranking, because they are no longer competing; the footer states how many were hidden. `include_finished:true` puts them back. The tag only filters the message — **the export keeps every post**, since the archive is what the wiki builds the wishlist from.

**Unreadable posts.** A post whose opening message cannot be read is skipped and counted, never treated as zero votes. The report footer states `· 3 posts unreadable` and the export records `failures`. Past `MAX_UNREADABLE_POSTS` (default 20) in one scan the bot stops reading — a forum it cannot read will not produce a ranking — and answers with the count instead of a report. Nothing is archived in that case.

**One scan per channel.** A second `/forum-rank` during a scan joins it and renders the same progress, so the forum is read once and both users get the report.

**Caching.** Each scan writes `ranking-<channelId>-<ISO>.json`; later runs inside `CACHE_TTL_HOURS` (default 3, this deployment uses 6) are built from that file and the footer reads `Cached results from 2h ago · 263 posts`. The requester is written to the export and the log, never into the public message. A missing, stale or unparsable file degrades to a rescan, and **an export with `failures > 0` is never served from cache**.

**Birthdays.** Announcements fire once per person per day after 00:05 in the guild's time zone, so a boot at any hour catches up the same day; a unique `(guild, user, date)` row is the dedupe guard and a failed send is retried on the next tick. The reply is sent before the log channel is written, so a slow audit trail cannot expire the interaction. The birthday role is synced once a day: members celebrating get it, everybody else loses it; the bot's role must sit above it.

**29 February.** The list, the monthly post and `/birthday show` always print the birth date — 29 February — in every year. Only the celebration post explains the fallback, and only when the celebration day is not 29 February: *"🎂 Born on 29 February — celebrated today, because this year has no 29th."*

**Monthly digest.** On the last day of a month the bot posts the upcoming month's list, pins it, and then edits that same message once a day while the month runs, so late registrations appear without a new post. That daily edit happens at most once per day even across deploys, because the date is stored rather than held in memory. On rollover the previous message is unpinned and the next one is posted. **Changing the target channel deletes the old post and posts a new one there**, and switching the feature to `off` removes the pinned post. One message per guild, tracked in `monthly_posts`; needs **Manage Messages** to pin.

**Archive.** A Hermes cron job (`/opt/data/scripts/mecha-boosya-ingest.sh`, every 15 min) copies new ranking exports into `llm-wiki/raw/cosplay-wishlist/<yyyy>/<mm>/` and pushes the wiki repo when something changed; a daily job (03:00) also refreshes `llm-wiki/raw/mecha-boosya/db/latest.sqlite`. Both are silent unless they do something or the health check fails.

## Configuration

Everything is read from the environment at module load. **Only variables listed in the stack's `compose.yaml` reach the container** — the stack `.env` on its own does nothing. The values actually loaded are reported in `stats.json` (see Storage), so a compose edit can be confirmed without a shell.

### Discord and identity

| Variable | Default | Purpose |
|---|---|---|
| `DISCORD_BOT_TOKEN` | — | required |
| `DISCORD_GUILD_ID` | — | required, commands are registered per guild |
| `DISCORD_CLIENT_ID` | `client.user.id` | optional |

### Ranking

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_TTL_HOURS` | `3` | how long an export answers `/forum-rank` (this deployment: 6) |
| `FETCH_DELAY_MS` | `200` | pause between thread fetches |
| `PROGRESS_MIN_POSTS` | `50` | thread count below which no progress message is shown |
| `PROGRESS_INTERVAL_MS` | `5000` | how often that message is edited |
| `MAX_UNREADABLE_POSTS` | `20` | unreadable posts in one scan before it aborts |
| `RANKING_KEEP_DAYS` | `30` | how long ranking exports are kept |

### Birthdays

| Variable | Default | Purpose |
|---|---|---|
| `BIRTHDAY_PAGE_CHARS` | `3600` | description budget that decides page breaks |
| `BIRTHDAY_DEFAULT_TIMEZONE` | `UTC` | until the guild overrides it |
| `BIRTHDAY_ANNOUNCE_MINUTE_OF_DAY` | `5` | minutes past local midnight, i.e. 00:05 |
| `SNAPSHOT_KEEP_DAYS` | `7` | how many daily database snapshots are kept |

### Storage and logging

| Variable | Default | Purpose |
|---|---|---|
| `DB_PATH` | `/data/db/mecha-boosya.sqlite` | SQLite file |
| `EXPORT_DIR` | `/data/exports` | exports, snapshots, `stats.json` |
| `LOG_DIR` | `EXPORT_DIR/logs` | log files |
| `LOG_MAX_BYTES` | `5000000` | rotation threshold |
| `LOG_KEEP` | `3` | rotated files kept |

### Supervisor

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_SECRET` | — | bearer token for `POST /deploy` |
| `DEPLOY_PORT` | `3000` | HTTP API port |
| `DEPLOY_BRANCH` | `origin/main` | what a deploy resets to |
| `REPO_DIR` | `/data/repo` | where the container clones the repository |
| `ENTRY` | `src/index.js` | the child process the supervisor runs |
| `RUN_DIR` | `/data/run` | dependency stamp and heartbeat |
| `HEARTBEAT_PATH` | `RUN_DIR/child.heartbeat` | liveness file the watchdog reads |
| `HEARTBEAT_STALE_MS` | `90000` | silence before the child is killed and restarted |
| `WATCHDOG_INTERVAL_MS` | `30000` | how often the watchdog looks |
| `RESTART_DELAY_MS` | `3000` | pause before restarting a crashed child |
| `DRAIN_MS` | `60000` | how long a deploy waits for the reply in flight |

## Storage

- `DB_PATH` — SQLite via `node:sqlite` (no native dependency): `birthdays`, `announcements`, `settings`, `monthly_posts`.
- `EXPORT_DIR/ranking-*.json` — `{ channelId, channelName, generatedAt, count, requestedBy, limit, failures, threads: [...] }`. The full sorted list is archived even when the report is truncated.
- `EXPORT_DIR/stats.json` — `{ generatedAt, guildId, birthdays, announcements, config }`, rewritten on boot and after every change. The live database sits inside the container, so **this is the only place to read a current count from outside**; `config` carries `maxUnreadablePosts`, `cacheTtlHours`, `fetchDelayMs`, `progressMinPosts` and `announceMinuteOfDay` as the process loaded them, which is how a `.env` or compose change is confirmed.
- `EXPORT_DIR/db-YYYY-MM-DD.sqlite` — daily `VACUUM INTO` snapshot, pruned after `SNAPSHOT_KEEP_DAYS`.
- `EXPORT_DIR/logs/bot.log`, `supervisor.log` — rotated at `LOG_MAX_BYTES`, keeping `LOG_KEEP` files.

Retention runs in the bot because the read-only consumer of this volume cannot delete.

## Deployment

`docker compose up -d` runs the `node:24` image, mounts a named volume at `/data`, clones the repo into `/data/repo` on first boot and executes `node src/supervisor.js`. The supervisor owns the bot process for the life of the container.

- `GET /health` → `{ status, childState, pid, uptimeSec, commit, lastRestartAt, crashCount, deploying }`.
- `POST /deploy` with `Authorization: Bearer <DEPLOY_SECRET>` → fetch, drain the child, reset to `origin/main`, install dependencies when `package-lock.json` changed, `node --check` every file under `src/`, restart. Any failure rolls back to the previous commit and restarts the old code. A second deploy while one is running answers `409`.
- The response carries `supervisorChanged` and, when true, a `warning`: **a change to `src/supervisor.js` does not take effect until the container is recreated**, because the running supervisor keeps executing the old copy. If the field is missing entirely, the running supervisor predates that check.
- The child is restarted `RESTART_DELAY_MS` after a crash; a child whose heartbeat stalls for `HEARTBEAT_STALE_MS` is killed and counted.
- Watchtower is disabled for this container (`com.centurylinklabs.watchtower.enable: "false"`) so deploys are deliberate.

## Development

```bash
npm ci
npm test               # node --test, no test framework
npm run test:coverage  # with the floors: 94 lines / 83 branches / 82 functions
npm run lint           # Biome
npm run typecheck      # tsc --noEmit over src/ (checkJs, strictNullChecks)
npm run drill          # restore drill against the wiki backup
node src/index.js      # run the bot without the supervisor
```

The pre-commit hook runs lint → types → syntax → tests and refuses the commit if any fails; CI repeats the same four on every push. Work happens on `feat/`, `fix/`, `test/` and `docs/` branches merged to `main` when green. `TESTING.md` holds the rules, `ROADMAP.md` the plan.

`npm run drill` opens the off-machine backup read-only and fails if it cannot be read, holds no rows, holds more rows than the live database, or is older than 36 hours. A lagging backup is expected; a stale or impossible one is not.

`src/index.js` loads every `src/commands/*.js` (skipping `*.test.js`), registers them in bulk for `DISCORD_GUILD_ID`, and starts the birthday scheduler once the client is ready. The loading and dispatch logic lives in `runtime.js` so it can be tested without a Discord connection.

## Required Discord permissions

View Channels, Send Messages, Read Message History, and Manage Roles when a birthday role is configured (the bot's role must be above it). `/forum-rank` is open to every member; Manage Server gates the config commands and `/forum-rank-force`, which Discord hides from members through the registration itself. Channels chosen through `/birthday-config` are checked for View Channel and Send Messages when they are saved.

## Layout

```
src/
  index.js              client wiring, heartbeat, shutdown drain
  runtime.js            command loader and interaction dispatch
  supervisor.js         process supervisor, /health, /deploy (dependency-free: runs before node_modules)
  commands/             one file per command (birthday, birthday-config, forum-rank, forum-rank-force, help)
  tools/restore-drill.js  opens the wiki backup and reports what is inside
  utils/
    ranking.js          scan, cache, progress, report, abort threshold
    scan-coordinator.js one scan per channel, shared progress
    exports.js          atomic exports, freshness lookup, retention
    birthday.js         date maths, embeds, pagination, the 29 February rule
    birthday-store.js   SQLite access
    birthday-scheduler.js  announcements, role sync, monthly post, snapshots
    guild-log.js        log-channel notifications
    stats.js            the readable status file
    config.js           the effective configuration it reports
    backup.js           read-only inspection of a backup
    logger.js           console mirror + rotating file
    theme.js            accent colour
  test-support/         test-only helpers (console filter)
img/birthday.png        announcement and list thumbnail
```
