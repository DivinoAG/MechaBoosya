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

- [ ] **A1. Seam for `ranking.js`.** Accept `fetchForumThreads` / `fetchInitialMessage` as an
      injectable dependency of `runRanking` instead of importing them at module load, so a test
      can drive a fake forum. No behaviour change; existing tests must stay green.
- [ ] **A2. Cache decision tests.** Fresh export served without scanning; stale export rescans;
      `force` rescans even when fresh; the cached footer appears only on the cached path.
- [ ] **A3. Export write tests.** One file per scan; `requestedBy` and `limit` recorded; prune
      runs; a failed write still delivers the report.
- [ ] **A4. Report chunking tests.** >50 entries → `editReply` then `channel.send` per chunk; DM
      path uses `user.send` plus a confirmation; `number_of_posts` slices before chunking.
- [ ] **A5. Ordering and failure contract.** Descending order holds ties stably; `deferReply`
      happens before any fetch; a scan throw becomes the generic error reply; missing default
      reaction emoji is refused before deferring.
- [ ] **A6. Scheduler monthly/role paths.** `monthlyAction` move/rollover/off and the role sync
      (grant today's celebrants, strip everyone else, skip when the role sits below the bot's).
- [ ] **A7. Raise the coverage floors** once A1–A6 land; target 88/85/88.

## B. Deploy safety

- [ ] **B1. `/deploy` detects `src/supervisor.js`.** A push touching the supervisor takes effect
      only after a container recreate; the response should say so (`warning` field + log line)
      instead of reporting a plain success. Tests: changed / unchanged file sets.
- [ ] **B2. Branch policy in practice.** Feature branches named `feat/…`, `fix/…`, `test/…`,
      `docs/…`; merge locally when green; `main` stays deployable.

## C. Observability

- [ ] **C1. Uptime Kuma** (user-side): container on `gateway-net`, keyword monitor on
      `"childState":"running"` at `http://mecha-boosya:3000/health`, HTTP monitor on the Hermes
      dashboard, one **external** monitor for the Mac itself. Send a test notification before
      trusting the channel. https://github.com/louislam/uptime-kuma
- [ ] **C2. Agent-side poll** (only if unattended reaction is wanted): Hermes cron every 30 min
      hitting the same endpoint, opening a task on failure. Cannot be replaced by Kuma alerts —
      I have no inbound webhook.
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
