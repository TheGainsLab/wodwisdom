# Shadow-Test Runners (Stage 1 + Stage 3)

## Stage 1 — free-eval model comparison (`run-eval-comparison.ts`)

Runs ONE athlete's real payload through the identical CoachState prompt on
several models (default Sonnet / Opus / Fable) and writes, per model, the
evaluation exactly as the athlete would read it, plus a cross-model table of
the internal decisions. Read-only; nothing persisted. Needs only Tiers 1–2
completed.

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
deno run --allow-net --allow-env --allow-read --allow-write \
  scripts/stage3-shadow/run-eval-comparison.ts --user=<uuid>
```

Output in `eval-compare/<user-prefix>/`: `eval-<model>.md` (athlete-facing
read), `decisions.md` (do the models judge differently or just write
differently?), `raw-<model>.json`.

# Skeleton-Model Shadow Test — Runner

**2026-08-10 redesign:** the channel question is settled — every arm receives
the **full CoachState document**. What's compared is the **skeleton-writer
model**. Per athlete: ONE CoachState roll (Fable, matching production), then
one full-document skeleton per model in `--arms`
(default `claude-sonnet-4-6,claude-fable-5`), blinded A/B outlines, machine
rows M1–M6 on each. Read-only against production: `coach_states` is read; on a
cache miss the CoachState is generated in memory and **never persisted**.

Protocol: build the answer key from the letter's `recommended_action`s and
maintain notes in `inputs.md` BEFORE opening any outline; machine rows gate;
score each arm per answer-key item (honored / partial / missed / contradicted,
quote required for re-arguing flags); ties go to the cheaper model.

All arms are single-shot (no audit-retry loop) so the comparison is between
writers, not recovery machinery.

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
