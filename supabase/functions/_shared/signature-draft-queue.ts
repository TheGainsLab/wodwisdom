/**
 * signature-draft-queue — every workout gets a signature, through one door.
 *
 * Founder rulings (2026-11-05):
 *   - EVERY workout needs a signature: generated programs, block edits,
 *     logged outside workouts.
 *   - NO family-matching rules: the judge sees each structure and drafts
 *     it. The only reuse is exact identity (same wsh1_ hash). Near-twins
 *     get their own row; consistency comes from ratified exemplars in the
 *     draft context, not from sharing rows (sharing would score one
 *     structure's results against another's prediction — silent drift).
 *
 * Architecture (mirrors the v3 dispatcher's correctness model):
 *   - Producers ENQUEUE and fire one retrigger; they never draft. The save
 *     invocation keeps its outbound budget, and there is one drafting
 *     implementation.
 *   - The signature-draft-worker DRAINS: atomic claim (single-drainer
 *     lease + FOR UPDATE SKIP LOCKED in claim_signature_drafts), a small
 *     sequential batch per invocation (per-invocation outbound budget,
 *     saga ruling 2026-11-05), self-retrigger while the queue is nonempty.
 *   - The reaper (job-reaper + reap_signature_drafts) is the GUARANTEE;
 *     the retrigger chain is only a latency optimization.
 *   - The single-drainer lease doubles as the global Anthropic in-flight
 *     cap; signature_draft_queue_gauge is the depth-by-age dial.
 */

import { composeBlockScheme } from "./compose-block-scheme.ts";
import {
  composeEngineVersion,
  computeBlockBenchmarkExplained,
  type ExpectedBenchmark,
} from "./compute-block-benchmark.ts";
import type { Gender } from "./compute-benchmarks.ts";
import type { BlockPrescription, MovementPrescription } from "./v2-output-schema.ts";
import { canonicalScheme, hashWorkoutText } from "./signature-hash.ts";
import {
  claimEvidence,
  DEFAULT_PROVENANCE,
  draftSignature,
  evidenceHashesFor,
  hashWorkout,
  type MeasuredLibrary,
  parseWorkout,
  type SignatureDraft,
  type SignatureExemplar,
  type SupaLike,
} from "./signature-draft-core.ts";

/** Jobs per worker invocation: each can cost a parse + a draft (+ repair)
 *  + a measure + a handful of DB calls (~7 outbound worst case), so 4 keeps
 *  the invocation safely under the platform's per-invocation outbound
 *  window (trips around ~30 calls — saga measurement, 2026-11-05). */
export const DRAFT_BATCH_SIZE = 4;

// ============================================================
// Canonical structure extraction (shared by enqueue + worker)
// ============================================================

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

/** Extract the canonical scoreable structure from a block. Null when the
 *  block has no movements (nothing to sign). */
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

// ============================================================
// Enqueue (producers: generation save stages, block edits, logged text)
// ============================================================

export interface EnqueueStats {
  /** Metcon blocks seen. */
  metcons: number;
  /** Distinct structure hashes among them. */
  unique_structures: number;
  /** Hashes already covered by an existing signature. */
  already_signed: number;
  /** New queue rows inserted. */
  enqueued: number;
  /** Hashes already queued/claimed (the queue's own dedup). */
  already_queued: number;
  /** Enqueue errors (logged, never thrown). */
  failed: number;
}

function emptyStats(): EnqueueStats {
  return {
    metcons: 0,
    unique_structures: 0,
    already_signed: 0,
    enqueued: 0,
    already_queued: 0,
    failed: 0,
  };
}

function isDupError(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === "23505" || /duplicate key/i.test(e.message ?? ""));
}

/** Which of these hashes does any signature already claim? */
async function signedHashes(supa: SupaLike, hashes: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  if (hashes.length === 0) return covered;
  const { data, error } = await supa
    .from("workout_signatures")
    .select("evidence_hashes")
    .overlaps("evidence_hashes", hashes);
  if (error) throw new Error(error.message);
  const want = new Set(hashes);
  for (const row of data ?? []) {
    for (const h of (row.evidence_hashes ?? []) as string[]) {
      if (want.has(h)) covered.add(h);
    }
  }
  return covered;
}

async function insertQueueRow(
  supa: SupaLike,
  row: Record<string, unknown>,
): Promise<"enqueued" | "already_queued"> {
  const { error } = await supa.from("signature_draft_queue").insert(row);
  if (error) {
    if (isDupError(error)) return "already_queued";
    throw new Error(error.message);
  }
  return "enqueued";
}

/**
 * Enqueue every metcon structure in a generated program. Never throws.
 * The caller fires the worker retrigger afterwards (triggerDraftWorker).
 */
export async function enqueueSignatureDraftsForWeeks(
  supa: SupaLike,
  // deno-lint-ignore no-explicit-any
  weeks: any[],
  enqueuedBy: string,
): Promise<EnqueueStats> {
  const stats = emptyStats();
  const byHash = new Map<string, { clean: BlockPrescription; measured: ExpectedBenchmark | null }>();
  try {
    for (const week of weeks ?? []) {
      for (const day of week?.days ?? []) {
        for (const block of day?.blocks ?? []) {
          if (block?.block_type !== "metcon") continue;
          stats.metcons++;
          const clean = canonicalMetconStructure(block);
          if (!clean) continue;
          const wsh = (await evidenceHashesFor(clean))[0];
          if (!wsh) continue; // a structure the hasher can't read claims nothing
          if (!byHash.has(wsh)) {
            byHash.set(wsh, { clean, measured: block.expected_benchmark ?? null });
          }
        }
      }
    }
    stats.unique_structures = byHash.size;
    if (byHash.size === 0) return stats;

    const covered = await signedHashes(supa, [...byHash.keys()]);
    stats.already_signed = covered.size;

    for (const [wsh, { clean, measured }] of byHash) {
      if (covered.has(wsh)) continue;
      try {
        const outcome = await insertQueueRow(supa, {
          kind: "structure",
          workout_hash: wsh,
          payload: { workout: clean, measured },
          priority: 0,
          enqueued_by: enqueuedBy,
        });
        stats[outcome]++;
      } catch (e) {
        stats.failed++;
        console.warn(`[signature-queue] enqueue failed for ${wsh}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    stats.failed++;
    console.warn(`[signature-queue] enqueue sweep failed: ${(e as Error).message}`);
  }
  return stats;
}

/** Enqueue one edited block (apply-block-edit). Never throws. */
export async function enqueueSignatureDraftForBlock(
  supa: SupaLike,
  block: BlockPrescription,
  enqueuedBy: string,
  measured: ExpectedBenchmark | null = null,
): Promise<EnqueueStats> {
  const weeks = [{ week_num: 1, days: [{ day_num: 1, blocks: [{ ...block, expected_benchmark: measured }] }] }];
  return await enqueueSignatureDraftsForWeeks(supa, weeks, enqueuedBy);
}

/**
 * Enqueue a logged outside workout (free text). Priority 1: evidence is
 * already waiting on this hash — a blocked athlete profile outranks
 * program inventory. Never throws.
 */
export async function enqueueSignatureDraftForLoggedText(
  supa: SupaLike,
  text: string,
  blockScheme: string | null,
  timeCapSeconds: number | null,
  enqueuedBy: string,
): Promise<EnqueueStats> {
  const stats = emptyStats();
  stats.metcons = 1;
  try {
    if (!text?.trim()) return stats;
    const textHash = await hashWorkoutText(text, blockScheme, timeCapSeconds);
    stats.unique_structures = 1;
    const covered = await signedHashes(supa, [textHash]);
    if (covered.size > 0) {
      stats.already_signed = 1;
      return stats;
    }
    const outcome = await insertQueueRow(supa, {
      kind: "text",
      workout_hash: textHash,
      payload: { text, block_scheme: blockScheme, time_cap_seconds: timeCapSeconds },
      priority: 1,
      enqueued_by: enqueuedBy,
    });
    stats[outcome]++;
  } catch (e) {
    stats.failed++;
    console.warn(`[signature-queue] logged-text enqueue failed: ${(e as Error).message}`);
  }
  return stats;
}

export function formatEnqueueStats(s: EnqueueStats): string {
  return `metcons=${s.metcons} unique=${s.unique_structures} already_signed=${s.already_signed} enqueued=${s.enqueued} already_queued=${s.already_queued} failed=${s.failed}`;
}

/** Fire-and-forget worker kick. The chain is a latency optimization — a
 *  lost kick is picked up by the reaper — so failures only log. */
export async function triggerDraftWorker(
  supabaseUrl: string,
  serviceKey: string,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/signature-draft-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ kick: true }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[signature-queue] worker kick failed (reaper will sweep): ${(e as Error).message}`);
  }
}

// ============================================================
// Worker side: process a claimed batch
// ============================================================

export interface QueueJob {
  id: string;
  kind: "structure" | "text";
  workout_hash: string;
  // deno-lint-ignore no-explicit-any
  payload: any;
  attempts: number;
}

export interface ProcessDeps {
  apiKey?: string;
  maxAttempts?: number;
  /** Renews the single-drainer lease between jobs; returns false when the
   *  lease was lost (the batch stops and requeues its remainder, so two
   *  drainers never draft at once — the lease IS the global in-flight cap). */
  heartbeatFn?: () => Promise<boolean>;
  draftFn?: (
    workout: BlockPrescription,
    library: MeasuredLibrary | null,
    measured: ExpectedBenchmark | null,
    exemplars: SignatureExemplar[],
  ) => Promise<SignatureDraft>;
  parseFn?: (text: string) => Promise<BlockPrescription>;
  measureFn?: (
    workout: BlockPrescription,
    gender: Gender,
  ) => Promise<ExpectedBenchmark | null>;
}

export interface ProcessStats {
  done: number;
  already_signed: number;
  failed_retry: number;
  failed_final: number;
}

/** Typical relative spread for this duration/scoring class — the piece of
 *  the measured library that needs no workout name. */
async function durationLibrary(
  supa: SupaLike,
  workout: BlockPrescription,
  medianSeconds: number | null,
): Promise<MeasuredLibrary | null> {
  const basisSeconds = medianSeconds ?? workout.time_cap_seconds ?? null;
  if (!basisSeconds || basisSeconds <= 0) return null;
  const repScored = /\bamrap\b|\bemom\b/i.test(workout.block_scheme ?? "");
  const { data: bins } = await supa.from("signature_duration_curve")
    .select("bin_min_s, bin_max_s, median_rel_iqr")
    .eq("competition_type", "open").eq("rep_scored", repScored);
  if (!bins || bins.length === 0) return null;
  const nearest = (bins as Array<{ bin_min_s: number; bin_max_s: number; median_rel_iqr: number }>)
    .map((b) => ({ b, d: Math.abs((b.bin_min_s + b.bin_max_s) / 2 - basisSeconds) }))
    .sort((a, z) => a.d - z.d)[0];
  return { expected_rel_iqr: Number(nearest.b.median_rel_iqr) };
}

/** Nearest ratified signatures by format + time domain — the consistency
 *  anchors that keep unreviewed drafts in line with reviewed ones. */
async function fetchExemplars(
  supa: SupaLike,
  workout: BlockPrescription,
  timeDomain: string | null,
): Promise<SignatureExemplar[]> {
  const format = canonicalScheme(workout.block_scheme) || null;
  let q = supa.from("workout_signatures")
    .select("name, archetype, time_domain, format, demand, discrimination, stimulus, gates")
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(3);
  if (format) q = q.eq("format", format);
  if (timeDomain) q = q.eq("time_domain", timeDomain);
  const { data } = await q;
  if (data && data.length > 0) return data as SignatureExemplar[];
  if (!timeDomain) return [];
  // Relax the format filter before giving up.
  const { data: wide } = await supa.from("workout_signatures")
    .select("name, archetype, time_domain, format, demand, discrimination, stimulus, gates")
    .eq("status", "approved")
    .eq("time_domain", timeDomain)
    .order("approved_at", { ascending: false })
    .limit(3);
  return (wide ?? []) as SignatureExemplar[];
}

/** A short human name for the review dashboard; uniqueness rides the hash
 *  suffix (unique (source, lower(name)) index). */
function autoName(sig: SignatureDraft, wsh: string): string {
  const label = (sig.archetype ?? "metcon").trim().slice(0, 60);
  const suffix = wsh.startsWith("wsh1_") ? wsh.slice(5, 13) : wsh.slice(0, 8);
  return `${label} [${suffix}]`;
}

async function markJob(
  supa: SupaLike,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supa.from("signature_draft_queue")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn(`[signature-worker] job ${id} mark failed: ${error.message}`);
}

/**
 * Draft one claimed job: resolve the structure (parse for text jobs),
 * re-check "already signed" AT CLAIM TIME, measure if the enqueuer didn't,
 * gather context (rel_iqr + ratified exemplars), draft, insert, claim
 * evidence. Throws on failure — processClaimedJobs owns retry accounting.
 */
async function draftOneJob(
  supa: SupaLike,
  job: QueueJob,
  deps: ProcessDeps,
): Promise<"done" | "already_signed"> {
  const apiKey = deps.apiKey ??
    Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const parse = deps.parseFn ?? ((t: string) => parseWorkout(t, apiKey));
  const measureFn = deps.measureFn ??
    (async (w: BlockPrescription, g: Gender) => (await computeBlockBenchmarkExplained(w, g)).bench);
  const draft = deps.draftFn ??
    ((w, l, m, ex) => draftSignature(w, l, m, apiKey, ex));

  // 1. Resolve the canonical structure.
  let raw: BlockPrescription;
  let sourceText: string | undefined;
  if (job.kind === "text") {
    sourceText = String(job.payload?.text ?? "");
    raw = await parse(sourceText);
  } else {
    raw = job.payload?.workout as BlockPrescription;
  }
  const clean = canonicalMetconStructure(raw);
  if (!clean) throw new Error("no signable structure (no movements)");

  // 2. The hashes this signature will claim (structure always; text too for
  //    logged jobs, so the waiting evidence row joins).
  const hashes = await evidenceHashesFor(clean, sourceText);
  if (hashes.length === 0) throw new Error("structure produced no hashes");

  // 3. Re-check signed at claim time (another run may have signed it since
  //    enqueue). Exact identity only. If an existing row covers the
  //    STRUCTURE but not this job's text hash, teach it the text hash —
  //    same structure, lenient joining by design.
  const checkHashes = [...new Set([...hashes, job.workout_hash])];
  if (await attachToExistingSignature(supa, checkHashes)) {
    return "already_signed";
  }

  // 4. Measured context: the enqueuer's benchmark when it rode along
  //    (generation blocks), computed fresh otherwise (reference cohort).
  let measured = (job.payload?.measured ?? null) as ExpectedBenchmark | null;
  if (!measured) {
    try {
      measured = await measureFn(clean, "men");
    } catch (e) {
      console.warn(`[signature-worker] measure failed (drafting without): ${(e as Error).message}`);
      measured = null;
    }
  }

  // 5. Context: duration-class spread + ratified precedents. Best-effort.
  let library: MeasuredLibrary | null = null;
  let exemplars: SignatureExemplar[] = [];
  try {
    library = await durationLibrary(supa, clean, measured?.median_seconds ?? null);
  } catch (_) { /* judgment proceeds without spread context */ }
  try {
    exemplars = await fetchExemplars(supa, clean, measured?.time_domain ?? null);
  } catch (_) { /* judgment proceeds without precedents */ }

  // 6. The judgment seat.
  const sig = await draft(clean, library, measured, exemplars);

  // 7. Insert at draft weight. engine_version rides the measured snapshot
  //    so a curve rebuild can stale-mark it like evidence rows.
  const row = {
    source: "generated",
    name: autoName(sig, hashes[0]),
    workout: clean,
    workout_hash: await hashWorkout(clean),
    evidence_hashes: [...new Set([...hashes, job.workout_hash])],
    demand: sig.demand,
    discrimination: sig.discrimination,
    stimulus: sig.stimulus,
    gates: sig.gates ?? [],
    time_domain: sig.time_domain ?? null,
    format: sig.format ?? null,
    archetype: sig.archetype ?? null,
    rationale: sig.rationale ?? null,
    measured: measured
      ? { ...measured, engine_version: composeEngineVersion(measured.calc_version) }
      : null,
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
    if (isDupError(error)) {
      // Lost the insert race = dedup working — but the winner's row may not
      // know THIS job's hashes (two logged texts parsing to one structure
      // race here; dropping the loser's text hash would strand its
      // evidence). Teach the winner, same as the claim-time path.
      await attachToExistingSignature(supa, checkHashes);
      return "already_signed";
    }
    throw new Error(error.message);
  }
  await claimEvidence(supa, (data as { id: string }).id, row.evidence_hashes);
  return "done";
}

/** Find the signature that claims any of these hashes (exact identity);
 *  teach it the ones it is missing and point waiting evidence at it.
 *  Returns false when no signature covers them. */
async function attachToExistingSignature(
  supa: SupaLike,
  checkHashes: string[],
): Promise<boolean> {
  const { data: existing, error } = await supa
    .from("workout_signatures")
    .select("id, evidence_hashes")
    .overlaps("evidence_hashes", checkHashes)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!existing || existing.length === 0) return false;
  const row = existing[0] as { id: string; evidence_hashes: string[] | null };
  const have = new Set(row.evidence_hashes ?? []);
  const missing = checkHashes.filter((h) => !have.has(h));
  if (missing.length > 0) {
    await supa.from("workout_signatures")
      .update({ evidence_hashes: [...have, ...missing], updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  await claimEvidence(supa, row.id, checkHashes);
  return true;
}

/**
 * Process a claimed batch SEQUENTIALLY. Failures go back to 'queued' for
 * another attempt (or 'failed' past the cap); the function itself never
 * throws.
 */
export async function processClaimedJobs(
  supa: SupaLike,
  jobs: QueueJob[],
  deps: ProcessDeps = {},
): Promise<ProcessStats> {
  const stats: ProcessStats = { done: 0, already_signed: 0, failed_retry: 0, failed_final: 0 };
  const maxAttempts = deps.maxAttempts ?? 3;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      const outcome = await draftOneJob(supa, job, deps);
      stats[outcome === "done" ? "done" : "already_signed"]++;
      await markJob(supa, job.id, { status: "done", last_error: null });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      const final = job.attempts >= maxAttempts;
      stats[final ? "failed_final" : "failed_retry"]++;
      await markJob(supa, job.id, {
        status: final ? "failed" : "queued",
        last_error: msg,
      });
      // KNOWN GAP until the self-nominating trigger (link 3): a TEXT job
      // that fails final strands its waiting evidence unless the athlete
      // re-logs the same text ('failed' falls out of the live-hash index,
      // so a re-log re-enqueues). Link 3's unsigned-evidence sweep closes
      // it for good.
      console.warn(
        `[signature-worker] job ${job.id} (${job.workout_hash}) attempt ${job.attempts} failed${final ? " FINAL" : ""}: ${msg}`,
      );
    }
    // Renew the drainer lease between jobs: a sequential batch can outlive
    // any fixed lease, and an expired lease starts a second drainer —
    // doubling the global in-flight cap the lease exists to enforce. A
    // lost lease stops the batch; the untouched remainder requeues so the
    // new drainer picks it up.
    if (deps.heartbeatFn && i < jobs.length - 1) {
      let alive = false;
      try {
        alive = await deps.heartbeatFn();
      } catch (_) { /* treat as lost */ }
      if (!alive) {
        const remainder = jobs.slice(i + 1);
        console.warn(
          `[signature-worker] drainer lease lost after job ${i + 1}/${jobs.length}; requeueing ${remainder.length} job(s)`,
        );
        for (const r of remainder) {
          await markJob(supa, r.id, { status: "queued" });
        }
        break;
      }
    }
  }
  return stats;
}
