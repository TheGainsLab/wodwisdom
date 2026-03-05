# Plan: Session-Intent-Aware Coaching Prompts

## Summary
Add session intent detection to `workout-review/index.ts` so coaching cues vary by *why* the athlete is doing the work, not just *what* block type it is.

## Scope
- **One file changed:** `supabase/functions/workout-review/index.ts`
- **No frontend changes** — output JSON schema is unchanged
- **No RAG changes** — separate improvement
- **No new dependencies**

## Changes

### 1. Define intent types and modifier map (~20 lines)

Add a `SessionIntent` type and an `INTENT_MODIFIERS` map after the existing prompt constants (after line 140).

**Intent types by block:**
- **Strength:** `assessment` | `build` | `technique` | `recovery`
- **Metcon:** `sprint` | `endurance` | `mixed`
- **Skills:** `acquisition` | `practice`

**Each modifier** is a paragraph of additional coaching rules appended to the base prompt's Rules section. Modifiers direct Claude's reasoning focus — they don't encode movement-specific knowledge. Examples:

- `assessment`: Focus on attempt selection, quality standards, stopping criteria, signs of breakdown. De-emphasize generic positional cues.
- `build`: Focus on positional integrity under increasing load, RPE targets, set-to-set consistency.
- `technique`: Identify the specific positional demand this variation is designed to train and focus all cues on that demand. Don't give generic points of performance for the base movement.
- `recovery`: Emphasize movement quality over intensity, breathing, positions neglected when pushing hard.
- `sprint`: Focus on cycle time, transitions, redline management, when to push.
- `endurance`: Focus on pacing, breathing patterns, fatigue indicators, sustainable movement patterns.
- `mixed`: Balance movement efficiency with transition strategy and energy system management.
- `acquisition`: Provide progressions, drills, what "good enough" looks like, scaling that preserves stimulus.
- `practice`: Target specific efficiency gains, timing, positions that separate good from great.

### 2. Add `detectSessionIntent()` function (~30-40 lines)

Takes `blockText: string`, `blockType: string`, and `athleteProfile: AthleteProfileData | null`. Returns the intent string.

**Detection logic — pattern matching on workout text signals:**

**Strength intent:**
- `assessment` — text contains: "1RM", "find a heavy", "build to a heavy single", "max effort", "test"
- `technique` — text contains: "tempo", "pause", "deficit", "slow eccentric", "position work", or variation keywords suggesting a specific positional demand
- `recovery` — text contains: "deload", "@50%", "@55%", "@60%", "light", "recovery", "active rest"
- `build` — default for strength (percentage-based sets, rep schemes like 5x3, 3x5, etc.)

**Metcon intent (primary signal: time domain, secondary: rep count):**
- `sprint` — AMRAP ≤7 min, time cap ≤8 min, EMOM ≤8 min, "sprint", or short round count (≤3) with heavy loading. Rep count <50 is a secondary confirming signal but not sufficient alone (e.g. "3 rounds: 1 snatch + 30 DU" is 93 reps but heavy-light pairing → still sprint if time domain is short).
- `endurance` — AMRAP ≥15 min, uncapped chippers, EMOM ≥20 min, "for time" with high volume and no short cap. Rep count >150 is a secondary confirming signal.
- `mixed` — default for metcon when time domain falls in the middle (8-14 min) or signals conflict

**Skills intent:**
- `acquisition` — athlete profile shows "none" or "beginner" for movements in the block text, OR text contains "progression", "scale", "build up to"
- `practice` — default for skills

**Ambiguity handling:** If signals conflict, default to the most common intent for that block type. Intent detection doesn't need to be perfect — the modifiers are coaching direction, not hard constraints. A slightly wrong intent still produces better output than no intent at all.

### 3. Add `applyIntentModifier()` function (~5 lines)

Takes the base prompt string and intent string. Looks up the modifier in `INTENT_MODIFIERS` and appends it to the prompt before returning. If no modifier found, returns the base prompt unchanged.

### 4. Modify the call site (lines 347-364)

Before each per-block Claude call, detect intent and compose the modified prompt:

```
// Before (current):
STRENGTH_PROMPT + strengthContext

// After:
const strengthIntent = detectSessionIntent(blockTextByType["strength"], "strength", athleteProfile);
applyIntentModifier(STRENGTH_PROMPT, strengthIntent) + strengthContext
```

Same pattern for metcon and skills blocks. Three lines of change per block call.

## What stays the same
- Output JSON schema (`block_type`, `block_label`, `time_domain`, `cues_and_faults`)
- Frontend rendering (MovementCard, CollapsibleBlock)
- RAG pipeline (searchChunks, embedQuery, chunk retrieval)
- Intent summary call (the overall session design call)
- Auth, rate limiting, caching
- `common_faults` field name and structure (corrective actions improvement is a separate item)

## Testing approach
- Deploy to Supabase edge functions
- Test with representative workout texts for each intent type
- Verify JSON output schema is unchanged
- Compare cue quality before/after for same workout with different intents
