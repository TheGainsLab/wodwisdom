/**
 * signature-autodraft — the generation-time draft hook (rev-61 automation
 * chain, link 1).
 *
 * Every metcon in a generated program ships WITH a signature. The writer's
 * blocks are clean structured JSON (no parse ambiguity) and already carry
 * expected_benchmark from the benchmark stage, so drafting here costs one
 * Sonnet call per NOVEL structure and zero extra work-calc round-trips.
 *
 * HASH DEDUP FIRST: the wsh1_ structure hash is the universal join key —
 * repeated structures reuse one signature across all athletes and time
 * (retroactive claiming already works), so the thousandth "21-15-9
 * thrusters/pull-ups" program drafts nothing.
 *
 * WEIGHT IS EARNED, NOT GRANTED: rows insert at status='draft' (draft-noise
 * x3 downstream — they inform, never dominate) with editorial provenance.
 * Promotion is the validity job's business, not this hook's.
 *
 * BURST DISCIPLINE (audit saga ruling, 2026-11-05): Supabase rate-limits
 * outbound calls per function invocation (~1-minute fixed window, trips
 * around call ~30). MAX_DRAFTS_PER_RUN caps this hook's outbound spend;
 * drafts run SEQUENTIALLY; leftovers are picked up by the next generation
 * or the self-nominating trigger. The hook NEVER throws — a signature
 * failure must never fail a program that saved.
 */

import { composeBlockScheme } from "./compose-block-scheme.ts";
import type { ExpectedBenchmark } from "./compute-block-benchmark.ts";
import type { BlockPrescription, MovementPrescription } from "./v2-output-schema.ts";
import {
  claimEvidence,
  DEFAULT_PROVENANCE,
  draftSignature,
  evidenceHashesFor,
  hashWorkout,
  type MeasuredLibrary,
  type SignatureDraft,
  type SupaLike,
} from "./signature-draft-core.ts";

/** Outbound-budget cap per invocation: each draft is 1–2 Anthropic calls +
 *  2–3 DB calls, so 6 drafts ≈ 20 outbound calls worst case — under the
 *  per-invocation window with room for the save stage's own traffic. */
export const MAX_DRAFTS_PER_RUN = 6;

export interface AutodraftStats {
  /** Metcon blocks seen in the program. */
  metcons: number;
  /** Distinct structure hashes among them (in-program dedup). */
  unique_structures: number;
  /** Hashes already covered by an existing signature (cross-time dedup). */
  reused: number;
  /** New draft rows inserted. */
  drafted: number;
  /** Novel structures left undrafted by the budget cap. */
  budget_skipped: number;
  /** Draft or insert failures (logged, never thrown). */
  failed: number;
}

type DraftFn = (
  workout: BlockPrescription,
  library: MeasuredLibrary | null,
  measured: ExpectedBenchmark | null,
) => Promise<SignatureDraft>;

export interface AutodraftOptions {
  maxDrafts?: number;
  /** Test seam: replaces the Sonnet drafting call. */
  draftFn?: DraftFn;
  /** Test seam: Anthropic key (default: env). */
  apiKey?: string;
}

/** The canonical movement fields — the signature's workout must be the
 *  structure alone, not the writer's coaching freight (notes, scaling,
 *  target_pct_1rm), or identical prescriptions would hash apart. */
const MOVEMENT_FIELDS: Array<keyof MovementPrescription> = [
  "movement",
  "sets",
  "reps",
  "rep_scheme",
  "cal_scheme",
  "distance_scheme",
  "max_effort",
  "weight",
  "weight_women",
  "weight_unit",
  "time_seconds",
  "distance",
  "distance_unit",
  "calories",
];

/** Extract the canonical scoreable structure from a writer block. Null when
 *  the block has no movements (nothing to sign). */
export function canonicalMetconStructure(
  block: BlockPrescription,
): BlockPrescription | null {
  const movements = (block.movements ?? [])
    .filter((m) => typeof m?.movement === "string" && m.movement.trim())
    .map((m) => {
      const out: Record<string, unknown> = {};
      for (const f of MOVEMENT_FIELDS) {
        const v = m[f];
        if (v !== undefined && v !== null) out[f] = v;
      }
      return out as unknown as MovementPrescription;
    });
  if (movements.length === 0) return null;
  const clean: BlockPrescription = { block_type: "metcon", movements };
  // Render the header the same way save-program-v3 does (one-copy rule):
  // the signature's workout jsonb and its structure hash must match what
  // the saved program block carries, or identity drifts from storage.
  const renderedScheme = composeBlockScheme(
    block.scheme_format,
    block.movements ?? [],
    block.time_cap_seconds,
  ) ?? block.block_scheme;
  if (renderedScheme) clean.block_scheme = renderedScheme;
  if (block.scheme_format) clean.scheme_format = block.scheme_format;
  if (block.time_cap_seconds) clean.time_cap_seconds = block.time_cap_seconds;
  return clean;
}

/** A short human name for the review dashboard; uniqueness rides the hash
 *  suffix (unique (source, lower(name)) index). */
function autoName(sig: SignatureDraft, wsh: string): string {
  const label = (sig.archetype ?? "metcon").trim().slice(0, 60);
  return `${label} [${wsh.slice("wsh1_".length, "wsh1_".length + 8)}]`;
}

/**
 * Draft signatures for every novel metcon structure in a generated program.
 * Dedup → draft → insert → retroactive evidence claim. Never throws.
 */
export async function autodraftSignaturesForWeeks(
  supa: SupaLike,
  // deno-lint-ignore no-explicit-any
  weeks: any[],
  opts: AutodraftOptions = {},
): Promise<AutodraftStats> {
  const stats: AutodraftStats = {
    metcons: 0,
    unique_structures: 0,
    reused: 0,
    drafted: 0,
    budget_skipped: 0,
    failed: 0,
  };
  const maxDrafts = opts.maxDrafts ?? MAX_DRAFTS_PER_RUN;

  // ── Collect + in-program dedup ────────────────────────────────────────
  const byHash = new Map<string, { clean: BlockPrescription; measured: ExpectedBenchmark | null }>();
  for (const week of weeks ?? []) {
    for (const day of week?.days ?? []) {
      for (const block of day?.blocks ?? []) {
        if (block?.block_type !== "metcon") continue;
        stats.metcons++;
        const clean = canonicalMetconStructure(block);
        if (!clean) continue;
        const hashes = await evidenceHashesFor(clean);
        const wsh = hashes[0];
        if (!wsh) continue; // a structure the hasher can't read claims nothing
        if (!byHash.has(wsh)) {
          byHash.set(wsh, { clean, measured: block.expected_benchmark ?? null });
        }
      }
    }
  }
  stats.unique_structures = byHash.size;
  if (byHash.size === 0) return stats;

  // ── Cross-time dedup: hashes already claimed by ANY signature ─────────
  const allHashes = [...byHash.keys()];
  const covered = new Set<string>();
  try {
    const { data, error } = await supa
      .from("workout_signatures")
      .select("evidence_hashes")
      .overlaps("evidence_hashes", allHashes);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      for (const h of (row.evidence_hashes ?? []) as string[]) {
        if (byHash.has(h)) covered.add(h);
      }
    }
  } catch (e) {
    // Can't see the library → drafting would duplicate. Bail quietly; the
    // next generation retries.
    console.warn(
      `[signature-autodraft] dedup lookup failed, skipping run: ${(e as Error).message}`,
    );
    stats.failed = byHash.size;
    return stats;
  }
  stats.reused = covered.size;

  const novel = allHashes.filter((h) => !covered.has(h));
  const toDraft = novel.slice(0, maxDrafts);
  stats.budget_skipped = novel.length - toDraft.length;

  const apiKey = opts.apiKey ??
    Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const draft: DraftFn = opts.draftFn ??
    ((w, l, m) => draftSignature(w, l, m, apiKey));

  // ── Draft + insert, SEQUENTIALLY (burst discipline) ───────────────────
  for (const wsh of toDraft) {
    const { clean, measured } = byHash.get(wsh)!;
    try {
      const sig = await draft(clean, null, measured);
      const row = {
        source: "generated",
        name: autoName(sig, wsh),
        workout: clean,
        workout_hash: await hashWorkout(clean),
        evidence_hashes: [wsh],
        demand: sig.demand,
        discrimination: sig.discrimination,
        stimulus: sig.stimulus,
        gates: sig.gates ?? [],
        time_domain: sig.time_domain ?? null,
        format: sig.format ?? null,
        archetype: sig.archetype ?? null,
        rationale: sig.rationale ?? null,
        measured: measured,
        drafted_model: "sonnet",
        status: "draft",
        provenance: DEFAULT_PROVENANCE,
      };
      const { data, error } = await supa
        .from("workout_signatures")
        .insert(row)
        .select("id")
        .single();
      if (error) {
        // 23505 = another invocation drafted the same structure first (the
        // partial unique index on workout_hash for source='generated', or a
        // name collision) — that IS the dedup working. Count it as reuse.
        if (error.code === "23505" || /duplicate key/i.test(error.message ?? "")) {
          stats.reused++;
          continue;
        }
        throw new Error(error.message);
      }
      stats.drafted++;
      // Retroactive join: logged rows waiting on this hash attach now.
      await claimEvidence(supa, (data as { id: string }).id, [wsh]);
    } catch (e) {
      stats.failed++;
      console.warn(
        `[signature-autodraft] draft failed for ${wsh}: ${(e as Error).message}`,
      );
    }
  }

  return stats;
}
