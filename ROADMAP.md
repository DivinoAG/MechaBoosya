# MechaBoosya roadmap

Living checklist of agreed work. Rules for whoever executes:

- **An item is written here as `[ ]` before the work starts**, not after it ships. This file is the
  plan; a checklist updated only at the end is a log, and a log cannot be reviewed or reordered.
- Finished items keep their line and get `[x]` plus the commit.
- Tests first (`TESTING.md`), one branch per item, merge to `main` only when lint, types and tests pass.
- Items already agreed but not started stay at the bottom of their section, so "what's next" is
  always answerable from this file alone.

## Status

- Live: ranking + birthday tracker in `mecha-boosya` container, deployed from `main` via `POST /deploy`.
- Gates: Biome, `tsc --checkJs`, `node --check`, 114 tests, coverage floors (80/78/80), pre-commit + CI.
- Data: SQLite in a Docker volume; daily snapshot pushed to the wiki repo as
  `raw/mecha-boosya/db/latest.sqlite`; ranking exports ingested every 15 minutes.

## A. Test coverage hardening (do first)

- [x] **A1. Seam for `ranking.js`.** Accept `fetchForumThreads` / `fetchInitialMessage` as an
      injectable dependency of `runRanking` instead of importing them at module load, so a test
      can drive a fake forum. No behaviour change; existing tests must stay green.
- [x] **A2. Cache decision tests.** Fresh export served without scanning; stale export rescans;
      `force` rescans even when fresh; the cached footer appears only on the cached path.
- [x] **A3. Export write tests.** One file per scan; `requestedBy` and `limit` recorded; prune
      runs; a failed write still delivers the report.
- [x] **A4. Report chunking tests.** >50 entries → `editReply` then `channel.send` per chunk; DM
      path uses `user.send` plus a confirmation; `number_of_posts` slices before chunking.
- [x] **A5. Ordering and failure contract.** Descending order holds ties stably; `deferReply`
      happens before any fetch; a scan throw becomes the generic error reply; missing default
      reaction emoji is refused before deferring.
- [x] **A6. Scheduler monthly/role paths.** `monthlyAction` move/rollover/off and the role sync
      (grant today's celebrants, strip everyone else, skip when the role sits below the bot's).
- [x] **A7. Raised the coverage floors** to 94 lines / 83 branches / 82 functions
      (measured 95.3 / 84.5 / 83.3). The 88/85/88 target was optimistic on *function* coverage:
      V8 counts every inline arrow, so it moves with branch count rather than with real gaps.
      Lines and branches are the numbers worth defending; revisit if either drops.
- [x] **A8. Quiet test output.** Modules log to `console` directly, so the suite prints
      `[list] page … reloaded`, `[birthday] announced …` and monthly lines. Accept `log` in those
      modules (as `runtime.js` already does) and pass a silent stub from tests.

### Where section A landed

148 tests (was 114). `ranking.js` went from 34.8 % to 100 % lines; `birthday-scheduler.js` to
96.4 %; overall 95.3 / 84.5 / 83.3. Two real bugs surfaced while writing them: a failing monthly
post aborted the rest of the tick (skipping role sync and snapshot), and the export-failure path
had never been exercised.

Remaining known gaps, deliberately deferred: `supervisor.js` branches at 63 % (the deploy error
paths and the stale-heartbeat watchdog) and `help.js` branches at 55 %.

## B. Deploy safety

- [x] **B1. `/deploy` detects `src/supervisor.js`.** The response now carries
      `supervisorChanged` plus a `warning` naming the recreate requirement, and the line is logged.
      Tests cover both a change and a change that misses it, and the same run added the
      supervisor's untested branches: 404 route, 409 on a concurrent deploy, and the watchdog
      restarting a child that stops writing its heartbeat (`WATCHDOG_INTERVAL_MS` is now an env
      knob so the test does not wait 15 s).
- [x] **B2. Branch policy in practice.** Branches `feat/…`, `fix/…`, `test/…`, `docs/…`, merged
      locally only when lint, types, syntax and tests pass. Recorded in `TESTING.md`.

## C. Observability

**Constraint that shapes this section:** a monitor hosted on the Mac cannot report the Mac being
down, and I run on that Mac, so no alert can reach *me* while it is off. Split the problem in two:

- **Recoverable failures** (container up, bot child dead; bad deploy; log channel broken) — I can
  detect and repair these, and a local check is enough.
- **Unrecoverable failures** (Mac off, Docker down, disk full) — only an external service can
  report them, and the report has to go to the human, not to me.

- [ ] **C1. External dead-man's switch** (detects the Mac itself dying). Options, pick one:
      Healthchecks.io (hosted push, free for 20 checks, alerts by email/ntfy/webhook —
      https://healthchecks.io/), Gatus (one container, YAML in the repo, rich conditions), Uptime
      Kuma (UI-driven; must live on another machine to be meaningful). Any of them must be proved
      with a test notification before it is trusted.
- [ ] **C2. Local repair loop**: Hermes cron every 15 min — if `/health` is not
      `childState: running`, `POST /deploy` to restart the child and note what happened. This is
      the half that makes me the responder; it cannot cover the Mac being off.
- [ ] **C3. Surface delivery failures.** `notify()` swallows its own errors by design; add a
      counter to `/health` so a broken log channel is visible without reading logs.

## D. Data safety

- [x] **D1. Restore drill.** `npm run drill` opens `raw/mecha-boosya/db/latest.sqlite` read-only and
      fails when it cannot be read, holds no rows, holds *more* rows than the live `stats.json`, or
      is older than 36 h. Strict equality against a live count was the first design and was wrong:
      the backup is a point-in-time copy, so a lag is expected and only staleness or loss is a fault.
      Live run: 30 birthdays in the backup, 45 live, 15 registered since the snapshot — OK.
- [x] **D2. Dependabot.** `.github/dependabot.yml`: npm dev dependencies weekly, grouped into one
      PR for minor and patch updates; GitHub Actions monthly.
- [x] **D4. Effective configuration in `stats.json`.** The values the process actually loaded —
      `maxUnreadablePosts`, `cacheTtlHours`, `fetchDelayMs`, `progressMinPosts`, `announceMinuteOfDay` —
      written with the counts, so a compose or `.env` change is provable with one `cat` instead of a
      shell inside the container. Twice now the question "did that variable land?" had no answer.
      The values are imported from the modules that loaded them, not re-read from the environment,
      so the report cannot disagree with the behaviour; a child-process test proves env → file.
- [x] **D5. README kept true.** The configuration table listed a `LOG_LEVEL` that does not exist and
      omitted eleven real variables. Documented every one, grouped by owner, plus the behaviours added
      since (unreadable-post footer and abort, refresh button, `stats.json` with its config block, the
      drill, the gates). A test compares the variables read in `src/` against the README table, in both
      directions, so the next variable cannot ship undocumented. The test itself needed fixing
      once: it read the default column as a variable name and flagged `UTC`.
- [x] **D3. `stats.json` next to the exports.** Written on boot and after every
      registration/removal or announcement, carrying `generatedAt`, `guildId`, `birthdays` and
      `announcements`. The live DB sits inside the container, so without this any count quoted
      from outside is only as fresh as the daily snapshot — a real 45 was reported as 30.

## E. Feature backlog

- [x] **E1. Survive a request that still fails.** `@discordjs/rest` already retries 5xx three times
      per request and backs off on 429, so the gap is what happens *after* those retries: skip the
      thread, finish the scan, and report it. The export records `failures`, the report footer says
      `· N posts unreadable`, and **a scan with failures is written but never served from cache** —
      a transient gap must not be baked in for six hours.
      Two things the tests forced: an unreadable post is not a zero-vote post, and a scan where
      *every* post fails must still answer the interaction — the chunk loop never ran, so a
      deferred reply was left hanging until its token expired.
- [x] **E2. Cached-serve stats.** Footer shows age and post count only (`Cached results from 2h ago ·
      263 posts`). The requester stays in `bot.log`, never in a public message.
- [x] ~~**E3. `/birthday next`**~~ — **dropped.** The pinned monthly post already answers "what's
      coming up"; a second on-demand view duplicates it with a different shape.
- [x] **E4. Feb 29, three surfaces.** `/birthday list`, the monthly post and `/birthday show` always
      print the **birth date** — 29 February — with no note, leap year or not. Only the celebration
      post carries the explanation, and only when the current local year (guild timezone) has no
      29 February, because that is the one message about *this year's* celebration. It fires only
      when the celebration day is not 29 February — the first version added the note on the real
      day in a leap year too, which the scheduler test caught.
- [x] **E6. `/help` as a real manual.** Static manifest of every command with its arguments, rendered
      in sections (birthdays, rankings, configuration, general) with the same layout as the reference
      bot: inline-code command, bracketed optional arguments, em dash, one line each. Entries are
      filtered by *their own* permission — Manage Channels for `/forum-rank`, Manage Server for
      `/forum-rank-force`, config and `test` — so the list never advertises a refusal. A test fails if
      a command file exists that the manifest does not mention.
- [x] **E5. Stop a scan that is failing wholesale.** More than 20 unreadable posts at any point means
      the forum is not really readable, so the scan aborts instead of fetching the remaining hundreds:
      no export, no partial ranking, one message naming the count. Cap tunable via
      `MAX_UNREADABLE_POSTS`. Known trade-off: scattered failures late in a large scan also trip it;
      if that turns out to be the wrong rule, the alternative is consecutive failures.
      Implemented with a typed `ScanAborted`: no export is written, the ranking is not delivered, and
      a second caller waiting on the same scan gets the same message instead of hanging.

## Decisions taken

- UTC stays the reference frame for a worldwide server; shift the posting hour, not the zone.
- Refresh button: always visible, labelled `Refresh`, re-uploads the image and replaces the copy.
- Tests are never fitted to the code; a test changes only when a requirement moves.
- Per-repo SSH deploy key, no account-wide GitHub access; PRs skipped for that reason.
- **No test for `.github/dependabot.yml`.** GitHub validates it on push and surfaces errors in the
  Dependabot tab; a local test would need a YAML parser plus SchemaStore's schema and still miss
  what GitHub enforces. The failure it would catch is slow and low-severity (dev dependencies
  ageing), so the check is manual: no Dependabot PR within two weeks means the config is wrong.
