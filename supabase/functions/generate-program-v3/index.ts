/**
 * generate-program-v3/index.ts
 *
 * v3 chained-generation edge function — the production generator for all
 * programming users (v1/v2 retired). First-cycle generation is open to any
 * authenticated user; entitlement gating happens upstream. Continuation +
 * v1→v3 migration are driven by trusted service callers (generate-next-month).
 *
 * RESUMABLE PER-STAGE DISPATCHER. Generation runs ONE stage per edge
 * invocation, persisting full resume state on the program_jobs row and
 * self-re-triggering the next stage. The clock resets each hop, so a heavy
 * (6-day) run that used to die mid-fill at the ~400s wall-clock now completes
 * across invocations. An atomic DB lease + fencing token (see v3-dispatcher.ts)
 * guarantees a stage never double-runs even under at-least-once dispatch, and a
 * reaper cron (job-reaper) re-dispatches any stage whose worker vanished.
 *
 * Stages: payload_building → skeleton → fill_week_1..4 → benchmark_audit →
 *         surgical (one pass per invocation, re-enters itself) → safety_review →
 *         saving → complete.
 *
 * Kickoff creates the job at next_stage='payload_building' (resume_state.
 * continuation seeded) and fires stage 1; the client polls program-job-status.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildWriterPayload, daysPerWeekLogLine, type WriterPayload } from "../_shared/build-writer-payload.ts";
import { generateAndPersistCoachState } from "../_shared/generate-coach-state.ts";
import { buildCoachStateDocumentBlock } from "../_shared/coach-state.ts";
import { deriveMetconSlots, describeComposedPiece } from "../_shared/metcon-composer.ts";
import { COMPOSER_ARTICLES, loadArticleBlock, loadExampleBlock, PLANNER_ARTICLES } from "../_shared/metcon-library.ts";
import { buildComposerInputs, composeMetconsForSlots } from "../_shared/compose-metcons.ts";
import {
  builtFromForWeekSave,
  builtFromOf,
  classifyNotesForReplan,
  loadMonthStore,
  noteIdsToConsume,
  profileDrift,
  weeksToCarryForward,
  type MonthStore,
} from "../_shared/weekly-fill.ts";
import { priorWeeksForWeekJob } from "../_shared/written-weeks.ts";
import { withPlanChecks } from "../_shared/plan-fidelity.ts";
import { formatAuditFailuresForLog, logGenerationAudit } from "../_shared/generation-audit-log.ts";
import {
  enqueueSignatureDraftsForWeeks,
  formatEnqueueStats,
  triggerDraftWorker,
} from "../_shared/signature-draft-queue.ts";
import { loadCoachNotes, markNotesConsumed, noteIdsForTexts } from "../_shared/coach-notes.ts";
import { isArchived, isProgramArchived, loadArchiveCutoff } from "../_shared/program-archive.ts";
import { buildProgramEvidenceContext } from "../_shared/program-evidence.ts";
import { buildTrainingDesignInput } from "../_shared/training-design-input.ts";
import { type SkeletonOutput } from "../_shared/v3-output-schema.ts";
import {
  type WriterOutput,
  type WeekPrescription,
} from "../_shared/v2-output-schema.ts";
import {
  runSoftAudits,
  summarizeAuditRun,
  classifyFailuresByKind,
} from "../_shared/audit-runner.ts";
import { stripInternalMarkers, enforceNoLabelOnCoachedBlocks } from "../_shared/programmatic-fixes.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";
import { refreshAvoidListForBuild } from "../_shared/injury-refresh.ts";
import { type BlockLocation, missingBenchmarkLines } from "../_shared/compute-block-benchmark.ts";
// Engine core — the extracted generation pipeline. This function now CONSUMES the
// Engine (payload -> skeleton -> audits -> fill -> audit suite -> recovery)
// instead of inlining it. See _shared/engine/pipeline.ts.
import {
  auditCardioPlan,
  auditSkeletonMetconMix,
  formatSkeletonViolationsForRetry,
  stripCardioBlocks,
} from "../_shared/v3-skeleton-audits.ts";
import {
  generateSkeletonWithAudits,
  callSkeletonWriter,
  callWeekFill,
  resolveGender,
  auditOutput as auditOutputHard,
  applyProgrammaticFixes,
  applySurgicalFixes,
  recomputeBenchmarks,
  STALL_HALT_PASSES,
} from "../_shared/engine/pipeline.ts";
import { renderWeekSchemesInPlace } from "../_shared/compose-block-scheme.ts";
import { getDomainPack } from "../_shared/domain-packs/registry.ts";
import {
  firstBuildSavePlan,
  persistCreatedProgramId,
  runStageWithLease,
  type ProgramJobRow,
  type ResumeState,
  type Stage,
  type StageOutcome,
} from "../_shared/v3-dispatcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_NAME = "generate-program-v3";

// Injury-confirmation generation guard (handoff 1.3). FLAG-GATED enforcement:
// stays observability-only (logs a would-block) until the show-back UI (1.1) and
// the existing-user one-time show-back (1.5 / ticket T6) ship — otherwise every
// existing injury-having user would be blocked with no way to confirm. Flip
// INJURY_CONFIRMATION_ENFORCED=true once those land.
const INJURY_CONFIRMATION_ENFORCED =
  Deno.env.get("INJURY_CONFIRMATION_ENFORCED") === "true";
// Mirrors the "no injuries" sentinels in parse-injuries-constraints.
const NO_INJURY_RE = /^(none|no|nothing|no injuries|n\/a)$/i;

/** SHA-256 hex of `text`. Byte-identical to parse-injuries-constraints.sha256Hex and
 *  the client's confirm hash, so a confirmation's confirmed_against_hash computed on
 *  any of the three matches here. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generation guard (handoff 1.3): an athlete with non-empty injuries text but no
 * VALID confirmation must not silently generate with missing/partial injury
 * protection. A confirmation is valid only for the CURRENT text. We hash the current
 * text OURSELVES rather than trust injuries_constraints_hash (which only a successful
 * parse updates) — so an edited-but-unparsed note reads as unconfirmed even if the
 * parse refresh failed, closing the silent-stale-protection gap and making the guard
 * independent of parse-service health. When enforced and the check fails, THROW — the
 * dispatcher marks the job failed (no reaper re-roll) and the message surfaces to the
 * athlete via program-job-status.
 */
async function enforceInjuryConfirmationGuard(
  supa: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supa
    .from("athlete_profiles")
    .select("injuries_constraints, injuries_avoidance_confirmed")
    .eq("user_id", userId)
    .maybeSingle<{
      injuries_constraints: string | null;
      injuries_avoidance_confirmed: { confirmed_against_hash?: string } | null;
    }>();
  // Best-effort read: a guard-read failure must not brick generation — the payload
  // read applies the same confirmed-or-fallback rule regardless. Log and proceed.
  if (error) {
    console.warn("[generate-program-v3] injury guard read failed (skipping guard):", error.message);
    return;
  }

  const text = (data?.injuries_constraints ?? "").trim();
  const hasInjuries = text !== "" && !NO_INJURY_RE.test(text);
  if (!hasInjuries) return;

  const confirmed = data?.injuries_avoidance_confirmed ?? null;
  const currentHash = await sha256Hex(text);
  const confirmationValid =
    confirmed != null && confirmed.confirmed_against_hash === currentHash;
  if (confirmationValid) return;

  if (INJURY_CONFIRMATION_ENFORCED) {
    throw new Error(
      "Your injury notes need review before we generate your program. Open your " +
        "profile and confirm the movements we'll avoid, then try again.",
    );
  }
  console.warn(
    `[generate-program-v3] injury guard WOULD BLOCK user ${userId} (non-empty injuries, ` +
      "no valid confirmation) — enforcement off (rollout window before 1.1/T6)",
  );
}
// wodwisdom is the first Engine consumer; it pins the CrossFit pack. The Engine
// core is sport-agnostic — the pack supplies all sport-coupled content.
const PACK = getDomainPack("crossfit@3");

/**
 * The hard audits PLUS the check of each written day against its skeleton day
 * (2026-11-23, _shared/plan-fidelity.ts): the planned block types are there,
 * A missing block type is logged as a residual. (The main-lift name check was
 * removed 2026-11-26: see plan-fidelity.ts.)
 *
 * This is called ONLY from the benchmark_audit and surgical stages.
 */
/** The most repair passes a job may take before it ships with what remains. */
export const MAX_SURGICAL_PASSES = 6;

function auditOutput(
  output: WriterOutput,
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  pack: typeof PACK,
  /** Weeks the output should hold: 4 for a month, 1 for a weekly job. */
  expectedWeeks = 4,
) {
  return withPlanChecks(auditOutputHard(output, payload, skeleton, pack, expectedWeeks), output, skeleton);
}

/** Transition from surgical (or benchmark_audit) into safety_review: drop the
 *  surgical cursor, persist the final output + residual failures. */
function toSafety(rs: ResumeState, output: WriterOutput, residualFailures: unknown[]): ResumeState {
  const { surgical: _drop, ...rest } = rs;
  return { ...rest, output, residualFailures };
}

// ============================================================
// Stages — each runs in its own invocation via runStageWithLease.
// ============================================================

async function stagePayloadBuilding(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const userId = job.user_id;
  const monthNumber = rs.continuation.monthNumber;

  // Ensure free-text injuries are parsed into injuries_structured.do_not_program
  // BEFORE building the payload (hash-guarded no-op when current). No longer blind:
  // check the response so a parse HTTP failure is visible rather than silently
  // proceeding on a stale/null list. The parse refresh itself stays non-fatal — the
  // confirmation guard below is the actual gate.
  // Three tries (2026-11-24: it was one, and a single failed call left the
  // build on the old list). Still non-fatal: after three failures the old
  // list is kept; the writer is also given the athlete's own words.
  await refreshAvoidListForBuild(userId, "generate-program-v3.refresh", { url: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY });

  // Guard (handoff 1.3): block generation past a non-empty-but-unconfirmed injury
  // note. Flag-gated — observability-only until 1.1/T6 ship (see the helper).
  await enforceInjuryConfirmationGuard(supa, userId);

  const payload = await buildWriterPayload(supa, userId, {
    includeAllResults: false,
    includeEvaluations: true,
    monthNumber,
    includeEngineTraining: true,
    // A NEW program for someone whose programs were archived is built from an
    // evaluation run since the archive, or not at all (founder, 2026-11-21).
    // Appends and week fills keep today's soft contract.
    requireFreshEvaluation: rs.continuation.programId == null && rs.weeklyFill == null,
  });
  console.log(
    `[generate-program-v3] payload built (days_per_week=${payload.training_context.days_per_week} competition_linked=${payload.competition != null} vocabulary_size=${payload.vocabulary.length} engine_evidence=${payload.engine_training != null})`,
  );

  // WEEKLY MODE opt-in (2026-11-13): week 1 filled, weeks 2-4 as outline,
  // the weekly cron fills the rest. Per-athlete while it rolls out.
  const { data: weeklyRow } = await supa
    .from("athlete_profiles").select("programming_weekly, days_per_week").eq("user_id", userId).maybeSingle();
  // Days per week: the default of 5 stays, but a build that used it, or a
  // number outside 2 to 6, is recorded (founder, 2026-11-26).
  const daysNote = daysPerWeekLogLine((weeklyRow as { days_per_week?: number | null } | null)?.days_per_week ?? null);
  if (daysNote) {
    console.warn(`[generate-program-v3] ${daysNote}`);
    await logGenerationAudit(supa, {
      user_id: userId,
      program_id: rs.continuation.programId ?? null,
      month_number: rs.continuation.monthNumber,
      stage: "payload_default",
      warnings: [daysNote],
    }).catch((e) => console.warn("[generate-program-v3] payload_default log failed (non-fatal):", e));
  }
  const weekly = rs.weeklyFill != null || weeklyRow?.programming_weekly === true;
  if (weekly) console.log(`[generate-program-v3] weekly mode for ${userId}`);

  // The ids of the notes this payload carries (2026-11-23). After the save
  // only THESE are marked as used: marking every active note also spent notes
  // written while the job was running, which nothing had read. Best-effort:
  // on a read failure nothing is marked and the notes are read again.
  const coachNoteIds = (payload.training_context.coach_notes ?? []).length > 0
    ? await loadCoachNotes(supa, userId)
      .then((ns) => noteIdsForTexts(ns, payload.training_context.coach_notes))
      .catch(() => [] as string[])
    : [];

  return {
    next: "coach_state",
    resumeState: { ...rs, payload, weekly, coachNoteIds, startedAtMs: rs.startedAtMs ?? Date.now() },
    displayStage: "payload_built",
  };
}

/**
 * coach_state stage (Step 3) — the judgment layer in the pipeline. Reuse-if-
 * current by (athlete_model_version, coach_state_builder_version); generate +
 * persist on a miss. Then project the FIXED CoachState into the TrainingDesign
 * contract the skeleton + week-fill consume. Re-entry is safe (reuse-if-current
 * returns the cached snapshot), so the 2-attempt retry only guards transient
 * LLM errors before this writer stage gives up.
 */
async function stageCoachState(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;

  let result: Awaited<ReturnType<typeof generateAndPersistCoachState>> | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await generateAndPersistCoachState(supa, job.user_id, payload);
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`[generate-program-v3] coach_state attempt ${attempt}/2 failed:`, e);
    }
  }
  if (!result) throw lastErr ?? new Error("coach_state generation failed");

  const coachState = result.coach_state;
  console.log(
    `[generate-program-v3] coach_state v${result.version} (reused=${result.reused}, refs AM v${payload.athlete_model.version})`,
  );

  // v1.7: the CoachState's month_in_review IS the training evaluation — one
  // judgment, rendered for both audiences (replaces the separate Sonnet
  // training-analysis call generate-next-month used to make). Written invisible;
  // the completion stage's existing flip makes it visible with the rest of the
  // month's evaluations. Delete-then-insert keeps retries idempotent. Best-effort:
  // a failed insert must never fail generation.
  const monthNumber = rs.continuation.monthNumber;
  // A WEEK JOB leaves the month's evaluation alone (2026-11-23). It used to
  // delete it and re-insert it hidden here, to be revealed only by a
  // successful save: a week job that failed in between left the athlete
  // without their evaluation until a later week succeeded. Only a month build
  // writes (and, in saving, reveals) evaluations.
  const review = typeof coachState.month_in_review === "string" ? coachState.month_in_review.trim() : "";
  if (review && !rs.weeklyFill) {
    try {
      // Keyed by user + month NUMBER: a returner's new Month 1 must not wipe
      // the review their archived program's Month 1 left behind. Only rows
      // written since the archive belong to this program (2026-11-21).
      const archiveCutoff = await loadArchiveCutoff(supa, job.user_id);
      let staleReview = supa.from("training_evaluations").delete()
        .eq("user_id", job.user_id).eq("month_number", monthNumber);
      if (archiveCutoff) staleReview = staleReview.gt("created_at", archiveCutoff);
      await staleReview;
      const { error: reviewErr } = await supa.from("training_evaluations").insert({
        user_id: job.user_id,
        analysis: review,
        month_number: monthNumber,
        visible: false,
        ...(rs.continuation.programId ? { program_id: rs.continuation.programId } : {}),
      });
      if (reviewErr) console.error("[generate-program-v3] month_in_review save failed:", reviewErr);
      else console.log(`[generate-program-v3] month_in_review saved as training evaluation (month ${monthNumber})`);
    } catch (e) {
      console.error("[generate-program-v3] month_in_review save failed:", e);
    }
  }

  // Part D entitlement fact: an active Engine entitlement (All Access grants
  // it too) disables dedicated cardio blocks entirely — Engine IS the
  // dedicated conditioning product. Fail CLOSED on a read error: no cardio is
  // always safe; unwanted cardio for an Engine athlete is the failure mode.
  let cardioAllowed = true;
  try {
    const { data: engineEnt, error: entErr } = await supa
      .from("user_entitlements")
      .select("feature")
      .eq("user_id", job.user_id)
      .eq("feature", "engine")
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .limit(1);
    if (entErr) {
      console.warn("[generate-program-v3] entitlement read failed (cardio disabled defensively):", entErr);
      cardioAllowed = false;
    } else {
      cardioAllowed = (engineEnt ?? []).length === 0;
    }
  } catch (e) {
    console.warn("[generate-program-v3] entitlement read failed (cardio disabled defensively):", e);
    cardioAllowed = false;
  }

  const trainingDesignInput = buildTrainingDesignInput(coachState, {
    days_per_week: payload.training_context.days_per_week,
    // Session-budget observe phase (2026-08-31): thread the athlete's stated
    // time budget to the skeleton. Null when never stated — the skeleton then
    // gets no budget guidance and behaves exactly as before.
    session_length_minutes: payload.training_context.session_length_minutes ?? null,
    equipment: payload.equipment,
    do_not_program: payload.training_context.injuries_structured?.do_not_program ?? [],
    vocabulary: payload.vocabulary,
    lifts: payload.lifts,
    previous_cycle: payload.previous_cycle,
    cardio_allowed: cardioAllowed,
  });

  return {
    next: "skeleton",
    resumeState: { ...rs, coachState, trainingDesignInput },
    displayStage: "coach_state_done",
  };
}

/**
 * The planner's metcon time-domain mix, counted after it (every week with 3+
 * metcon days has a short, a medium and a long; no domain far over its
 * share). A miss goes back to the planner ONCE; the second plan is used only
 * if it still passes the hard plan checks and misses less. Never fails a
 * job. Logged as skeleton_mix.
 *
 * Runs on a first build and on a re-plan (founder, 2026-11-27; a re-plan
 * used to skip it). On a re-plan only the re-planned weeks are counted, and
 * `finish` puts the written weeks back on whatever the planner returns.
 */
async function withMixCheck(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
  o: {
    skeleton: SkeletonOutput;
    tdi: NonNullable<ResumeState["trainingDesignInput"]>;
    doc: string;
    fromWeek: number;
    finish?: (fresh: SkeletonOutput) => SkeletonOutput;
  },
): Promise<SkeletonOutput> {
  let skeleton = o.skeleton;
  let mix = auditSkeletonMetconMix(skeleton, o.fromWeek);
  let mixRetried = false;
  if (!mix.passed) {
    mixRetried = true;
    console.warn(`[generate-program-v3] skeleton mix violations (retrying once): ${mix.violations.join(" | ")}`);
    try {
      const retryRaw = await callSkeletonWriter(o.tdi, formatSkeletonViolationsForRetry([mix]), PACK, o.doc);
      // The retry must still pass the HARD plan checks; otherwise keep the first.
      const hard = PACK.audits.runSkeleton({
        skeleton: retryRaw,
        daysPerWeek: o.tdi.days_per_week,
        trainingDesignInput: o.tdi,
      });
      const retrySkeleton = o.finish ? o.finish(retryRaw) : retryRaw;
      const retryMix = auditSkeletonMetconMix(retrySkeleton, o.fromWeek);
      if (hard.passed && retryMix.violations.length < mix.violations.length) {
        skeleton = retrySkeleton;
        mix = retryMix;
        console.log(`[generate-program-v3] skeleton mix retry adopted (${mix.violations.length} residual)`);
      } else {
        console.warn(
          `[generate-program-v3] skeleton mix retry rejected (hard=${hard.passed}, violations ${retryMix.violations.length} vs ${mix.violations.length}) — keeping first skeleton`,
        );
      }
    } catch (e) {
      console.warn("[generate-program-v3] skeleton mix retry call failed (accepting first skeleton):", e);
    }
  }
  if (mixRetried || mix.violations.length > 0) {
    await logGenerationAudit(supa, {
      user_id: job.user_id,
      program_id: rs.continuation.programId ?? null,
      month_number: rs.continuation.monthNumber,
      stage: "skeleton_mix",
      violations: mix.violations,
      retried: mixRetried,
      ...(o.fromWeek > 1 ? { meta: { replan_from_week: o.fromWeek } } : {}),
    }).catch((e) => console.warn("[generate-program-v3] skeleton_mix log failed (non-fatal):", e));
  }
  return skeleton;
}

async function stageSkeleton(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  // The skeleton consumes the TrainingDesignInput CONTRACT (the locked plan)
  // PLUS the full CoachState document (2026-08 full-document channel) — the
  // letter the athlete reads. The typed decisions bind; the document refines
  // execution; the audit loop enforces the boundary.
  const tdi = rs.trainingDesignInput!;
  // The planner also reads the Theoretical Template article (founder,
  // 2026-11-27). "" when the library cannot be read: the build goes on.
  const plannerArticles = await loadArticleBlock(supa, PLANNER_ARTICLES);
  const intentDocument = [rs.coachState ? buildCoachStateDocumentBlock(rs.coachState) : "", plannerArticles]
    .filter(Boolean).join("\n\n");

  // WEEK JOB (PR 4): the month's skeleton already exists. Load it; if the
  // athlete's notes touch what the skeleton owns (which lifts, how much
  // lifting, the metcon focus), RE-PLAN the weeks from this one on — written
  // weeks are kept exactly — otherwise keep it as is. The fill then writes
  // this week from the (possibly new) skeleton.
  if (rs.weeklyFill) {
    const weekNum = rs.weeklyFill.weekNum;
    const store: MonthStore | null = await loadMonthStore(supa, rs.continuation.programId!, rs.continuation.monthNumber);
    if (!store) throw new Error(`[generate-program-v3] week job: no stored skeleton for program ${rs.continuation.programId} month ${rs.continuation.monthNumber}`);
    const notes = rs.payload?.training_context.coach_notes ?? [];
    // Two triggers for a re-plan: notes that touch what the skeleton owns,
    // and a profile change since the skeleton was built (days, goal, session
    // length — founder, 2026-11-14). Months stored before built_from existed
    // can only re-plan on notes.
    const drift = profileDrift(store.built_from, builtFromOf(rs.payload!.training_context));
    const daysChanged = drift.some((d) => d.startsWith("training days"));
    const verdict = drift.length ? "replan" : notes.length ? await classifyNotesForReplan(notes) : "fill";
    let skeleton = store.skeleton;
    let replanned = false;
    // What the save needs to know when the re-plan fails (2026-11-23): it
    // must not record the new built_from, and must not spend notes that asked
    // for the re-plan — see builtFromForWeekSave / noteIdsToConsume.
    let replan: { failed: boolean; notesNeededIt: boolean } = { failed: false, notesNeededIt: false };
    if (verdict === "replan") {
      const reasons = [
        ...(drift.length ? [`The athlete's PROFILE CHANGED since this skeleton was built: ${drift.join("; ")}. The remaining weeks must match the CURRENT profile (days per week above all).`] : []),
        ...(notes.length ? [`The athlete's notes: ${notes.map((n) => `"${n}"`).join("; ")}.`] : []),
      ].join(" ");
      const replanDoc =
        intentDocument +
        `\n\nRE-PLAN (weekly Programming): this month's skeleton is below. Weeks 1-${weekNum - 1} are WRITTEN and ` +
        `already trained — reproduce them EXACTLY as given (same days, block types, lifts, schemes, focus). Rewrite weeks ` +
        `${weekNum}-4 so the following is honoured while the month's arc still holds. ${reasons}` +
        `\nCURRENT SKELETON:\n${JSON.stringify(store.skeleton)}`;
      try {
        const fresh = await generateSkeletonWithAudits(tdi, PACK, undefined, replanDoc);
        // Applied to every plan the planner returns for this re-plan:
        //  - an Engine-entitled athlete never receives a cardio block (this
        //    used to be applied on a first build only; 2026-11-24);
        //  - written weeks are kept from the stored plan whatever came back.
        const finish = (plan: SkeletonOutput): SkeletonOutput => {
          if (tdi.cardio_allowed === false) {
            const strippedOnReplan = stripCardioBlocks(plan);
            if (strippedOnReplan.length) console.log(`[generate-program-v3] week ${weekNum}: re-plan cardio removed from ${strippedOnReplan.join(", ")} (athlete holds an Engine entitlement)`);
          }
          return {
            ...plan,
            weeks: [
              ...store.skeleton.weeks.filter((w) => w.week_num < weekNum),
              ...plan.weeks.filter((w) => w.week_num >= weekNum),
            ].sort((a, b) => a.week_num - b.week_num),
          };
        };
        // The time-domain mix is counted on the re-planned weeks too.
        skeleton = await withMixCheck(supa, job, rs, { skeleton: finish(fresh), tdi, doc: replanDoc, fromWeek: weekNum, finish });
        replanned = true;
        console.log(`[generate-program-v3] week ${weekNum}: skeleton RE-PLANNED on ${drift.length ? `profile (${drift.join("; ")})` : ""}${drift.length && notes.length ? " + " : ""}${notes.length ? `notes (${notes.join(" | ")})` : ""}`);
        await supa.from("program_month_skeletons")
          .update({ skeleton, replanned_at: new Date().toISOString(), replan_count: (store.replan_count ?? 0) + 1, built_from: builtFromOf(rs.payload!.training_context) })
          .eq("id", store.id);
      } catch (e) {
        // A days change cannot fall back: the fill tool is sized to the NEW
        // day count and the stored skeleton has the old one. Fail the job;
        // the cron tries again next tick.
        if (daysChanged) throw new Error(`[generate-program-v3] week ${weekNum}: re-plan on a days-per-week change failed: ${e instanceof Error ? e.message : String(e)}`);
        console.warn(`[generate-program-v3] week ${weekNum}: re-plan failed, filling from the stored skeleton:`, e instanceof Error ? e.message : String(e));
        // Did the NOTES ask for this re-plan? With no drift they were the
        // only trigger. With drift the classifier was never asked, so ask it
        // now (failure path only; an error answers "fill").
        const notesNeededIt = notes.length > 0 &&
          (drift.length === 0 || (await classifyNotesForReplan(notes)) === "replan");
        replan = { failed: true, notesNeededIt };
        // Recorded (founder, 2026-11-26): the member gets this week from the
        // month's old plan, not the re-plan their profile or notes asked for.
        await logGenerationAudit(supa, {
          user_id: job.user_id,
          program_id: rs.continuation.programId ?? null,
          month_number: rs.continuation.monthNumber,
          stage: "replan_fallback",
          violations: [
            `week ${weekNum}: the re-plan failed, so this week was written from the month's old plan. ` +
            `Asked for by: ${[drift.length ? `profile (${drift.join("; ")})` : "", notes.length ? `notes (${notes.join(" | ").slice(0, 300)})` : ""].filter(Boolean).join(" + ")}. ` +
            `Error: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
          ],
        }).catch((err) => console.warn("[generate-program-v3] replan_fallback log failed (non-fatal):", err));
      }
    }
    // The prior weeks the fill progresses from are the program AS IT STANDS
    // NOW — the current rows, edits by the athlete or the coach included —
    // not the copy stored when each week was first written (2026-11-23). The
    // stored copy is the fallback when the rows cannot be read.
    const prior = await priorWeeksForWeekJob(supa, rs.continuation.programId!, rs.continuation.monthNumber, weekNum, store.written_weeks);
    console.log(`[generate-program-v3] week ${weekNum}: ${prior.weeks.length} prior week(s) from ${prior.source === "rows" ? "the current program rows" : "the stored copy (rows unreadable)"}`);
    return {
      next: "metcons",
      resumeState: { ...rs, skeleton, weeks: [], priorWrittenWeeks: prior.weeks, replan, composedMetcons: store.composed_metcons ?? [] },
      displayStage: "skeleton_done",
      extraPatch: { skeleton_json: skeleton, ...(replanned ? { replanned: true } : {}) },
    };
  }

  let skeleton = await generateSkeletonWithAudits(tdi, PACK, undefined, intentDocument);
  console.log("[generate-program-v3] skeleton passed audits");

  // Metcon time-domain mix: one send-back, then accept and log.
  skeleton = await withMixCheck(supa, job, rs, { skeleton, tdi, doc: intentDocument, fromWeek: 1 });

  // Part D — dedicated cardio. Two layers, per doctrine:
  //   1. ENTITLEMENT (code, hard): Engine-entitled athletes never receive a
  //      cardio block — strip any emission deterministically.
  //   2. LIMITS + AUTHORIZATION (log-only): observed, never blocked.
  const cardioLines: string[] = [];
  if (tdi.cardio_allowed === false) {
    const strippedCardio = stripCardioBlocks(skeleton);
    if (strippedCardio.length) {
      cardioLines.push(
        `entitlement strip: cardio removed from ${strippedCardio.join(", ")} (athlete holds an Engine entitlement)`,
      );
    }
  } else {
    cardioLines.push(...auditCardioPlan(
      skeleton,
      tdi.dedicated_cardio,
      tdi.session_length_minutes ?? null,
      tdi.days_per_week,
    ));
  }
  if (cardioLines.length) {
    for (const l of cardioLines) console.warn(`[generate-program-v3] cardio-plan ${l}`);
    await logGenerationAudit(supa, {
      user_id: job.user_id,
      program_id: rs.continuation.programId ?? null,
      month_number: rs.continuation.monthNumber,
      stage: "cardio_plan",
      warnings: cardioLines,
    }).catch((e) => console.warn("[generate-program-v3] cardio_plan log failed (non-fatal):", e));
  }

  // Session-budget OBSERVE log (2026-08-31): when the athlete stated a budget,
  // record how the skeleton allocated time — day sums vs budget, and any day
  // that omitted block_minutes. Pure observation: nothing is enforced,
  // retried, or rescaled; the AI's numbers ship as emitted. This log is the
  // dataset for deciding whether any guard is ever needed.
  const budget = tdi.session_length_minutes ?? 0;
  if (budget > 0) {
    try {
      const lines: string[] = [];
      for (const wk of skeleton.weeks ?? []) {
        for (const day of wk.days ?? []) {
          const bm = day.block_minutes;
          if (!bm || bm.length === 0) {
            lines.push(`W${wk.week_num}D${day.day_num}: block_minutes MISSING (budget=${budget})`);
          } else {
            const sum = bm.reduce((a, b) => a + (b.minutes || 0), 0);
            lines.push(
              `W${wk.week_num}D${day.day_num}: sum=${sum} vs budget=${budget} [${bm.map((b) => `${b.block_type}=${b.minutes}`).join(" ")}]`,
            );
          }
        }
      }
      for (const l of lines) console.log(`[generate-program-v3] duration-plan ${l}`);
      await logGenerationAudit(supa, {
        user_id: job.user_id,
        program_id: rs.continuation.programId ?? null,
        month_number: rs.continuation.monthNumber,
        stage: "duration_plan",
        warnings: lines,
      });
    } catch (e) {
      console.warn("[generate-program-v3] duration-plan observe log failed (non-fatal):", e);
    }
  }

  return {
    next: "metcons",
    resumeState: { ...rs, skeleton, weeks: [] },
    displayStage: "skeleton_done",
    // Mirror to skeleton_json for the admin V3 panel.
    extraPatch: { skeleton_json: skeleton },
  };
}

/**
 * metcons stage — the composer writes the metcons (rebuilt 2026-11-27).
 *
 * It is given each slot's time domain and the week's role from the plan, the
 * athlete's own profile, 100 real main site metcons, three articles, this
 * month's metcons so far and last month's. It is NOT given the coach state's
 * conditioning paragraph, priorities, or recovery stance. A few counts run
 * after it (one send-back); what comes back ships. No composed piece is
 * deleted and no movement name is checked.
 */
async function stageMetcons(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const tdi = rs.trainingDesignInput!;

  const slots = deriveMetconSlots(skeleton);
  const [examples, articles] = await Promise.all([
    loadExampleBlock(supa),
    loadArticleBlock(supa, COMPOSER_ARTICLES),
  ]);
  // Last month's metcons, so none is served again. Read from where each
  // month's composed pieces are stored; "" lines when there is no last month
  // or it cannot be read.
  let previousCycleMetcons: string[] = [];
  if (rs.continuation.programId && rs.continuation.monthNumber > 1) {
    try {
      const last = await loadMonthStore(supa, rs.continuation.programId, rs.continuation.monthNumber - 1);
      previousCycleMetcons = (last?.composed_metcons ?? []).map(describeComposedPiece);
    } catch (e) {
      console.warn("[generate-program-v3] last month's metcons could not be read (continuing without):", e instanceof Error ? e.message : String(e));
    }
  }
  const inputsSansSlots = buildComposerInputs(payload, tdi, { examples, articles, previousCycleMetcons });
  const auditOpts = {
    slots,
    engineActive: payload.engine_training != null,
  };

  // WEEKLY MODE (PR 3, 2026-11-13): compose week 1 only; the weekly cron
  // composes each later week against what is already written, with the
  // athlete's notes in view. Monthly mode composes the whole month as before.
  const targetWeek = rs.weeklyFill?.weekNum ?? 1;
  const slotsToCompose = rs.weekly ? slots.filter((sl) => sl.week_num === targetWeek) : slots;
  const priorPieces = rs.weeklyFill ? ((rs.composedMetcons ?? []).filter((m) => m.week_num < targetWeek)) : [];
  const priorSlots = rs.weeklyFill ? slots.filter((sl) => sl.week_num < targetWeek) : [];
  const { slots: _unusedAuditSlots, ...auditOptsSansSlots } = auditOpts;
  const composed = await composeMetconsForSlots({
    inputs: inputsSansSlots,
    slots: slotsToCompose,
    priorSlots,
    priorPieces,
    auditOpts: auditOptsSansSlots,
    logPrefix: "[generate-program-v3]",
  });
  const output = { metcons: [...priorPieces, ...composed.pieces] };
  const audit = {
    violations: composed.violations,
    // A build the library did not reach is recorded, so it can be found.
    warnings: [
      ...composed.warnings,
      ...(examples === "" ? ["The example workouts could not be loaded: the composer wrote without them."] : []),
      ...(articles === "" ? ["The reference articles could not be loaded: the composer wrote without them."] : []),
    ],
  };
  const retried = composed.retried;
  const firstPassViolations = composed.firstPassViolations;
  const repairs = composed.repairs;
  // Persist the outcome (findings-only: clean unretried months write nothing).
  await logGenerationAudit(supa, {
    user_id: job.user_id,
    program_id: rs.continuation.programId ?? null,
    month_number: rs.continuation.monthNumber,
    stage: "metcons",
    violations: audit.violations,
    warnings: audit.warnings,
    retried,
    meta: {
      // The retry ships whether or not it is better: the two counts show
      // which (founder, 2026-11-26).
      ...(retried ? { first_pass_violations: firstPassViolations, first_pass_count: firstPassViolations.length, after_retry_count: audit.violations.length } : {}),
      ...(repairs.length ? { repairs } : {}),
      last_month_pieces: previousCycleMetcons.length,
    },
  });
  console.log(`[generate-program-v3] composed ${output.metcons.length} metcons for ${slots.length} slots`);
  return {
    next: `fill_week_${targetWeek}` as Stage,
    resumeState: { ...rs, composedMetcons: output.metcons },
    displayStage: "metcons_done",
  };
}

async function stageFillWeek(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
  weekNum: number,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const priorWeeks = rs.weeklyFill ? (rs.priorWrittenWeeks ?? []) : (rs.weeks ?? []);
  const weekMetcons = (rs.composedMetcons ?? []).filter((m) => m.week_num === weekNum);
  // What the athlete actually did in the prior weeks of THIS program (weekly
  // model, PR 1): lifted loads, results, skipped blocks with reasons, days
  // not done, layoffs. "" when nothing is logged yet — which is every week
  // under monthly generation, so today's prompt is byte-identical. The
  // weekly cron is where this pays off.
  const evidence = await buildProgramEvidenceContext(
    supa, job.user_id, rs.continuation.programId ?? null, weekNum, rs.continuation.monthNumber,
  );
  const wk = await callWeekFill(payload, skeleton, weekNum, priorWeeks, evidence, PACK, weekMetcons);
  // Render every header from scheme_format + rows BEFORE audits/benchmarks —
  // downstream stages read block_scheme text and must see the final strings.
  renderWeekSchemesInPlace(wk);
  // Movement names are left exactly as the writer wrote them (2026-11-26):
  // the repair that trimmed a name back to a movement-list prefix is gone.
  // The writer is told never to append notes to a name.
  // Persist each composed piece's stimulus into its metcon block's notes
  // (deterministic — never trust transcription for it). The note is the
  // workout's PURPOSE; it reaches storage, the athlete's UI, and the AI Coach
  // chat, which needs it to adjust sessions without destroying their intent.
  for (const m of weekMetcons) {
    const day = wk.days?.find((d) => d.day_num === m.day_num);
    const metconBlock = day?.blocks?.find((b) => b.block_type === "metcon");
    if (metconBlock && m.stimulus_note?.trim()) {
      metconBlock.block_notes = m.stimulus_note.trim().slice(0, 500);
      // Its OWN field too (2026-11-24): block_notes is never shown to the
      // athlete (it also holds internal working), so the purpose never
      // reached their screen. stimulus_note is what the app displays.
      (metconBlock as { stimulus_note?: string }).stimulus_note = m.stimulus_note.trim().slice(0, 500);
    }
  }
  // A week job carries forward ONLY the week it wrote: the earlier weeks are
  // already saved, and saving them again duplicated their days.
  const weeks = weeksToCarryForward(rs.weeklyFill != null, priorWeeks, wk);
  // Weekly mode: only week 1 is written now; the rest are outline until the
  // athlete trains it (weekly cron).
  const next: Stage = (rs.weekly || weekNum >= 4) ? "benchmark_audit" : (`fill_week_${weekNum + 1}` as Stage);
  return { next, resumeState: { ...rs, weeks }, displayStage: next };
}

/** Every weight the 1RM clamp lowered, recorded (founder, 2026-11-26). */
async function logLoadClamp(supa: SupabaseClient, job: ProgramJobRow, rs: ResumeState, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await logGenerationAudit(supa, {
    user_id: job.user_id,
    program_id: rs.continuation.programId ?? rs.programId ?? null,
    month_number: rs.continuation.monthNumber,
    stage: "load_clamp",
    violations: lines,
  }).catch((e) => console.warn("[generate-program-v3] load_clamp log failed (non-fatal):", e));
}

async function stageBenchmarkAudit(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const output: WriterOutput = { month_plan: skeleton.month_plan, weeks: rs.weeks ?? [] };

  // Full benchmark pass (every metcon — the rate-limit-prone one) in its own
  // invocation, then the first hard audit + any programmatic patches.
  let pendingFailures = await recomputeBenchmarks(output, gender, [], PACK);

  let auditResult = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
  console.log(`[generate-program-v3] audits: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };

  let byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches (no LLM call).
  if (byKind["programmatic-fix"].length > 0) {
    const patch = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, PACK);
    if (patch.patched > 0) {
      console.log(`[generate-program-v3] programmatic patches applied: ${patch.patched}`);
      for (const line of patch.log) console.log(`  - ${line}`);
      await logLoadClamp(supa, job, rs, patch.log);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, []);
      auditResult = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
      console.log(`[generate-program-v3] audits after patch: ${summarizeAuditRun(auditResult)}`);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  if (byKind["block-local"].length > 0) {
    // Hand off to surgical with an initialized cursor.
    return {
      next: "surgical",
      resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts: [], pass: 0 } },
      displayStage: "surgical_fix",
    };
  }

  // Only structural failures remain — surgical can't fix those. Ship with
  // residuals logged (the athlete still gets a program; operators see what
  // slipped through in the admin panel).
  const residual = auditResult.failures;
  if (residual.length > 0) {
    console.warn(`[generate-program-v3] shipping with ${residual.length} unresolved (non-block-local) audit failure(s)`);
  }
  return { next: "safety_review", resumeState: toSafety(rs, output, residual), displayStage: "safety_review" };
}

async function stageSurgical(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const gender = resolveGender(payload);
  const cursor = rs.surgical!;
  const output = cursor.output;
  let pendingFailures = cursor.pendingFailures;
  const pass = cursor.pass + 1;

  // A hard ceiling on passes (2026-11-24). The stall rule below stops only
  // when the failing-block count is the same three passes running; a count
  // that goes up and down (a rewrite can introduce a new failure) never
  // triggered it, so nothing bounded the loop. Past the ceiling the program
  // ships with what remains logged, as on a stall.
  if (pass > MAX_SURGICAL_PASSES) {
    const remaining = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
    console.log(`[generate-program-v3] surgical stopped at the pass ceiling (${MAX_SURGICAL_PASSES}); shipping residuals`);
    return { next: "safety_review", resumeState: toSafety(rs, output, remaining.passed ? [] : remaining.failures), displayStage: "safety_review" };
  }

  // Re-derive current failures (audits are pure + cheap — no LLM).
  let auditResult = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  let byKind = classifyFailuresByKind(auditResult.failures);
  if (byKind["block-local"].length === 0) {
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // ONE surgical pass this invocation (fresh wall-clock). Each block ~30s,
  // sequential. A killed pass persists nothing → the reaper redoes it from the
  // last clean state.
  const sg = await applySurgicalFixes(output, byKind["block-local"], payload, skeleton, PACK, rs.composedMetcons ?? []);
  console.log(`[generate-program-v3] surgical pass ${pass}: rewritten=${sg.rewritten} failed=${sg.failed}`);
  // Every rewrite is recorded: what the block was, what it became, and why
  // (founder, 2026-11-26 — rewrites used to leave no record). Changes nothing.
  if (sg.rewrites.length > 0) {
    await logGenerationAudit(supa, {
      user_id: job.user_id,
      program_id: rs.continuation.programId ?? rs.programId ?? null,
      month_number: rs.continuation.monthNumber,
      stage: "block_rewrite",
      violations: sg.rewrites.map((r) =>
        `W${r.week}D${r.day} block[${r.blockIdx}] (${r.block_type}) rewritten — why: ${r.reasons.join(" / ").slice(0, 400)} | before: ${r.before} | after: ${r.after}`),
      meta: { pass },
    }).catch((e) => console.warn("[generate-program-v3] block_rewrite log failed (non-fatal):", e));
  }
  if (sg.rewritten === 0) {
    // LLM call(s) failed — stall, ship with residuals.
    console.log(`[generate-program-v3] surgical stalled at pass ${pass} (LLM call(s) failed); shipping residuals`);
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, sg.locations);
  auditResult = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
  console.log(`[generate-program-v3] audits after surgical pass ${pass}: ${summarizeAuditRun(auditResult)}`);
  if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
  byKind = classifyFailuresByKind(auditResult.failures);

  // Programmatic patches may resurface between passes.
  if (byKind["programmatic-fix"].length > 0) {
    const patch2 = applyProgrammaticFixes(output, byKind["programmatic-fix"], payload, PACK);
    if (patch2.patched > 0) {
      for (const line of patch2.log) console.log(`  - ${line}`);
      await logLoadClamp(supa, job, rs, patch2.log);
      pendingFailures = await recomputeBenchmarks(output, gender, pendingFailures, PACK, []);
      auditResult = auditOutput(output, payload, skeleton, PACK, rs.weekly ? 1 : 4);
      if (auditResult.passed) return { next: "safety_review", resumeState: toSafety(rs, output, []), displayStage: "safety_review" };
      byKind = classifyFailuresByKind(auditResult.failures);
    }
  }

  const blockLocalCount = byKind["block-local"].length;
  const recentCounts = [...cursor.recentCounts, blockLocalCount];

  // Stall: failing-block count stable for STALL_HALT_PASSES consecutive passes
  // (the count is monotonically non-increasing, so a plateau means oscillation).
  if (recentCounts.length >= STALL_HALT_PASSES) {
    const window = recentCounts.slice(-STALL_HALT_PASSES);
    if (window.every((c) => c === window[0])) {
      console.log(
        `[generate-program-v3] surgical stalled at pass ${pass}: failing-block count stable at ${window[0]} for ${STALL_HALT_PASSES} passes; shipping residuals`,
      );
      return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
    }
  }

  if (blockLocalCount === 0) {
    // Only structural failures remain — surgical is done.
    return { next: "safety_review", resumeState: toSafety(rs, output, auditResult.failures), displayStage: "safety_review" };
  }

  // Another pass — re-enter surgical with the updated cursor.
  return {
    next: "surgical",
    resumeState: { ...rs, surgical: { output, pendingFailures, recentCounts, pass } },
    displayStage: "surgical_retry",
  };
}

async function stageSafetyReview(
  _supa: SupabaseClient,
  _job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  // NOTHING CHANGES THE WRITTEN WEEK HERE (founder, 2026-11-26). This stage
  // held two AI checks built on 2026-11-23 — the restriction gate and the fit
  // gate — that read the finished week and swapped, trimmed or removed
  // movements. Both are removed (see _shared/athlete-file-text.ts for why).
  // The week goes to the save exactly as the writer and the earlier stages
  // left it. The stage itself stays so the job's stage order is unchanged.
  return {
    next: "saving",
    resumeState: {
      ...rs,
      output: rs.output!,
      safety: { safe: true, reasoning: "No post-write checks run.", errored: false },
    },
    displayStage: "saving",
  };
}

async function stageSaving(
  supa: SupabaseClient,
  job: ProgramJobRow,
  rs: ResumeState,
): Promise<StageOutcome> {
  const userId = job.user_id;
  const payload = rs.payload!;
  const skeleton = rs.skeleton!;
  const output = rs.output!;
  const monthNumber = rs.continuation.monthNumber;
  const safety = rs.safety ?? { safe: true, reasoning: "", errored: true };

  // Always-run sanitize: strip internal Track/week/deload markers the writer
  // leaks into athlete-facing block_label / block_scheme. Runs after surgical
  // (which can also leak), right before save. Deterministic, idempotent.
  const stripped = stripInternalMarkers(output);
  if (stripped.patched > 0) {
    console.log(`[generate-program-v3] stripped ${stripped.patched} internal marker(s) from labels/schemes`);
  }
  // Coached blocks (strength/metcon/skills/accessory) must have NO block_label —
  // the block_scheme is their header. Warm-up/cool-down keep their label.
  const labelFix = enforceNoLabelOnCoachedBlocks(output);
  if (labelFix.patched > 0) {
    console.log(`[generate-program-v3] dropped ${labelFix.patched} redundant block_label(s) from coached blocks`);
  }

  // Resolve the target program id:
  //  - continuation: the existing program (append).
  //  - first-cycle resumed: the shell created on a prior saving attempt.
  //  - first-cycle fresh: create the shell now so the dispatcher always saves in
  //    append mode and the program_months marker can dedup every case.
  let programId = rs.continuation.programId ?? rs.programId ?? null;
  // The program was archived while this job ran (access ended mid-build):
  // an archived program gets no new week or month (2026-11-21).
  if (rs.continuation.programId && await isProgramArchived(supa, rs.continuation.programId)) {
    throw new Error("[generate-program-v3] program was archived during generation; nothing saved");
  }
  // A first build whose program THIS job created on an earlier attempt of
  // this stage (the id was persisted the moment the row existed — below).
  const resumedOwnShell = !rs.continuation.programId && !!rs.programId;
  let createdShell = false;
  if (!programId) {
    const { data: shell, error: shellErr } = await supa
      .from("programs")
      .insert({
        user_id: userId,
        name: "My GAINS Program",
        program_version: "v3",
        month_plan: output.month_plan ?? null,
        source: "generated",
      })
      .select("id")
      .single();
    if (shellErr || !shell) {
      throw new Error(`[generate-program-v3] program shell insert failed: ${shellErr?.message ?? "unknown"}`);
    }
    programId = shell.id as string;
    createdShell = true;
    // A FIRST BUILD CANNOT BE SAVED AS TWO PROGRAMS (2026-11-23): write the
    // new program's id onto the job NOW, before the rest of the save. It used
    // to be written only when this stage committed, so a worker lost in
    // between left no trace of the program and the re-run created a second
    // one. If the write does not land, this worker no longer owns the job:
    // take the row back out and stop — the new owner does the save.
    const kept = job.claim_token
      ? await persistCreatedProgramId(supa, job.id, job.claim_token, rs, programId)
      : false;
    if (!kept) {
      await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
      throw new Error("[generate-program-v3] could not record the new program on the job (job no longer owned); nothing saved");
    }
  }
  // The program is this job's own creation, now or on an earlier attempt: a
  // failed save must not leave it behind empty.
  const ownShell = createdShell || resumedOwnShell;

  // Idempotency gate: claim this (program, month). A unique-violation means a
  // prior attempt (or a concurrent worker) already saved this month — treat as
  // an idempotent success and skip the write. This is what stops the automated
  // continuation paths (webhook + cron) silently appending two month-2s.
  const { error: markerErr } = rs.weeklyFill
    ? { error: null }
    : await supa.from("program_months").insert({ program_id: programId, month_number: monthNumber });
  const markerExists = !rs.weeklyFill && markerErr != null &&
    (markerErr.code === "23505" || /duplicate key|already exists/i.test(markerErr.message ?? ""));
  if (markerErr && !markerExists) {
    // Don't orphan a just-created shell behind this throw — without the delete
    // the user is left with an empty "program with no workouts" row.
    if (ownShell) {
      await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
    }
    throw new Error(`[generate-program-v3] program_months marker insert failed: ${markerErr.message}`);
  }
  // The marker on a program this job created itself comes from an earlier,
  // lost attempt of this stage, which may have died half way through its
  // inserts: clear whatever it wrote and save the month again (2026-11-23).
  // On anyone else's program the marker means the month is saved: skip.
  const savePlan = firstBuildSavePlan({
    markerExists,
    continuationProgramId: rs.continuation.programId,
    resumedProgramId: rs.programId,
  });
  if (savePlan === "redo") {
    console.warn(`[generate-program-v3] month ${monthNumber} of ${programId}: an earlier attempt of this job began the save; clearing its rows and saving again`);
    const { error: clearErr } = await supa.from("program_workouts").delete()
      .eq("program_id", programId).eq("month_number", monthNumber);
    if (clearErr) throw new Error(`[generate-program-v3] could not clear the earlier attempt's rows: ${clearErr.message}`);
  }
  const alreadySaved = savePlan === "skip";

  if (!alreadySaved) {
    try {
      await saveProgramV3(supa, userId, output, {
        name: "My GAINS Program",
        skeleton,
        programId, // always append mode in the dispatcher (shell pre-created for first-cycle)
        monthNumber,
        ...(rs.weekly
          ? {
            weekly: {
              composedMetcons: rs.composedMetcons ?? null,
              // A week job whose re-plan FAILED filled from the old skeleton:
              // the stored built_from stays as it is, so the next week job
              // sees the same drift and tries the re-plan again (2026-11-23).
              builtFrom: rs.weeklyFill
                ? builtFromForWeekSave(rs.replan?.failed === true, builtFromOf(rs.payload!.training_context))
                : builtFromOf(rs.payload!.training_context),
              ...(rs.weeklyFill ? { weekAppend: true, skeletonToStore: skeleton } : {}),
            },
          }
          : {}),
      });
      console.log(`[generate-program-v3] saved program ${programId} (month ${monthNumber})`);
      // The month was written with the athlete's "tell your coach" notes in
      // view: spend the one-week ones for Programming (standing notes stay).
      // Only the notes THIS job read (their ids were kept with the payload),
      // and not the ones that asked for a re-plan that failed (2026-11-23).
      await markNotesConsumed(
        supa,
        noteIdsToConsume(rs.coachNoteIds, rs.replan ?? { failed: false, notesNeededIt: false }),
        "programming",
      );

      // Per-generation avoidance record (handoff 1.5 / T6): persist the effective
      // avoidance list that gated THIS cycle, WITH T5 provenance tags — the
      // defensible artifact. Best-effort: a log-write failure must never fail a
      // program that saved. Idempotent via the (program_id, month_number) unique.
      const avoid = payload.training_context.injuries_structured;
      if (avoid) {
        const { error: avErr } = await supa
          .from("program_generation_avoidances")
          .upsert({
            program_id: programId,
            user_id: userId,
            month_number: monthNumber,
            avoidances: {
              do_not_program: avoid.do_not_program,
              blocked_by: avoid.blocked_by ?? {},
            },
          }, { onConflict: "program_id,month_number", ignoreDuplicates: true });
        if (avErr) {
          console.warn("[generate-program-v3] avoidance record write failed (non-fatal):", avErr.message);
        }
      }
    } catch (saveErr) {
      // Undo the marker so a legitimate retry can proceed; delete a fresh shell
      // so a failed first-cycle save doesn't leave an empty program behind.
      await supa.from("program_months").delete()
        .eq("program_id", programId).eq("month_number", monthNumber)
        .then(() => {}, () => {});
      if (ownShell) {
        await supa.from("programs").delete().eq("id", programId).then(() => {}, () => {});
      }
      throw saveErr;
    }
  } else {
    console.log(`[generate-program-v3] month ${monthNumber} already saved for ${programId}; idempotent skip`);
  }

  // Signature queue (rev-61 automation chain, link 1 — every workout gets a
  // signature): enqueue this program's metcon structures and kick the
  // drafting worker. This stage never drafts (its outbound budget is the
  // save's); the worker chain drains within minutes, the reaper guarantees
  // it. Runs AFTER the save and never throws.
  try {
    const sigStats = await enqueueSignatureDraftsForWeeks(supa, output.weeks ?? [], "generate-program-v3");
    console.log(`[generate-program-v3] signature enqueue: ${formatEnqueueStats(sigStats)}`);
    if (sigStats.enqueued > 0) await triggerDraftWorker(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  } catch (sigErr) {
    console.warn("[generate-program-v3] signature enqueue error (non-fatal):", sigErr);
  }

  // Reveal this month's coaching evaluations (non-fatal, scoped to user+month).
  // A MONTH BUILD only: a week job neither hides nor reveals them (2026-11-23).
  if (!rs.weeklyFill) {
    try {
      await Promise.allSettled([
        supa.from("profile_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
        supa.from("training_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
        supa.from("nutrition_evaluations").update({ visible: true }).eq("user_id", userId).eq("month_number", monthNumber),
      ]);
    } catch (visErr) {
      console.warn("[generate-program-v3] eval visibility flip failed (non-fatal):", visErr);
    }
  }

  // Soft audits — log-only safety net.
  try {
    const soft = runSoftAudits({
      output,
      daysPerWeek: payload.training_context.days_per_week,
      lifts: payload.lifts,
      vocabulary: payload.vocabulary,
      // The metcon duration check is log only (2026-11-26) and needs the plan.
      skeleton,
    });
    if (!soft.passed) {
      for (const failure of soft.failures) {
        console.warn(`[generate-program-v3] SOFT AUDIT FAIL [${failure.rule}]:`);
        for (const v of failure.violations) console.warn(`  - ${v}`);
      }
      if (!alreadySaved) {
        await logGenerationAudit(supa, {
          user_id: userId,
          program_id: programId,
          month_number: monthNumber,
          stage: "soft_audit",
          warnings: formatAuditFailuresForLog(soft.failures),
        });
      }
    } else {
      console.log(`[generate-program-v3] soft audits: ${summarizeAuditRun(soft)}`);
    }
  } catch (softErr) {
    console.warn("[generate-program-v3] soft audit error (non-fatal):", softErr);
  }

  // Every metcon that ships with no estimate, and why (2026-11-26). The reason
  // used to go only to the function log.
  if (!alreadySaved) {
    const missing = missingBenchmarkLines(output.weeks ?? []);
    if (missing.length > 0) {
      await logGenerationAudit(supa, {
        user_id: userId,
        program_id: programId,
        month_number: monthNumber,
        stage: "benchmark_missing",
        warnings: missing,
      }).catch((e) => console.warn("[generate-program-v3] benchmark_missing log failed (non-fatal):", e));
    }
  }

  // Persist hard-audit residuals that surgical couldn't resolve (they already
  // ride in result_json, but this table is where recurrence gets analyzed).
  // Gated on !alreadySaved so idempotent re-runs don't double-log.
  const residuals = rs.residualFailures ?? [];
  if (!alreadySaved && residuals.length > 0) {
    await logGenerationAudit(supa, {
      user_id: userId,
      program_id: programId,
      month_number: monthNumber,
      stage: "fill_residual",
      violations: formatAuditFailuresForLog(residuals),
    });
  }

  const elapsedMs = rs.startedAtMs ? Date.now() - rs.startedAtMs : null;
  console.log(`[generate-program-v3] complete: program ${programId} month ${monthNumber} (elapsed ${elapsedMs}ms) safe=${safety.safe} errored=${safety.errored}`);

  return {
    next: "complete",
    resumeState: { ...rs, programId },
    complete: {
      programId,
      resultJson: {
        output,
        safety,
        elapsed_ms: elapsedMs,
        // block-local audits surgical couldn't resolve; empty on a clean run.
        residual_audit_failures: rs.residualFailures ?? [],
      },
    },
  };
}

// ============================================================
// runStage — the dispatcher. Routes the job's current next_stage to its stage
// function through runStageWithLease (claim → heartbeat → run → commit →
// self-retrigger). Invoked at kickoff (stage 1) and by every self-retrigger /
// reaper re-dispatch.
// ============================================================

async function runStage(jobId: string): Promise<void> {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: job } = await supa
    .from("program_jobs")
    .select("next_stage, user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.next_stage) return; // complete / failed / no stage — nothing to do
  const stage = job.next_stage as Stage;
  const userId = job.user_id as string;

  switch (stage) {
    case "payload_building":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stagePayloadBuilding(supa, j, rs));
    case "coach_state":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageCoachState(supa, j, rs));
    case "skeleton":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSkeleton(supa, j, rs));
    case "metcons":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageMetcons(supa, j, rs));
    case "fill_week_1":
    case "fill_week_2":
    case "fill_week_3":
    case "fill_week_4": {
      const weekNum = parseInt(stage.slice("fill_week_".length), 10);
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageFillWeek(supa, j, rs, weekNum));
    }
    case "benchmark_audit":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageBenchmarkAudit(supa, j, rs));
    case "surgical":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSurgical(supa, j, rs));
    case "safety_review":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSafetyReview(supa, j, rs));
    case "saving":
      return runStageWithLease(supa, jobId, userId, FUNCTION_NAME, stage, (j, rs) => stageSaving(supa, j, rs));
    default:
      console.error(`[generate-program-v3] unknown stage: ${stage}`);
  }
}

// Exported for the job-reaper to re-dispatch a stale job in-process if it ever
// runs co-located; the normal re-dispatch path is an HTTP self-retrigger.
export { runStage };

// ============================================================
// HTTP handler — kickoff (auth + month resolution + job row + fire stage 1) OR
// a service-authed resume (self-retrigger / reaper) of an in-flight job.
// ============================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");

    const jsonErr = (status: number, error: string, message?: string) =>
      new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    const body = await req.json().catch(() => ({}));

    // ── Resume path: a self-retrigger or reaper re-dispatch of an in-flight job.
    // Service-only (the service key); runs the job's current stage. The stage's
    // atomic claim makes a duplicate/late resume a safe no-op.
    const resumeJobId: string | null = body?.resume_job_id ?? null;
    if (resumeJobId) {
      if (token !== SUPABASE_SERVICE_KEY) return jsonErr(401, "Unauthorized");
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(resumeJobId));
      return new Response(
        JSON.stringify({ ok: true, resumed: resumeJobId }),
        { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const reqProgramId: string | null = body?.program_id ?? null;
    const reqMonthNumber: number | null =
      typeof body?.month_number === "number" ? body.month_number : null;

    // Auth: internal server-to-server (generate-next-month / webhook / cron pass
    // x-webhook-user-id + the service-role key) OR a user JWT.
    const webhookUserId = req.headers.get("x-webhook-user-id");
    const isServiceCall = !!webhookUserId && token === SUPABASE_SERVICE_KEY;
    let userId: string;
    if (isServiceCall) {
      userId = webhookUserId!;
    } else {
      const { data: { user }, error: authErr } = await supa.auth.getUser(token);
      if (authErr || !user) return jsonErr(401, "Unauthorized");
      userId = user.id;
    }

    // Resolve which month to generate.
    //   - Continuation (program_id present): validate ownership + v3, then the
    //     next month is generated_months + 1. Service callers may pass it
    //     explicitly; user callers get the derived value and CANNOT override it.
    //   - New program (no program_id): users ALWAYS start at month 1. Only a
    //     trusted service caller may seed a new program at month > 1 (migration).
    // WEEK JOB (PR 4): the weekly cron asks for one later week of a weekly
    // program. Service-only. Seeds weeklyFill; the stages branch on it.
    const reqFillWeek: number | null = typeof body?.fill_week === "number" ? body.fill_week : null;
    if (reqFillWeek != null) {
      if (!isServiceCall || !reqProgramId) return jsonErr(400, "Bad Request", "fill_week needs a service call with program_id.");
      const { data: prog } = await supa
        .from("programs").select("id, generated_months, weekly_mode, program_version, archived_at")
        .eq("id", reqProgramId).eq("user_id", userId).maybeSingle();
      if (!prog) return jsonErr(404, "Program not found");
      if (isArchived(prog)) return jsonErr(409, "PROGRAM_ARCHIVED", "This program is archived — it gets no new weeks.");
      if (prog.program_version !== "v3" || !prog.weekly_mode) return jsonErr(400, "Bad Request", "Not a weekly v3 program.");
      const monthNumber = reqMonthNumber ?? (prog.generated_months || 1);
      const { data: activeJob } = await supa
        .from("program_jobs").select("id").eq("user_id", userId).eq("status", "processing")
        .gte("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()).limit(1).maybeSingle();
      if (activeJob) return jsonErr(409, "GENERATION_IN_PROGRESS");
      const initialResume: ResumeState = {
        continuation: { programId: reqProgramId, monthNumber },
        weekly: true,
        weeklyFill: { weekNum: reqFillWeek },
      };
      const { data: job, error: jobErr } = await supa
        .from("program_jobs")
        .insert({ user_id: userId, status: "processing", stage: "payload_building", next_stage: "payload_building", program_id: reqProgramId, resume_state: initialResume })
        .select("id").single();
      if (jobErr || !job) return jsonErr(500, "Failed to start week fill");
      (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(job.id));
      return new Response(JSON.stringify({ ok: true, job_id: job.id, fill_week: reqFillWeek }), {
        status: 202, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let monthNumber: number;
    if (reqProgramId) {
      const { data: prog } = await supa
        .from("programs")
        .select("id, generated_months, program_version, archived_at")
        .eq("id", reqProgramId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!prog) return jsonErr(404, "Program not found");
      // Archived programs are view only (2026-11-21).
      if (isArchived(prog)) {
        return jsonErr(409, "PROGRAM_ARCHIVED", "This program is archived — it cannot get a new month. Build a new program instead.");
      }
      if (prog.program_version !== "v3") {
        return jsonErr(400, "Bad Request", "Continuation requires a v3 program.");
      }
      const nextMonth = (prog.generated_months || 1) + 1;
      if (isServiceCall) {
        monthNumber = reqMonthNumber ?? nextMonth;
      } else {
        if (reqMonthNumber != null && reqMonthNumber !== nextMonth) {
          return jsonErr(400, "Bad Request", `Can only generate month ${nextMonth} next for this program.`);
        }
        monthNumber = nextMonth;
      }
      // ANY month of an existing program can be rebuilt by the admin rebuild,
      // month 1 included (founder, 2026-11-27: "you should be able to rebuild
      // the current month no matter what month it is"). It used to be refused
      // for month 1, so a month-1 rebuild cleared the month and then could not
      // build it. A service call names the month; the save's month marker
      // still stops the same month being saved twice. An athlete's own call
      // can only ever add the next month, as before.
      if (monthNumber < 1 || (!isServiceCall && monthNumber < 2)) {
        return jsonErr(400, "Bad Request", "Continuation month must be ≥ 2.");
      }
    } else {
      monthNumber = isServiceCall ? (reqMonthNumber ?? 1) : 1;
      // RETURNER (founder, 2026-11-21): someone whose programs were archived
      // builds a new one only from an evaluation run SINCE the archive — the
      // one they left behind describes an athlete who has been away. Athlete
      // callers only: the service first-gen (generate-next-month) runs its own
      // fresh evaluation just before calling here, and the payload builder
      // refuses to read an old one either way.
      if (!isServiceCall) {
        const archiveCutoff = await loadArchiveCutoff(supa, userId);
        if (archiveCutoff) {
          const { data: freshEval } = await supa
            .from("profile_evaluations")
            .select("id")
            .eq("user_id", userId)
            .eq("status", "complete")
            .gt("created_at", archiveCutoff)
            .limit(1)
            .maybeSingle();
          if (!freshEval) {
            return jsonErr(409, "EVALUATION_REQUIRED", "Run your evaluation first — your new program is built from it.");
          }
        }
      }
    }

    // ── Concurrency guard (Sep '26): a user fired three generations in 20
    // minutes — the duplicate died on a 529 (a false-alarm failure email) and
    // the third saved a SECOND program. One active job per user, kickoff-wide
    // (user AND service callers; the resume path above is untouched).
    // "Active" = processing with a recent heartbeat — stage transitions bump
    // updated_at, so a crashed job goes quiet and stops blocking after the
    // window even if the reaper hasn't cleaned it up yet.
    const ACTIVE_JOB_WINDOW_MS = 30 * 60 * 1000;
    const { data: activeJob } = await supa
      .from("program_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "processing")
      .gte("updated_at", new Date(Date.now() - ACTIVE_JOB_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    if (activeJob) {
      // job_id rides along so the client can reattach its progress polling to
      // the run already in flight instead of surfacing an error.
      return new Response(
        JSON.stringify({
          error: "GENERATION_IN_PROGRESS",
          message:
            "A program generation is already running for this account — it usually takes a few minutes. Hang tight; there's no need to start another.",
          job_id: activeJob.id,
        }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Create the job already at stage 1, with continuation seeded into
    // resume_state (payload_building needs monthNumber). status='processing' so
    // the first claim succeeds; locked_at null so it's immediately claimable.
    const initialResume: ResumeState = {
      continuation: { programId: reqProgramId, monthNumber },
    };
    const { data: job, error: jobErr } = await supa
      .from("program_jobs")
      .insert({
        user_id: userId,
        status: "processing",
        stage: "payload_building",
        next_stage: "payload_building",
        resume_state: initialResume,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("[generate-program-v3] failed to create job:", jobErr);
      return jsonErr(500, "Failed to start v3 program generation");
    }

    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(runStage(job.id));

    return new Response(
      JSON.stringify({ ok: true, job_id: job.id }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[generate-program-v3] unhandled:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(
      JSON.stringify({ error: "GENERATION_FAILED", message }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
