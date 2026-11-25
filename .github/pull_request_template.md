<!--
Every line below needs an ANSWER WITH EVIDENCE, not a tick. "n/a" needs a reason.
Why this exists (2026-11-25): a release crashed the program page for every member
with an unwritten week. It type-checked, built and passed every test.
-->

## Left out

## Not verified

## What changes

## Review before merge

**Screens touched** — each one, and the member states it was opened in (page tests: `npm run test:pages`). A new or changed screen needs a page test in this PR.

**Server functions touched** — each one, and everything that calls it.

**Database** — new columns, tables or triggers; does the code work both BEFORE and AFTER the migration runs?

**Instructions to the AI** — what changed, and what was searched to find instructions that now conflict.

**Who is affected** — counted from real data, by name where it is a handful.

**Anything used before it is declared** — `npm run check:declared` output.

**How to undo it** — the exact step if this has to be reverted.

## Checks run

`npm run premerge` and the function tests, with the numbers.

## After release

Watch the app's error log (`app_events`, `client_error`) for 30 minutes and report the count.

## Deploy after merge
