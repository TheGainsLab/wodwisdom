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
    .replace(/[^\p{L}\p{N}:@./-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function hashWorkoutText(
  text: string,
  scheme?: string | null,
  capSeconds?: number | null,
): Promise<string> {
  const canonical = [
    "text",
    normalizeWorkoutText(text),
    normalizeWorkoutText(scheme ?? ""),
    capSeconds && capSeconds > 0 ? String(capSeconds) : "",
  ].join("|");
  return PREFIX + (await sha256Hex(canonical)).slice(0, 32);
}

export interface HashableMovement {
  movement: string;
  reps?: number | number[] | null;
  load_lbs_men?: number | null;
  load_lbs_women?: number | null;
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
    normalizeWorkoutText(s.block_scheme ?? ""),
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
        m.distance ? normalizeWorkoutText(m.distance) : "",
      ].join("~"),
    );
  }
  return PREFIX + (await sha256Hex(parts.join("|"))).slice(0, 32);
}
