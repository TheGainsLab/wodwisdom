// signature-hash — the workout's identity (the universal join key).
//
// Design doc (universal-language layer, 2026-10-31): "the hash is the
// universal join key: tag once per structure, recognize it everywhere."
// Evidence rows carry it from the moment a result is logged; when the
// judge later signs the same structure, every historical row joins the
// signature retroactively — nothing is re-collected.
//
// Two canonical forms, one address space:
//
//   hashWorkoutText(text, scheme?, capSeconds?)
//     v1, for logged free-text blocks. Normalization is deliberately
//     aggressive (case, whitespace, punctuation) so the same whiteboard
//     workout pasted by different gym-mates lands on the same hash —
//     that collision IS the class-leaderboard join.
//
//   hashWorkoutStructure(structure)
//     For parsed/generated BlockPrescription-shaped structures: movements
//     in order with reps/loads, plus scheme and cap. Editing a movement,
//     load or rep count changes the hash — the identity rule the
//     provenance system depends on (an empirical column fitted on one
//     structure must never describe another).
//
// Both return "wsh1_" + first 32 hex chars of SHA-256 — prefixed so a
// future canonicalization change can version the address space (wsh2_)
// without ambiguity about which rule minted a stored hash.

const PREFIX = "wsh1_";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Aggressive text normalization: lowercase, strip punctuation except
 *  digits/letters/colon (times) and @ (loads), collapse whitespace. */
export function normalizeWorkoutText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    // unit tokens: #, lb, lbs, pound(s) -> lb; kg, kgs, kilo(s) -> kg —
    // "95#", "95 lb", "95lbs" must land on one spelling or the
    // class-leaderboard collision works 70% of the time instead of 95%
    .replace(/(\d)\s*#/g, "$1lb")
    .replace(/\b(lbs|lb|pounds?)\b/g, "lb")
    .replace(/\b(kgs|kg|kilos?)\b/g, "kg")
    .replace(/[^\p{L}\p{N}:@./-]+/gu, " ")
    // join a number to its unit: "95 lb" == "95lb"
    .replace(/(\d)\s+(lb|kg)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse free-text scheme descriptions onto a small enum before
 *  hashing — "AMRAP", "amrap 12", "AMRAP 12 min" are one scheme (the
 *  duration already rides the cap field), and parser drift must not
 *  defeat the class-leaderboard collision. */
export function canonicalScheme(scheme: string | null | undefined): string {
  const t = (scheme ?? "").toLowerCase();
  if (/\bamrap\b/.test(t)) return "amrap";
  if (/\bemom\b|every\s+\d+\s*min/.test(t)) return "emom";
  if (/interval/.test(t)) return "intervals";
  if (/ladder|ascending|descending/.test(t)) return "ladder";
  if (/for\s*time|\brft\b|rounds\s+for\s+time/.test(t)) return "for_time";
  return t ? "other" : "";
}

export async function hashWorkoutText(
  text: string,
  scheme?: string | null,
  capSeconds?: number | null,
): Promise<string> {
  const canonical = [
    "text",
    normalizeWorkoutText(text),
    canonicalScheme(scheme),
    capSeconds && capSeconds > 0 ? String(capSeconds) : "",
  ].join("|");
  return PREFIX + (await sha256Hex(canonical)).slice(0, 32);
}

export interface HashableMovement {
  movement: string;
  reps?: number | number[] | null;
  load_lbs_men?: number | null;
  load_lbs_women?: number | null;
  /** generic single-load form ("95lbs", "50lb db") for structures that
   *  carry one prescribed weight rather than gendered pairs */
  load?: string | null;
  distance?: string | null;
}

export interface HashableStructure {
  block_scheme?: string | null;
  time_cap_seconds?: number | null;
  movements: HashableMovement[];
}

export async function hashWorkoutStructure(s: HashableStructure): Promise<string> {
  const parts: string[] = [
    "struct",
    canonicalScheme(s.block_scheme),
    s.time_cap_seconds && s.time_cap_seconds > 0 ? String(s.time_cap_seconds) : "",
  ];
  for (const m of s.movements) {
    const reps = Array.isArray(m.reps) ? m.reps.join(",") : m.reps != null ? String(m.reps) : "";
    parts.push(
      [
        normalizeWorkoutText(m.movement),
        reps,
        m.load_lbs_men != null ? String(m.load_lbs_men) : "",
        m.load_lbs_women != null ? String(m.load_lbs_women) : "",
        m.load ? normalizeWorkoutText(m.load) : "",
        m.distance ? normalizeWorkoutText(m.distance) : "",
      ].join("~"),
    );
  }
  return PREFIX + (await sha256Hex(parts.join("|"))).slice(0, 32);
}
