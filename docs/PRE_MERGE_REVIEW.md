# Review before every merge

Three layers. The first is done by machine and blocks the merge; the second is
written into every pull request; the third happens after release.

## Why

On 2026-11-24 a change to the program page declared a piece of state below a
function that read it. That function ran as soon as the page opened, for any
program with an unwritten week. The page crashed for those members for about
20 hours. The type check, the build and every test passed: nothing ever opened
a page.

## 1. Checks that block a merge (`.github/workflows/tests.yml`)

| Check | Command | What it catches |
|---|---|---|
| Every member screen opens | `npm run test:pages` | A page that crashes with real-shaped data, for each kind of member and each program state |
| Declared before use | `npm run check:declared` | Anything newly used before it is declared |
| Type check | `npx tsc --noEmit -p tsconfig.app.json` | Type errors |
| App tests | `npm run test:calculators` | Rule and wording regressions |
| Build | `npm run build` | The app does not build |
| Function tests | `deno test … supabase/functions/` | Server regressions |
| Functions load | `deno cache … supabase/functions/*/index.ts` | A function that cannot start |

`npm run premerge` runs the app half locally.

For these to BLOCK a merge, branch protection must be on for `main` in GitHub:
Settings → Branches → Add rule → `main` → Require status checks to pass →
select `edge function tests (all)` and `app type-check and tests`.

### Page tests: the rule

- A new screen, or a screen changed in a PR, gets a page test in that PR.
- A page test opens the screen with data for each state the change touches.
  The program page is opened for: a new weekly program, a week being written,
  every week written, month two with unwritten weeks, an older monthly
  program, an archived program, and a program with no days.
- A page test must fail on the bug it guards against. Both new checks were run
  against the broken 2026-11-24 page and failed on it.

## 2. Written into every pull request (`.github/pull_request_template.md`)

Screens touched and the states they were opened in; server functions touched
and their callers; database changes and migration order; AI instructions
changed and the conflict search; who is affected, counted; what could not be
verified; how to undo it.

## 3. After release

The app records every crash (`app_events`, event `client_error`, with the path
and the message). For 30 minutes after a release, watch it and report the
count. On 2026-11-24 the first error was recorded five minutes after release.
