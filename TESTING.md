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
| `utils/ranking.js` | partial | progress formatting and the permission gate; the scan itself is wired to the coordinator, whose own tests cover the sharing |
| `utils/scan-coordinator.js` | yes | one scan per channel, shared progress, settle wake-up, failure cleanup |
| `utils/exports.js` | yes | envelope, atomic write, freshness lookup, retention |
| `utils/logger.js` | yes | format, rotation, unwritable dir |
| `utils/list-buttons.js` | yes | paging by custom id, empty registry |
| `utils/message-formatter.js` | yes | accent colour, footer, truncation |
| `commands/birthday.js` | yes | permission gating, self vs manager edits, duplicate and invalid dates |
| `commands/birthday-config.js` | yes | gating, timezone validation, monthly mode, channel reachability |
| `commands/forum-rank*.js`, `help.js` | yes | permission gating; the scan flow itself is exercised only through the container |
| `runtime.js` | yes | loader skips, unknown command, failure replies, drain refusal, button routing |
| `index.js` | no | discord.js wiring only; the logic it used to hold now lives in `runtime.js` |
| `supervisor.js` | yes | deploy transaction, rollback, auth, crash recovery |
| `utils/discord-api.js` | yes | forum type check, active+archived merge, pagination cursor, dedupe, starter-message failure |

## Before touching these, add the test

Everything on the critical paths now has a test. Two behaviours remain uncovered by choice, and
a change there needs one added first:

1. `src/index.js` — the discord.js wiring: login, `rest.put` registration, the SIGTERM drain loop.
   Provable only against a real gateway or a fake Client; the counter it waits on is tested.
2. `utils/ranking.js` — the cached scan flow (freshness window, `force`, progress edits). The
   permission gate and the formatter are covered; the orchestration is not.

## Running them

```bash
npm test              # node --test, whole suite
npm test -- src/utils/birthday-scheduler.test.js   # one file
```

Tests use no framework, no network, and no Discord connection. Time, filesystem roots and the
Discord client are injected, so a test can drive a real code path with a fake clock or a fake
guild.

## The commit gate

`.githooks/pre-commit` runs, in order: `biome lint src`, `tsc --noEmit`, `node --check` over
`src/`, then the full suite — and refuses the commit if any fails. `core.hooksPath` is set by the
`prepare` script, so a fresh clone gets it on `npm install`; without npm, run
`git config core.hooksPath .githooks` once.

- `git commit --no-verify` exists and is a deliberate exception, not a convenience. The deploy
  path applies its own syntax gate but runs neither the suite nor the checker, so a bad commit
  can still reach the bot — say in the commit message why the gate was bypassed.
- The gate covers commits, not pushes. Anyone pushing from another clone without the hook runs
  unverified, which is why the GitHub Actions workflow runs the same four checks on every push.
- `npm run test:coverage` enforces floors (80 lines / 78 branches / 80 functions). Raising the
  floors is the point of measuring; lowering one needs a reason in the commit.
- `tsc` checks `src/**/*.js` and **excludes** `*.test.js`: the stubs fake Discord objects and
  would need casts to type-check, which buys nothing. Test correctness is the suite's job.


