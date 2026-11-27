# MechaBoosya roadmap

Living checklist of agreed work. New items go at the bottom of their section; finished items keep
their line and get `[x]` plus the commit. Rules for whoever executes: tests first (`TESTING.md`),
one branch per item, merge to `main` only when the suite, lint and types are green.

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

- [ ] **B1. `/deploy` detects `src/supervisor.js`.** A push touching the supervisor takes effect
      only after a container recreate; the response should say so (`warning` field + log line)
      instead of reporting a plain success. Tests: changed / unchanged file sets.
- [ ] **B2. Branch policy in practice.** Feature branches named `feat/…`, `fix/…`, `test/…`,
      `docs/…`; merge locally when green; `main` stays deployable.

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

- [ ] **D1. Restore drill.** Load `raw/mecha-boosya/db/latest.sqlite` into a throwaway store and
      assert the birthday count matches the live number. A backup never restored is a hypothesis.
- [ ] **D2. Dependabot** for the dev dependencies (Biome, TypeScript, `@types/node`), weekly,
      grouped into one PR.

## E. Feature backlog

- [ ] **E1. Retry/backoff** on Discord 5xx during a scan; one blip currently fails the run.
- [ ] **E2. Cached-serve stats** in the `/forum-rank` footer (age, post count, requester).
- [ ] **E3. `/birthday next`** — who is coming up in the next 30 days.
- [ ] **E4. Feb 29 display** in the list for non-leap years.

## Decisions taken

- UTC stays the reference frame for a worldwide server; shift the posting hour, not the zone.
- Refresh button: always visible, labelled `Refresh`, re-uploads the image and replaces the copy.
- Tests are never fitted to the code; a test changes only when a requirement moves.
- Per-repo SSH deploy key, no account-wide GitHub access; PRs skipped for that reason.
