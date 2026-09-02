/**
 * movement-name-repair.ts
 *
 * Annotation-in-name repair (2026-09-01, the Ashley failure): the composer
 * emitted "Ring Row (Pull Up scaled) — Pull Up" as a MOVEMENT NAME; the
 * legality audit correctly refused the string twice and a paying customer's
 * month died over punctuation. The movement itself (Ring Row) was a correct
 * coaching decision — the serialization was the defect.
 *
 * FACT PATCH, per doctrine: a string that BEGINS WITH a legal vocabulary name
 * and continues with a parenthesis or dash is a legal movement wearing a
 * label — trim to the legal name, preserve the label in the athlete-visible
 * note, log the repair. Anything else — misspellings, invented compounds,
 * names with word-tails ("Weighted Ring Row to Press") — is left UNTOUCHED
 * and flows to the audits exactly as before: this code unsticks labels, it
 * never guesses meaning.
 *
 * Applied at BOTH emission boundaries:
 *   - composer output (metcons) — the only place a name can hard-fail a job
 *   - fill output (all blocks) — where annotated names silently evade the
 *     do_not_program ban check ("Deadlift (light)" vs banned "Deadlift") and
 *     drop out of benchmarks/tracking (canonical-name keyed)
 *
 * Longest legal prefix wins ("Sumo Deadlift High Pull (light)" must resolve
 * to Sumo Deadlift High Pull, never Sumo Deadlift). Matching is
 * case-insensitive on the RAW string — no normalization tricks — so only
 * exact spellings of legal names qualify as prefixes.
 */

import type { ComposedMetcon } from "./metcon-composer.ts";
import type { WriterOutput } from "./v2-output-schema.ts";

/** Tail must START with unmistakable annotation punctuation. */
const ANNOTATION_TAIL = /^[\s]*[(\-–—]/;

/**
 * Split "Legal Name (annotation…)" into { canonical, tail }. Null when the
 * name is already legal, has no legal prefix, or the tail isn't
 * punctuation-delimited (those cases are not ours to touch).
 */
export function splitAnnotatedMovementName(
  name: string,
  vocabulary: string[],
): { canonical: string; tail: string } | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  let best: string | null = null;
  for (const legal of vocabulary) {
    const l = legal.trim();
    if (!l) continue;
    const ll = l.toLowerCase();
    if (lower === ll) return null; // already legal — nothing to repair
    if (lower.startsWith(ll) && (!best || l.length > best.length)) {
      // Candidate; tail validity checked after longest-match selection.
      best = l;
    }
  }
  if (!best) return null;
  const tail = raw.slice(best.length);
  if (!ANNOTATION_TAIL.test(tail)) return null; // word-tail: not annotation
  return { canonical: best, tail: tail.trim() };
}

/**
 * Trim annotated movement names in a composed metcon month. The trimmed
 * label is appended to the piece's stimulus_note (the athlete-visible pace/
 * intent line) so scaling context survives. Mutates in place; returns
 * human-readable repair lines for the log.
 */
export function trimComposedMovementAnnotations(
  metcons: ComposedMetcon[],
  vocabulary: string[],
): string[] {
  const repairs: string[] = [];
  for (const m of metcons ?? []) {
    for (const mv of m.movements ?? []) {
      const split = splitAnnotatedMovementName(mv.movement, vocabulary);
      if (!split) continue;
      repairs.push(
        `W${m.week_num}D${m.day_num}: movement "${mv.movement}" trimmed to "${split.canonical}" (annotation moved to stimulus_note)`,
      );
      mv.movement = split.canonical;
      const note = (m.stimulus_note ?? "").trim();
      const addendum = `(${split.canonical}: ${split.tail})`;
      m.stimulus_note = note ? `${note} ${addendum}`.slice(0, 300) : addendum.slice(0, 300);
    }
  }
  return repairs;
}

/**
 * Trim annotated movement names across a filled week/program (all block
 * types). The label lands in the movement's own scaling_note — the per-
 * movement spec channel — unless one already exists (then appended).
 * Mutates in place; returns repair lines for the log.
 */
export function trimWriterMovementAnnotations(
  output: WriterOutput,
  vocabulary: string[],
): string[] {
  const repairs: string[] = [];
  for (const week of output.weeks ?? []) {
    for (const day of week.days ?? []) {
      for (const block of day.blocks ?? []) {
        for (const mv of block.movements ?? []) {
          const split = splitAnnotatedMovementName(mv.movement, vocabulary);
          if (!split) continue;
          repairs.push(
            `W${week.week_num}D${day.day_num} ${block.block_type}: movement "${mv.movement}" trimmed to "${split.canonical}"`,
          );
          mv.movement = split.canonical;
          const existing = (mv.scaling_note ?? "").trim();
          mv.scaling_note = existing
            ? `${existing}; ${split.tail}`.slice(0, 200)
            : split.tail.slice(0, 200);
        }
      }
    }
  }
  return repairs;
}
