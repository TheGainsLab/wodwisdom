# Continuum — Phase 1 build plan (the sequencer reads the curve)

Status: BUILT 2026-11-17 (decisions below; deploy at the end). Spec: `conditioning_continuum_spec.md` §5.
Phase 0 is complete and verified in production (78 athletes, population bands ≈ 1.0).

Goal: the sequencer's conditioning judgment comes from the athlete's
continuum — the band table, trials and flags — instead of the per-type
ratio table and the analytics dump. Nothing the athlete sees changes.
Targets, the ratchet affecting prescriptions, calibrate-on-switch and the
athlete chart stay in Phases 2–3.

## What the sequencer sees today, and after

Today (`buildConditioningState`, shared with the Coach and workout review):

1. ENGINE CONDITIONING SIGNALS — days since last session, adherence, the
   per-(day_type, machine) rolling ratio table (ratio vs adaptive target,
   last 5), calibration per machine with the last **3** trials.
2. ENGINE ANALYTICS — the full Analytics page as text ("one calculation",
   2026-11-11).

After Phase 1, the sequencer only:

1. ATHLETE CONDITIONING CURVE — the band table (M, state, n, trend for the
   seven effort bands), trials per machine (last **6**), flags, then days
   since last session and adherence. This is `formatCurveForPrompt`, which
   the backfill already produces; no new formatting logic.
2. The per-type ratio table: **dropped** (founder, 2026-11-17: "we talked
   through the new version and it's better"; the sequencer was never rolled
   out widely, so there is no legacy behaviour to protect).
3. The analytics dump: **dropped from the sequencer**. The Coach and workout
   review keep today's block and get the curve block **appended** (founder,
   2026-11-17), so the Coach can talk about bands; "one calculation" still
   holds for everything the athlete talks to.

Then, unchanged: readiness-filtered catalogue with envelopes and coaching
intent, program intent, athlete context, previous block, caps, never-done
types, other training load, programming week, coach notes.

## The instruction (system prompt)

Replaces the "signals" description, the "Intensity judgment" paragraph and
the "Recalibration" paragraph in `run-resequence.ts`'s SYSTEM_PROMPT:

- **Read the curve.** Seven effort bands, long on the left (slow twitch) to
  short on the right (fast twitch). M is the athlete against a balanced
  athlete at their own trial level; 1.0 is balanced. `measured` means a max
  effort proved it; `floor` means only sub-max days have been done there;
  `blank` means nothing has landed there.
- **Prescribe into the lowest measured band** without letting strong bands
  sag. Where a band is **blank, probe it**: place a max-effort day whose
  longest work block lands in that band before prescribing development
  into it. Choose the type and shape; the system reads where it landed.
- **Demand weighting.** Metcons live between 30 s and 10 min of effort —
  the four middle bands matter most; the ≤30 s and 20–40 min bands are
  diagnostics, not the destination. A gap in 1–4 min outranks a gap at
  ≤30 s.
- **Read the right end with the trial.** `AEROBIC_SIDE_BEHIND_SPRINT` with a
  low or stalled trial = the aerobic side is the gap: bias toward 4–20 min
  work and consider an early retest. With a rising trial = a fast-twitch
  athlete whose level is simply catching up. `GLYCOLYTIC_BELOW_BALANCED` =
  short, hard work is the gap.
- **TRIAL_LOW** = the athlete sustained longer than balanced at trial pace:
  place a retest early in the block (the one case that earns a self-made
  time trial). `UNCALIBRATED:<machine>` = that machine has no trial; don't
  prescribe to it as if it were calibrated. `AWAITING_RIGHT_ANCHOR` = a
  recent retest, sprint bands provisional until the next max effort.
- **Confidence by n**, as today: set intensity decisively where n is solid,
  conservatively where thin. Intensity is still expressed as the envelope's
  pace fractions in Phase 1 — the ratchet does not set targets yet.

Bands are what the model reads; day types remain the words it answers in.

## Which day types reach which band

The model has to know that "probe the 1–2 min band" means, for instance, an
interval day with 60–120 s work, not an endurance day. The catalogue
envelopes contain that, but reading JSON ranges for 20 types is a lot to
ask. Proposal: one computed line per ready type, appended to its catalogue
entry — `reaches: 30–60 s, 1–2 min` — derived mechanically by running the
envelope's min and max `workDuration` of the longest block through the
prescription expander (`engine-continuum-prescription.ts`, already written).
Authored nothing; it follows the catalogue.

## Freshness

The curve is recomputed by the daily tick and on the admin button. A
sequencer run can happen the same day a session is logged, so the stored
curve may miss it. Proposal: move `computeAthlete` from the backfill into
`_shared/engine-continuum-io.ts` and have the sequencer refresh **this
athlete** inline before building the prompt (pure replay over ~40 sessions,
well under a second). It writes the same columns, so the admin page is
fresh too. The backfill function keeps using the shared module.

## Files

| Change | Where |
|---|---|
| `buildConditioningState(..., { audience: 'sequencer' \| 'coach' })` — sequencer: curve block + adherence only; coach: today's block + the curve block | `_shared/conditioning-state.ts` |
| Trial history shown: 3 → 6 (both blocks) | `_shared/conditioning-state.ts`, `formatCurveForPrompt` default already 6 |
| `computeAthlete` extracted; sequencer refreshes the athlete inline | new `_shared/engine-continuum-io.ts`, `engine-continuum-backfill/index.ts`, `_shared/run-resequence.ts` |
| SYSTEM_PROMPT rewritten per above; `reaches:` line in the catalogue text | `_shared/run-resequence.ts`, `_shared/engine-catalogue.ts` (+ `engine-continuum-prescription.ts` helper) |
| Tests: prompt block assembled for the fixture athlete; audience split; `reaches` mapping for anaerobic / interval / threshold / endurance; refresh writes | `conditioning-state_test.ts`, new `engine-catalogue_test.ts` |
| Spec §5 marked built; decisions log | `docs/conditioning_continuum_spec.md` |

No migration. No frontend change. No change to validation, envelopes,
readiness, variety or caps.

## Rollout

1. Build; tests green.
2. Admin dry run (`engine-resequence` with `debug: true` returns the prompt
   and the proposal) on three athletes: the exploration athlete, a rower, a
   new 3-day athlete. Founder reads the prompts and proposals side by side
   with what the live sequencer produced for their current block.
3. Ship. The cron picks it up on its next tick; no athlete sees a
   difference except in which days they get.
4. After one monthly cycle: review proposals against the band tables
   (did blanks get probed? did the lowest measured band get the work?).

## Decisions (founder, 2026-11-17)

1. **Ratio table: dropped now.** No one-cycle overlap, no Phase 1b.
2. **Coach gets the curve block** appended to its existing context.
3. **`reaches:` line included**, worded "can reach" — a reading aid, never a
   constraint.
4. **Inline refresh** before each sequencer run; a refresh failure logs and
   falls back to the stored curve rather than skipping the athlete. Only
   sessions whose continuum values changed are rewritten.
5. The sequencer's lever is conditioning days and their intensity within the
   envelope only; the prompt says so. TRIAL_LOW remains the one case that
   earns a self-made retest.
6. New athletes are not a case: month one is fixed and the sequencer runs
   from month two, when a trial and a month of days exist.

## Built (2026-11-17)

| Piece | Where |
|---|---|
| Shared compute + change-only writes + freshness check | `_shared/engine-continuum-io.ts` (`computeAthleteContinuum`, `loadCurves`, `curveIsFresh`); backfill rewired to it |
| Sequencer conditioning: curve block (inline refresh) + days-since + adherence | `_shared/conditioning-state.ts` → `buildSequencerConditioning`, `buildContinuumBlock`, `formatSequencerSignals` |
| Coach: existing block + analytics + the stored curve block; trials 3 → 6 | `_shared/conditioning-state.ts` → `buildConditioningState` (call sites unchanged) |
| `can reach:` lines, computed on the athlete's primary machine's curve | `_shared/engine-continuum-reaches.ts` (+ 9 tests on the live catalogue snapshot `fixtures/engine_day_types.json`), `formatDayTypeCatalogue(rows, { reaches })` |
| System prompt: reading the curve, what to do with it, the flags, the lever | `_shared/run-resequence.ts` |
| Tests | `conditioning-state_test.ts` (sequencer signals, six trials), `engine-continuum-reaches_test.ts` |

Findings from the build, for Phase 2:

- On the Echo the catalogue's paced envelopes top out at 1.2–1.3× (hybrid
  anaerobic, ascending), which is a 2–4 min effort; nothing paced reaches
  1–2 min — only max-effort anaerobic does. The 1–2 min band can be probed
  but not developed with a paced day until targets come from the ratchet.
- On the rower the same fractions are much shorter efforts (1.3× pace is a
  near-max sprint), which the `can reach` lines now make visible per
  athlete; a machine-blind pace fraction is the Phase 2 problem.
- `flux` / `flux_stages` envelopes carry no `workDuration` (the catalogue
  days do), so a sequencer-generated flux day may resolve to no segments on
  the day page. None has been generated yet; worth a look before flux is
  sequenced.

Deploy: `supabase functions deploy engine-resequence engine-resequence-cron
engine-continuum-backfill chat workout-review` (no migration, no frontend).
Then an admin dry run (`engine-resequence` with `{ target_user_id, debug: true }`)
on three athletes, reading the prompt and the proposal.

## First dry run and the fix (2026-11-17)

Dry run on the exploration athlete (month 3, 4 days): the model named the
lowest measured bands correctly (2–4 min 0.82, 4–10 min 0.90) and chose
ascending to 1.25× for the right reason, but read "2–4 min" as clock time —
a MAP day of 5 × 3 min at 0.95–1.02× was called "3–4 minute power" though it
lands at 10–20 min of effort. It also skipped the blank 30–60 s band in
favour of the time-trial goal.

Fix: the `can reach:` line now says what puts the type in each band — the
pace for a paced block, the work length for a max effort:

```
max_aerobic_power  can reach: zone 2 at 0.85×, 20–40 min at 0.86–0.92×, 10–20 min at 0.93–1.0×, 4–10 min at 1.01–1.05× (the band follows the pace you set, not the clock)
anaerobic          can reach: 2–4 min at 120 s work, 1–2 min at 60–119 s work, 30–60 s at 30–59 s work, ≤30 s at 15–29 s work (max effort — the band follows the work length)
```

and the probe instruction says to spend one day of the block on a blank band
a type can reach.
