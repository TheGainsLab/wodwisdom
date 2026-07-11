# Injury Intake Safety — Implementation Tickets (PR 1: items 1.1–1.5 + Priority 2)

Derived from `docs/injury_intake_safety_handoff.md`. One PR. Line anchors verified 2026-07 against `main`; treat the described behavior as the contract if lines drift.

## Status (2026-07-11)
- **T0 (schema)** — DONE. `supabase/migrations/20260711000000_injury_avoidance_confirmed.sql`. Run in the SQL editor before deploying the edge fns.
- **T4 (read confirmed, non-degrading)** — DONE. `build-writer-payload.ts`. Prefers the confirmed list; falls back to raw parse when no valid confirmation, so no protection gap pre-T1.
- **T5 (provenance, no schema change)** — DONE. `build-writer-payload.ts`, derived `blocked_by` map on `InjuryConstraints`.
- **T3 (generation guard)** — DONE but **flag-gated OFF**. `generate-program-v3/index.ts`. Enforce by setting env `INJURY_CONFIRMATION_ENFORCED=true` — ONLY after T1 (show-back) + T6 (existing-user migration) ship, else every injury-having user is blocked with no way to confirm. While off, it logs a would-block for observability and also fixes the previously-blind parse fetch (now checks HTTP status).
- **T1 (show-back UI)** — DONE. `parse-injuries-constraints` now returns `hash`; `AthletePage.tsx` drives a show-back panel after a save that re-parses non-empty injuries: shows the extracted list against the athlete's verbatim words, allows remove/add, and on confirm writes `injuries_avoidance_confirmed` (bound to the text hash) directly to `athlete_profiles`.
- **T2 (failure UX)** — DONE (scope amended). Bounded retry (3 attempts, linear backoff) on the client parse; on persistent failure a structured `{tag:"injury_parse_failed"}` log is emitted (client + both server paths) and the athlete drops into the manual add-avoidances panel. **No dedicated ops-alert channel is built** — reasoning: a *persistent* parse failure is almost always a global Claude/model issue (e.g. model-snapshot retirement) that also fails generation itself (which calls Claude 8+ times), so it surfaces via wholesale generation-job failures + the existing model-pinning playbook, not an injury-specific alert; and there is no error-tracking sink wired into these fns to hook into. The structured log tag is the queryable signal instead.
- **Guard hardening (this pass)** — the guard now hashes the CURRENT `injuries_constraints` text itself (`sha256Hex`) instead of trusting the stored `injuries_constraints_hash` (which only a successful parse updates). Closes the silent-stale-protection gap (edited-but-unparsed text was reading as still-confirmed) and makes the guard independent of parse-service health. Manual confirm computes the same hash **locally** (Web Crypto) — never via the LLM parser — so a parser outage never leaves an edited-text athlete with no path to confirm. All three hash sites (parser / guard / client) are byte-identical SHA-256 (verified against a known vector).
- **T6 (per-gen avoidance record + existing-user one-time show-back)** — DONE.
  - *Migration show-back:* the profile fetch now loads `injuries_structured` / `injuries_constraints_hash` / `injuries_avoidance_confirmed`; an existing user with non-empty injuries and no valid confirmation is proactively prompted (top-of-page banner → the same T1 panel, pre-populated from the raw parse as a PENDING proposal, never auto-confirmed, bound to the current text hash). Self-drains: confirming sets a valid confirmation → prompt stops.
  - *Per-generation record:* new `program_generation_avoidances` table (migration `20260711000000`); `generate-program-v3` writes the effective avoidance list WITH T5 `blocked_by` tags after each successful cycle save (best-effort, idempotent on `(program_id, month_number)`, `ON DELETE CASCADE` from programs for GDPR 3.1).

**Flag-on criteria (INJURY_CONFIRMATION_ENFORCED):** flip when EITHER the unconfirmed-existing-user count hits zero OR a two-week proactive-prompt window has elapsed, whichever first, AND parse failures are logged queryably (the `injury_parse_failed` structured tag — amended from "the ops alert is live", since a dedicated alert isn't being built). After flag-on, a straggler hits the block with the migration show-back as the immediate unblock path — and confirmation there is LLM-independent, so even a concurrent parser outage can't dead-end them.

**Deploy order for what's done (T0/T1/T3/T4/T5/T6 + T2-partial):** run the migration (`20260711000000` — both the column and the `program_generation_avoidances` table) → deploy `parse-injuries-constraints`, `generate-program-v3` (+ anything importing `build-writer-payload.ts`) → deploy the frontend. Leave `INJURY_CONFIRMATION_ENFORCED` unset. Live behavior: generation unchanged (T4 fallback + guard dormant); new visible surfaces are the post-save show-back and the existing-user migration banner. Run the two-week prompt window; complete full T2; flip the flag per criteria. PR done at flag-on with T2 complete.

## Architecture note (read first — it shapes every ticket)

There are **two** parse entry points and **one** read point. All three change:

1. **Client fire-and-forget** — `AthletePage.tsx:976` invokes `parse-injuries-constraints` after profile save, `.catch → console.warn`. This is where **show-back (1.1)** and **failure UX (1.2)** attach.
2. **Server-to-server, pre-generation** — `generate-program-v3/index.ts:96-109` re-invokes the parser (hash-guarded no-op when current) before `buildWriterPayload`, wrapped in `try/catch → console.warn` and **never checks the response status**. This is where the **generation guard (1.3)** attaches — it's the last line of defense.
3. **The read** — `build-writer-payload.ts:585-589` reads `injuries_structured.do_not_program` and flattens it with equipment blocks. Today `injuries_structured` IS the active filter with no confirmation gate. After 1.1 it must read the **confirmed** list instead.

**Core data-model change (underpins 1.1, 1.3, 1.6):** confirmation is bound to the *exact text* via the existing `injuries_constraints_hash`. A confirmed list is only valid for the hash it was confirmed against; editing the text invalidates confirmation automatically. This makes 1.6 (re-parse routes through confirmation) fall out for free.

---

## T0 — Schema: add the confirmation gate (do first; everything depends on it)

**File:** new migration, applied via Supabase SQL editor (idempotent, copy-paste — per team convention, not `db push`).

**Table:** `athlete_profiles`. Existing injury columns: `injuries_constraints text`, `injuries_structured jsonb` (`{summary, do_not_program[], suggested_subs[]}`), `injuries_constraints_hash text`.

**Add:**
- `injuries_avoidance_confirmed jsonb` — the ACTIVE safety filter. Shape:
  ```json
  {
    "do_not_program": ["Snatch", "..."],
    "confirmed_at": "2026-07-11T...Z",
    "confirmed_against_hash": "<sha256 of the injuries_constraints text at confirm time>"
  }
  ```
  Null = never confirmed.

**Semantics introduced:**
- `injuries_structured` becomes the *latest parse output* = a **pending proposal**.
- `injuries_avoidance_confirmed` is what downstream trusts.
- A confirmation is **valid** iff `injuries_avoidance_confirmed.confirmed_against_hash === injuries_constraints_hash` (i.e. confirmed against the current text). Any text edit → hash changes → confirmation stale.

**Acceptance:** migration is idempotent (`add column if not exists`); no backfill that fabricates confirmation (see T6 for the migration-of-existing-users decision).

---

## T1 — Show-back confirmation UI + persistence (handoff 1.1)

**Files:** `AthletePage.tsx` (injuries section ~1485-1496 + the save/parse flow ~890-980); `parse-injuries-constraints/index.ts` (return shape already gives `structured`).

**Change:**
1. After the client parse returns (replace the fire-and-forget at `AthletePage.tsx:976`), render the extracted list **against the athlete's verbatim words**, not as a bare list:
   > You wrote: *"<their exact injuries_constraints text>"*
   > → We'll avoid programming: **<do_not_program joined>**. Is this right?
   The verbatim-beside-extraction framing is required — a bare list is blind to *omission* (a missed injury produces a plausible list the athlete confirms without noticing the gap).
2. Controls: **Confirm** / **Edit** (re-type → re-parse → re-show) / **add or remove** individual movements.
3. On Confirm, write `injuries_avoidance_confirmed = { do_not_program: <final edited list>, confirmed_at: now, confirmed_against_hash: <current injuries_constraints_hash> }`. Manual add/remove edits the list *before* it's written — the confirmed list is the athlete's final word, which may differ from the raw parse.
4. Until confirmed, `injuries_avoidance_confirmed` for the current hash stays null/stale → the list is `pending_confirmation`.

**Acceptance:**
- Editing the injuries text and saving clears the effective confirmation (hash mismatch) and re-triggers show-back.
- The confirmed list, including manual add/remove, is exactly what T4 reads.
- Confirmation event (timestamp + list) is persisted, not just held in component state.

---

## T2 — Client failure handling (handoff 1.2)

**File:** `AthletePage.tsx` parse invocation (~976); optional shared retry helper.

**Change:**
- Bounded retry with backoff on transient failure (network / 5xx from `parse-injuries-constraints`).
- On persistent failure: (a) emit to error tracking / ops channel — **not** `console.warn`; (b) show the athlete "We couldn't process your injury notes — please review this list manually" and drop them into a **manual add-avoidances UI** (reuse the T1 add/remove control with an empty starting list). A manually built list still writes `injuries_avoidance_confirmed` (confirmed_against_hash = current) — manual entry is a valid confirmation path.
- Never land in "injuries text exists, no avoidance list, no signal."

**Acceptance:** with the edge function forced to 500, the athlete sees the manual fallback and can produce a confirmed list; an alert fires to the ops surface (not just console).

---

## T3 — Generation guard (handoff 1.3)

**File:** `generate-program-v3/index.ts:93-115` (the existing pre-payload parse block).

**Current:** fires the parse fetch, ignores its response, `catch → console.warn`, then builds the payload off whatever `injuries_structured` happens to be — including null (→ empty avoidance) after a failed parse.

**Change — block by default:** after the parse refresh, before `buildWriterPayload`, load the profile's `injuries_constraints` + `injuries_constraints_hash` + `injuries_avoidance_confirmed` and check:
- `injuries_constraints` is non-empty (not blank / not "none" per the existing regex at `parse-injuries-constraints:216`), **AND**
- confirmation is missing or stale (`injuries_avoidance_confirmed` null, or `confirmed_against_hash !== injuries_constraints_hash`)

→ **fail the job** with a clear, athlete-facing reason ("Your injury notes need review before we generate — open your profile to confirm your avoidances"). Do not silently generate.

- The parse fetch must also stop being blind: check its response `ok`/status and treat a hard failure as "unconfirmed" (→ blocked), not as "proceed."
- **Escape hatch is optional and out of scope for v1.** If later added, it is an explicit client action that writes a *logged, signed acknowledgment* (same shape as the T1 confirmation event) — never a fire-and-forget dismiss. Default remains block.

**Acceptance:** an athlete with non-empty, unconfirmed injuries cannot start a generation; the job fails fast with an actionable message rather than producing a program with no injury protection.

---

## T4 — Read the confirmed list, not the raw parse (wires T0/T1 into generation)

**File:** `build-writer-payload.ts:574-590`.

**Current (585-589):**
```
do_not_program: Array.from(new Set([...baseInjuriesStructured.do_not_program, ...equipmentBlocked])).sort()
```
reads `profile.injuries_structured` (the pending proposal).

**Change:** source the injury avoidances from `injuries_avoidance_confirmed.do_not_program` (the confirmed list), gated on hash validity (`confirmed_against_hash === injuries_constraints_hash`). If confirmation is missing/stale, the injury contribution is **empty** — but T3 has already blocked that path, so in practice a generated program always reflects a confirmed list. Add the profile columns to the select list at `build-writer-payload.ts:394-397`.

**Acceptance:** the writer's `do_not_program` equals `confirmed injury list ∪ equipment blocks`; the raw/pending `injuries_structured` never reaches the writer on its own.

---

## T5 — Provenance at merge, no schema change (handoff Priority 2)

**File:** `build-writer-payload.ts:579-590`.

**Current:** injury list and `equipmentBlocked` (computed fresh on 579) are flattened into one sorted `Set<string>` — source is lost.

**Change:** stop flattening. At the merge point both sources are already separate, so tag each movement `blocked_by: 'equipment' | 'injury' | 'both'` in the payload the writer sees. **Derived at merge, recomputed every generation — no new column, no migration, no persisted `blocked_by`.** Update `InjuryConstraints`/payload types and any downstream consumer that assumes a flat `string[]` (grep `do_not_program` consumers, incl. `audits.ts:427` and `generate-program-v3/index.ts:164`).

**Rationale to preserve in code comment:** equipment blocks are situational (a "full gym this week" toggle may lift them); injury blocks are bodily and may only be lifted via the T1 confirmation flow. A future equipment toggle must not be able to lift injury protections — the tag is what keeps them separable.

**Acceptance:** an injury-and-equipment-blocked movement shows `both`; an equipment-only block shows `equipment`; a hypothetical equipment-toggle that clears equipment blocks leaves `injury`/`both` movements blocked.

---

## T6 — Per-generation avoidance record (handoff 1.5)

**Files:** migration (T0's file or a sibling); the save-program step in `generate-program-v3` (where the finished program is persisted).

**Change:** when a program is generated, persist the **effective avoidance list that gated it** (the merged confirmed-injury ∪ equipment set, with provenance) alongside the program row — e.g. `program_generation_avoidances jsonb` on the program, or a small `program_avoidance_log(program_id, generated_at, avoidances jsonb)`. This is distinct from the T1 confirmation event (what the athlete signed off on) — it records what each specific program actually applied, for dispute defensibility.

**Existing-user migration (the T0 open question, resolved here):** do **not** backfill `injuries_avoidance_confirmed` for existing athletes with injury text — that would fabricate a signature. Instead, treat existing unconfirmed users as "needs review": the next generation is blocked by T3 until they confirm (one-time show-back on their existing extracted list). Surface this proactively in the profile UI so it isn't discovered at generate-time.

**Acceptance:** every generated program is traceable to the exact avoidance list active at its creation; no existing user is auto-confirmed without an explicit action.

---

## Not in this PR (recorded for sequencing)
- **1.6 re-parse routing** — falls out of T0's hash binding (a better-model re-parse changes `injuries_structured` but not `injuries_avoidance_confirmed`; the hash still matches, so nothing goes active until re-shown). Add the explicit "re-parse → re-show" trigger when the model upgrade actually happens.
- **3.1 consent/deletion, 3.2 owner-feed exclusion, 4.1 cold-start verify, 4.2 field counters, 4.3 equipment hint** — separate small PRs per the handoff sequencing.

## Suggested build order within the PR
T0 → T4 (read path compiles against the new column) → T5 (provenance, same function) → T3 (guard) → T1 (show-back) → T2 (failure UX) → T6 (per-gen record + existing-user handling). T1/T2 are the largest surface; T0/T4/T5 are small and unblock the rest.
