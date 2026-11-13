/**
 * coach-notes — the athlete's "Tell your coach" notes, read by the Engine
 * sequencer, AI Programming generation and the Coach. Founder decisions
 * 2026-11-12 (docs/engine_self_sequencing_plan.md "Tell your coach" notes).
 *
 *  - A note shapes intensity, emphasis and movement/type choice within the
 *    program's structure. It never changes day count, and it never
 *    overrides an injury or the readiness pool.
 *  - 'next_week' notes are spent per product once that product has written
 *    with them in view (markNotesConsumed), and expire after NOTE_TTL_DAYS
 *    regardless. 'until_removed' notes stay until deleted.
 *  - A recurring note is a goal in disguise: recurringNotes() finds a text
 *    that has been written three or more times so the Coach can offer the
 *    promotion to the profile goal.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const NOTE_TTL_DAYS = 21;
export type NoteProduct = "engine" | "programming";
export type NoteAudience = NoteProduct | "coach";

export interface CoachNote {
  id: string;
  text: string;
  horizon: "next_week" | "until_removed";
  created_at: string;
  expires_at: string | null;
  week_num: number | null;
  consumed_engine_at: string | null;
  consumed_programming_at: string | null;
}

/** Pure: which notes are active for an audience at `now`. The Coach sees
 *  every unexpired note; a product sees only what it has not yet spent. */
export function activeNotes(notes: CoachNote[], audience: NoteAudience, now: Date = new Date()): CoachNote[] {
  const nowMs = now.getTime();
  return notes.filter((n) => {
    if (n.expires_at && new Date(n.expires_at).getTime() <= nowMs) return false;
    if (n.horizon === "next_week") {
      if (audience === "engine" && n.consumed_engine_at) return false;
      if (audience === "programming" && n.consumed_programming_at) return false;
    }
    return true;
  });
}

/** Pure: the prompt block for a product. "" when there is nothing. */
export function formatCoachNotes(notes: CoachNote[], audience: NoteAudience): string {
  if (notes.length === 0) return "";
  const lines = notes.map((n) => {
    const when = n.horizon === "until_removed" ? "standing" : "for the next week";
    const date = n.created_at.slice(0, 10);
    return `  - "${n.text.replace(/\s+/g, " ").trim()}" (${when}, written ${date})`;
  });
  const rule = audience === "coach"
    ? `These are read before every Engine block and every AI-Programming generation. Answer questions about them ` +
      `from this list; never claim one was applied before the next generation.`
    : `Honour each within this program's structure: shape intensity, emphasis and ${audience === "engine" ? "day-type" : "movement"} ` +
      `choice toward it. A note never changes the day count, never overrides an injury or constraint, and never ` +
      `reaches outside what the athlete is ready for. Where a note conflicts with the program's intent, lean ` +
      `toward the note for this week only.`;
  return `ATHLETE'S NOTES FOR THEIR COACH (what they asked for, in their words):\n${lines.join("\n")}\n${rule}\n`;
}

function norm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Pure: texts (normalised to the first written form) that appear
 *  `minTimes` or more across distinct weeks/dates — a goal in disguise. */
export function recurringNotes(notes: CoachNote[], minTimes = 3): Array<{ text: string; times: number }> {
  const groups = new Map<string, { text: string; dates: Set<string> }>();
  for (const n of notes) {
    const k = norm(n.text);
    if (!k) continue;
    const g = groups.get(k) ?? { text: n.text, dates: new Set<string>() };
    g.dates.add(n.created_at.slice(0, 10));
    groups.set(k, g);
  }
  return [...groups.values()].filter((g) => g.dates.size >= minTimes).map((g) => ({ text: g.text, times: g.dates.size }));
}

/** Every note the athlete has, newest first (the reader filters). */
export async function loadCoachNotes(supa: SupabaseClient, userId: string, limit = 60): Promise<CoachNote[]> {
  const { data } = await supa
    .from("coach_notes")
    .select("id, text, horizon, created_at, expires_at, week_num, consumed_engine_at, consumed_programming_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CoachNote[];
}

/** Active notes for an audience, formatted; "" when none. Best-effort. */
export async function buildCoachNotesBlock(
  supa: SupabaseClient,
  userId: string,
  audience: NoteAudience,
): Promise<{ text: string; ids: string[] }> {
  try {
    const active = activeNotes(await loadCoachNotes(supa, userId), audience);
    return { text: formatCoachNotes(active, audience), ids: active.map((n) => n.id) };
  } catch (e) {
    console.warn(`[coach-notes] load failed for ${userId}:`, e instanceof Error ? e.message : String(e));
    return { text: "", ids: [] };
  }
}

/** Spend 'next_week' notes for a product after it has written with them. */
export async function markNotesConsumed(supa: SupabaseClient, ids: string[], product: NoteProduct): Promise<void> {
  if (ids.length === 0) return;
  const col = product === "engine" ? "consumed_engine_at" : "consumed_programming_at";
  await supa.from("coach_notes").update({ [col]: new Date().toISOString() }).in("id", ids).eq("horizon", "next_week")
    .then(() => {}, (e: unknown) => console.warn("[coach-notes] mark consumed failed:", e));
}

/** Spend every unspent 'next_week' note for a product (Programming saves a
 *  whole generation at once and holds texts, not ids). */
export async function markUserNotesConsumed(supa: SupabaseClient, userId: string, product: NoteProduct): Promise<void> {
  const col = product === "engine" ? "consumed_engine_at" : "consumed_programming_at";
  await supa.from("coach_notes").update({ [col]: new Date().toISOString() })
    .eq("user_id", userId).eq("horizon", "next_week").is(col, null)
    .then(() => {}, (e: unknown) => console.warn("[coach-notes] mark user consumed failed:", e));
}

// ── The Coach's second front door ───────────────────────────────────────────

/** Tool the Coach uses to DRAFT a note; the athlete taps Save. Nothing is
 *  written server-side — the card saves through the athlete's own session. */
export function buildProposeCoachNoteTool() {
  return {
    name: "propose_coach_note",
    description:
      "Draft a 'Tell your coach' note from what the athlete just said — a week-scale ask about their training " +
      "(more or less of something, go easier/harder, a travel week, equipment for a week). Renders as a card with " +
      "Save / Not now; nothing is saved unless they tap Save. Read before every Engine block and every " +
      "AI-Programming generation. NOT for durable facts (injuries, days per week, a goal shift) — those are " +
      "propose_profile_update.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: 200, description: "The note, in the athlete's own words, one line. e.g. \"more chest-to-bar pull-ups\"" },
        horizon: { type: "string", enum: ["next_week", "until_removed"], description: "next_week unless they said it is ongoing." },
        rationale: { type: "string", maxLength: 200, description: "One athlete-facing sentence: what this note will do." },
      },
      required: ["text", "horizon", "rationale"],
    },
  };
}

export const COACH_NOTE_PROMPT =
  "\n\nNOTES FOR THE COACH (propose_coach_note): When the athlete asks for a WEEK-SCALE change to their training " +
  "— more or less of a movement or kind of work, go easier or harder next week, a travel or hotel-gym week, " +
  "equipment for a while — draft a note with propose_coach_note. The athlete sees a card with the note and " +
  "Save / Not now; NOTHING is saved unless they tap Save. A saved note is read before every Engine block and " +
  "every AI-Programming generation; it shapes emphasis, dose and movement choice, never the day count. " +
  "ALWAYS call the tool — never write 'save that note' or 'I'll note that' in text: the athlete can only save a " +
  "note you have drafted as a card, and a sentence about saving with no card is a broken promise. " +
  "Horizon is next_week unless they say it is ongoing. Durable facts (injuries, days per week, a goal shift) " +
  "are propose_profile_update instead. One card per message. After they save: say it will be read at the " +
  "next generation — the Engine's next block within days; AI Programming's NEXT WEEK, written after the current week's last day is logged. " +
  "If a RECURRING NOTE line is present below, offer once, in one sentence, to make it part of their goal " +
  "(propose_profile_update goal_append) — only if they agree.";
