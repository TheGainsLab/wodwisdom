# Stage 3 Shadow Test — Runner

Generates the ten pre-registered A/B skeleton pairs for the Stage 3 rubric
(frozen 2026-08). Read-only against production: `coach_states` is read; on a
cache miss the CoachState is generated in memory and **never persisted**.
Nothing is written to any table — outputs land on local disk only.

## Arms

- **enum** — the live skeleton writer, byte-identical call (`callSkeletonWriter`,
  Sonnet, TrainingDesignInput only).
- **frontier** — the live prompt **plus** the de-prescribing addendum
  (`frontier-skeleton-prompt.ts`), receiving the TDI **plus** the full CoachState
  document. Default model `claude-opus-4-8` (`--frontier-model=` to override).

Both arms are single-shot (no audit-retry loop) so the pair compares the
writers, not the recovery machinery. Machine rows M1–M5
(`_shared/stage3-machine-rows.ts`) run on both outputs.

## Run

1. Copy `athletes.example.json` → `athletes.json` and fill the ten user IDs
   per the rubric's selection spec. Do this **before** looking at any output.
2. ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
   deno run --allow-net --allow-env --allow-read --allow-write \
     scripts/stage3-shadow/run-shadow-pairs.ts \
     --athletes=scripts/stage3-shadow/athletes.json
   ```
3. Expected spend: ~20 skeleton calls (10 Sonnet + 10 Opus) ≈ low single-digit
   dollars. CoachState cache misses add a Sonnet call each.

## Blinding procedure (from the frozen rubric — follow exactly)

1. The runner coin-flips each pair's arm→label assignment and writes
   `shadow-out/assignment-key.json`. **Immediately** hand that file (and
   `pair-*/machine.json`, which names the arms) to the non-scorer; scorers must
   never open either.
2. Scorers receive only `pair-NN/outline-A.md`, `outline-B.md`, and `inputs.md`
   (typed decisions + full CoachState document — needed to judge H1 "nuance the
   enums couldn't carry").
3. Two scorers score independently — no discussion until both sheets are
   complete. H1: 1–5 per outline. H2: Present/Absent with a **quote** if
   Present. H3: 1–5 per outline.
4. Unblind via `assignment-key.json`, tally per the rubric's pair-verdict and
   disagreement rules, then apply the decision rule **as written**.

## Files

- `run-shadow-pairs.ts` — the runner (Deno).
- `frontier-skeleton-prompt.ts` — frontier-arm addendum + CoachState document
  block. The ONLY prompt-level difference between arms.
- `athletes.example.json` — selection template.
