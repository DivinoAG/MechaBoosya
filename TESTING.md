# Testing policy

## The rule

**Tests come first.** For any new behaviour: write the failing test, watch it fail for the
expected reason, then write the minimal code that passes. A test that has never failed proves
nothing — it may be asserting the implementation you happen to have rather than the behaviour
you wanted.

**Tests are never fitted to the code.** If the code is wrong, the test stays and the code
changes. A test may only be edited when the *scope* changes — a requirement is added, removed,
or redefined — and the commit message must say which requirement moved.

Corollary: a test that fails after an implementation change is a decision point, not an
inconvenience. Either the requirement changed (edit the test, say so) or the code broke
(fix the code).

## Current coverage

| Module | Tested | Notes |
|---|---|---|
| `utils/birthday.js` | yes | date maths, leap years, timezone parts, message builders, pagination |
| `utils/birthday-store.js` | yes | CRUD, announcement dedupe, settings, snapshots |
| `utils/birthday-scheduler.js` | yes | 00:05 gate, catch-up, per-day dedupe, Feb 29, guild timezone |
| `utils/ranking.js` | partial | progress formatting only; the scan/cache flow has no direct test |
| `utils/exports.js` | yes | envelope, atomic write, freshness lookup, retention |
| `utils/logger.js` | yes | format, rotation, unwritable dir |
| `utils/list-buttons.js` | yes | paging by custom id, empty registry |
| `utils/message-formatter.js` | yes | accent colour, footer, truncation |
| `commands/*.js` | no | permission gating and option handling untested |
| `index.js` | no | command loader, interaction routing, SIGTERM drain |
| `supervisor.js` | no | deploy transaction, rollback, health, crash recovery |
| `utils/discord-api.js` | no | thread/message fetching primitives |

## Before touching these, add the test

1. `supervisor.js` — a wrong rollback leaves the bot on broken code with no way back. Cover the
   deploy transaction end to end against a throwaway git repo: healthy start, rejected auth,
   successful deploy, syntax error → rollback, child still running.
2. `commands/*.js` — permission gating is a security boundary. Cover: a member without
   Manage Server cannot edit someone else's birthday, cannot change config, cannot force a
   rescan; invalid dates are rejected; duplicate registration is refused.
3. `index.js` — the loader silently skipping a command, or the drain never finishing, is
   invisible until a user hits it.
4. `utils/discord-api.js` — ranking correctness depends on fetching every active and archived
   thread and reading the right reaction.

## Running them

```bash
npm test              # node --test, whole suite
npm test -- src/utils/birthday-scheduler.test.js   # one file
```

Tests use no framework, no network, and no Discord connection. Time, filesystem roots and the
Discord client are injected, so a test can drive a real code path with a fake clock or a fake
guild.
