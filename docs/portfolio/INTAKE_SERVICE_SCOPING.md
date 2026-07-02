# Intake / Profile Service — Scoping Report

_Last updated: 2026-07-01. Read-only assessment (no code changed). Basis for the shared
Intake/Profile service in `STRATEGY.md` §3, which has two flavors of one mechanism:
**athlete intake** and **gym/brand methodology intake**._

Question: how much of wodwisdom's tier-3 intake is already channel-agnostic vs. wodwisdom-coupled?

## Headline

The intake pipeline is **~60–65% extractable as-is**. The reusable core is a set of NL→JSON
transforms; the coupling is of two separable kinds — **DB-write glue** (easy to strip: return
JSON, let the surface persist) and **domain prompts** (CrossFit vocab hardcoded in system
prompts, fixable by templatizing + injecting a vocabulary). The **methodology-intake flavor is
mostly greenfield**, but the program-parsing infrastructure (`preprocess-program`) is a real
partial basis.

Two coupling axes, kept distinct (same insight as the Engine extraction): **persistence
coupling ≠ domain coupling.** Most functions are already pure NL→JSON; the fix is moving the
DB write out and parameterizing the prompt, not rewriting the logic.

---

## Function-by-function

| Function / module | LLM prompt | Writes wodwisdom tables? | Verdict |
|---|---|---|---|
| `parse-skills` | agnostic | optional (`program_workout_blocks.parsed_tasks`) | **DB-COUPLED only** — trivial to extract |
| `parse-strength` | agnostic | optional (same) | **DB-COUPLED only** — trivial |
| `parse-accessory` | agnostic | optional (same) | **DB-COUPLED only** — trivial |
| `parse-metcon` | CrossFit formats (AMRAP/RFT/EMOM) | optional (same) | DB + DOMAIN |
| `parse-goal` | CrossFit goal model (Open/QF, block emphasis) | none | DOMAIN (type tied to block types) |
| `parse-injuries` | CrossFit movement vocab | none | DOMAIN (inject vocab) |
| `parse-injuries-constraints` | CrossFit movement vocab | **writes `athlete_profiles`** | DB + DOMAIN |
| `process-coaching-intake` | CrossFit normalization | **writes `athlete_profiles`** | DB + DOMAIN |
| `_shared/coaching-intake.ts` | CrossFit normalization in prompt; **types are generic** | none (pure) | DOMAIN (prompt only) |
| `preprocess-program` | channel-agnostic ("gym/CrossFit/functional-fitness"); vocab injected from `movements` | **writes v3 schema** via `saveProgramV3` | DB-COUPLED + vocab-injection |

Note: the `CoachingIntake`, `ParsedInjury`, `ParsedSkill/Strength/Accessory` types are already
generic (preferences/goals/constraints; region/severity/prohibited-movements; sets/reps/etc.).
The domain lives in prompts, not types. `parse-*` block parsers mostly take `block_text` from an
HTTP body and only touch the DB when a `block_id` is supplied — so the persistence is already
optional and caller-driven.

---

## Athlete-intake flavor — what moves where

- **Moves into the shared service as-is:** the extraction functions (`extractCoachingIntake`,
  the `parse-*` transforms) as pure `NL → typed JSON`, with prompts parameterized by
  `domain`/`vocabulary`.
- **Strip the DB write:** `process-coaching-intake` and `parse-injuries-constraints` currently
  extract *and* write `athlete_profiles` in one function. Split into pure extraction (shared) +
  a wodwisdom-side `persist…()` orchestrator. Same pattern the block parsers already follow.
- **Stays wodwisdom-side:** JWT→user_id auth, RLS, the `athlete_profiles` schema, and the
  CoachState integration.

## Methodology-intake flavor — mostly greenfield, with a real basis

No code does guided methodology capture today (the gym product moved to affiliate-intelligence;
wodwisdom's gym tables are frozen). But two pieces are genuine foundations:

- **`preprocess-program` + `_shared/ingest-program-prompt.ts`** already ingest an
  externally-authored program (paste / Excel / image / PDF) into the generic `WriterOutput`
  schema. That is exactly the "upload your last 3 months and the AI learns how you program"
  path (STRATEGY §5 rung 2) — halfway to methodology intake, just missing the *cross-program
  pattern synthesis* (volume stance, periodization, metcon distribution, skill cadence) into a
  reusable tenant methodology corpus.
- The **corpus `tenant_id`** now exists (migration `20260701000001`), so a synthesized gym
  methodology can be written as that tenant's private corpus and consumed via `corpus_scope`.

What's net-new: a guided methodology questionnaire prompt, a program-history *analysis* step
(pattern extraction across N weeks), and the synthesis into a `tenant` corpus + a structured
methodology object. Estimate: medium–high; reuses the parsing infra, new LLM logic + schema.

---

## Seams to cut, ranked by effort

1. **Decouple DB write from extraction** [LOW] — `process-coaching-intake`,
   `parse-injuries-constraints`: return JSON, move the `athlete_profiles` write to a thin
   wodwisdom orchestrator. The `parse-*` block parsers already model this.
2. **Templatize domain prompts** [LOW–MED] — lift the CrossFit-vocab system prompts into a
   `prompt-templates` module parameterized by `domain` + an injected vocabulary list
   (`coaching-intake`, `parse-goal`, `parse-injuries`, `parse-metcon`).
3. **Vocabulary as a pluggable input** [MED] — `preprocess-program` loads vocab from the
   `movements` table; abstract that so a tenant/domain supplies its own vocabulary.
4. **Consolidate block parsers** [TRIVIAL] — formalize a shared `parseXBlock(text, vocab?)`
   interface; the four `parse-*` functions become thin HTTP wrappers over it.
5. **Generalize the program schema** [MED] — `WriterOutput` is generic but CrossFit-tuned
   (block-type enum). Split a domain-agnostic core from the CrossFit dialect (shared with the
   Domain Pack work in `ENGINE_EXTRACTION.md`).

Seams 1, 2, 4 are the athlete-intake extraction and are cheap. Seams 3, 5 and the methodology
questionnaire/analysis are the methodology-intake flavor and are the larger, later build.

---

## Unknowns
- Prompt versioning across a config layer (tie to the existing `COACHING_INTAKE_VERSION`
  pattern to avoid desync).
- Whether methodology intake should feed a new CoachState dimension ("apply brand methodology")
  — outside intake scope but needed for the two-flavor design to actually steer generation.
