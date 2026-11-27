/**
 * metcon-dry-run — run the planner and the composer for one member and SAVE
 * NOTHING (metcon rebuild step 3, 2026-11-27).
 *
 * So the founder can read real metcons before a change to what the planner
 * or composer is told reaches a member. It reads the member's most recent
 * finished build (program_jobs.resume_state: the payload, coach state and
 * plan inputs that build used) and runs the SAME planner and composer code a
 * build runs, with the same library draw. It writes to no table: no program,
 * no job, no audit log, no coach state.
 *
 * Because it starts from the last build's stored inputs, a profile change
 * made since that build is not reflected. The movement list is the one
 * exception: it is read fresh, as a build reads it.
 *
 * Service role only. Two steps, because the planner and the composer
 * together do not fit one request:
 *
 *   POST { "user_id": "...", "step": "plan" }
 *     → { skeleton, time_domains, mix }      the planner's month + the mix count
 *
 *   POST { "user_id": "...", "step": "compose", "skeleton": <from plan>,
 *          "week": 1, "prior_pieces": [] }
 *     → { pieces, text, violations, warnings, retried, first_pass_violations }
 *   For week 2+, pass the earlier weeks' pieces as prior_pieces: the composer
 *   is shown them as the month so far, as in a real weekly job.
 *
 *   POST { "user_id": "...", "step": "write", "skeleton": <from plan>,
 *          "week": 1, "pieces": <from compose>, "prior_weeks": [] }
 *     → { text, checks_would_flag, week_written }
 *   The writer's week: every block of every day, with what the plan asked for
 *   beside it. The rewriter and the finish-time estimates are not run. What
 *   the member logged is not shown to the writer (a dry-run plan is not the
 *   plan they trained).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDomainPack } from "../_shared/domain-packs/registry.ts";
import { auditOutput, callSkeletonWriter, callWeekFill, generateSkeletonWithAudits } from "../_shared/engine/pipeline.ts";
import { renderWeekSchemesInPlace } from "../_shared/compose-block-scheme.ts";
import { formatSkeletonViolationsForRetry } from "../_shared/v3-skeleton-audits.ts";
import { planCounts, plannerDocument } from "../_shared/planner-inputs.ts";
import { stripSkillAreasFromTdi } from "../_shared/skills-plan.ts";
import type { CoachStateContent } from "../_shared/coach-state.ts";
import type { TrainingDesignInput } from "../_shared/training-design-input.ts";
import { fetchMovementsByBlock, fetchVocabulary, movementListFor, type WriterPayload } from "../_shared/build-writer-payload.ts";
import type { SkeletonOutput } from "../_shared/v3-output-schema.ts";
import {
  type ComposedMetcon,
  deriveMetconSlots,
  describeComposedPiece,
  normalizeMetconTimeDomains,
} from "../_shared/metcon-composer.ts";
import { pieceAsText, timeDomainTable, weekAsText } from "../_shared/metcon-dry-run-text.ts";
import { buildComposerInputs, composeMetconsForSlots } from "../_shared/compose-metcons.ts";
import { COMPOSER_ARTICLES, loadArticleBlock, loadExampleBlock, PLANNER_ARTICLES } from "../_shared/metcon-library.ts";
import { loadMonthStore } from "../_shared/weekly-fill.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PACK = getDomainPack("crossfit@3");

function isServiceRole(header: string | null): boolean {
  const token = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SUPABASE_SERVICE_KEY) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

interface StoredBuild {
  job_id: string;
  built_at: string;
  payload: WriterPayload;
  coachState: CoachStateContent | null;
  tdi: TrainingDesignInput;
  programId: string | null;
  monthNumber: number;
}

/** The member's most recent finished build that still holds its inputs. */
async function loadLastBuild(supa: SupabaseClient, userId: string): Promise<StoredBuild | null> {
  const { data, error } = await supa
    .from("program_jobs")
    .select("id, created_at, resume_state")
    .eq("user_id", userId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`reading the member's builds failed: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const rs = row.resume_state;
    if (rs?.payload && rs?.trainingDesignInput) {
      return {
        job_id: row.id,
        built_at: row.created_at,
        payload: rs.payload,
        coachState: rs.coachState ?? null,
        tdi: rs.trainingDesignInput,
        programId: rs.continuation?.programId ?? rs.programId ?? null,
        monthNumber: rs.continuation?.monthNumber ?? 1,
      };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
  if (!isServiceRole(req.headers.get("Authorization"))) return json({ error: "service role only" }, 401);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "send a JSON body" }, 400); }
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const step = body?.step;
  if (!userId || (step !== "plan" && step !== "compose" && step !== "write")) {
    return json({ error: 'send { "user_id": "...", "step": "plan" | "compose" | "write" }' }, 400);
  }
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const build = await loadLastBuild(supa, userId);
    if (!build) return json({ error: "this member has no finished build with stored inputs to run from" }, 404);
    // The movement list is read fresh, as a build reads it: the stored build
    // holds the list as it was on the day it ran, so a change to the list
    // made since would not show in the dry run.
    const listNow = await fetchVocabulary(supa);
    if (listNow.length > 0) {
      build.payload = { ...build.payload, vocabulary: listNow, vocabulary_by_block: await fetchMovementsByBlock(supa) };
      // As a build does: the planner is shown the strength and skills part.
      build.tdi = { ...build.tdi, vocabulary: movementListFor(build.payload, ["strength", "skills"]) };
    }
    // As a build does: the planner is not given the four skill areas. (A
    // build stored before 2026-11-28 still holds them.)
    build.tdi = stripSkillAreasFromTdi(build.tdi);
    const from = { job_id: build.job_id, built_at: build.built_at, month_number: build.monthNumber };

    if (step === "plan") {
      // As a build does: the coach state without its skill areas, the
      // athlete's skills, and the planner's article.
      const doc = plannerDocument(build.coachState, build.payload, await loadArticleBlock(supa, PLANNER_ARTICLES));
      let skeleton = await generateSkeletonWithAudits(build.tdi, PACK, undefined, doc);
      // The same count and single send-back a build runs (withMixCheck), without the log row.
      let mix = planCounts(skeleton);
      const firstMix = mix.violations;
      let mixRetried = false;
      if (!mix.passed) {
        mixRetried = true;
        try {
          const retry = await callSkeletonWriter(build.tdi, formatSkeletonViolationsForRetry([mix]), PACK, doc);
          const hard = PACK.audits.runSkeleton({ skeleton: retry, daysPerWeek: build.tdi.days_per_week, trainingDesignInput: build.tdi });
          const retryMix = planCounts(retry);
          if (hard.passed && retryMix.violations.length < mix.violations.length) { skeleton = retry; mix = retryMix; }
        } catch (e) {
          console.warn("[metcon-dry-run] mix send-back failed (keeping the first plan):", e);
        }
      }
      return json({
        dry_run: true, saved: "nothing", from,
        time_domains: timeDomainTable(skeleton),
        mix: { passed: mix.passed, violations: mix.violations, sent_back: mixRetried, first_pass_violations: mixRetried ? firstMix : [] },
        skeleton,
      });
    }

    if (step === "write") {
      // The writer, for one week, exactly as a build calls it: the plan, that
      // week's composed metcons, and the weeks before it. The rewriter and the
      // finish-time estimates are NOT run, so this is the writer's own work.
      if (!body.skeleton?.weeks) return json({ error: 'write needs "skeleton": the skeleton returned by the plan step' }, 400);
      const skeleton = normalizeMetconTimeDomains(body.skeleton as SkeletonOutput);
      const week = Number.isInteger(body.week) ? body.week : 1;
      const pieces: ComposedMetcon[] = (Array.isArray(body.pieces) ? body.pieces : []).filter((p: ComposedMetcon) => p.week_num === week);
      const priorWeeks = Array.isArray(body.prior_weeks) ? body.prior_weeks : [];
      const wk = await callWeekFill(build.payload, skeleton, week, priorWeeks, "", PACK, pieces);
      renderWeekSchemesInPlace(wk);
      // As a build does: the composer's purpose goes on the metcon block.
      for (const m of pieces) {
        const metconBlock = wk.days?.find((d) => d.day_num === m.day_num)?.blocks?.find((b) => b.block_type === "metcon");
        if (metconBlock && m.stimulus_note?.trim()) (metconBlock as { stimulus_note?: string }).stimulus_note = m.stimulus_note.trim().slice(0, 500);
      }
      // What the checks after the writer would send for a rewrite. Listed, not acted on.
      const audit = auditOutput({ month_plan: skeleton.month_plan, weeks: [wk] } as never, build.payload, skeleton, PACK, 1);
      const skeletonWeek = (skeleton.weeks ?? []).find((w) => w.week_num === week);
      return json({
        dry_run: true, saved: "nothing", from, week,
        list_by_block: build.payload.vocabulary_by_block != null,
        composed_metcons_given: pieces.length,
        checks_would_flag: (audit as { failures?: unknown }).failures ?? audit,
        text: weekAsText(wk, skeletonWeek),
        week_written: wk,
      });
    }

    // step === "compose"
    if (!body.skeleton?.weeks) return json({ error: 'compose needs "skeleton": the skeleton returned by the plan step' }, 400);
    const skeleton = normalizeMetconTimeDomains(body.skeleton as SkeletonOutput);
    const week = Number.isInteger(body.week) ? body.week : 1;
    const priorPieces: ComposedMetcon[] = Array.isArray(body.prior_pieces) ? body.prior_pieces : [];
    const slots = deriveMetconSlots(skeleton);
    const [examples, articles] = await Promise.all([loadExampleBlock(supa), loadArticleBlock(supa, COMPOSER_ARTICLES)]);
    let previousCycleMetcons: string[] = [];
    if (build.programId && build.monthNumber > 1) {
      const last = await loadMonthStore(supa, build.programId, build.monthNumber - 1).catch(() => null);
      previousCycleMetcons = (last?.composed_metcons ?? []).map(describeComposedPiece);
    }
    const composed = await composeMetconsForSlots({
      inputs: buildComposerInputs(build.payload, build.tdi, { examples, articles, previousCycleMetcons }),
      slots: slots.filter((s) => s.week_num === week),
      priorSlots: slots.filter((s) => s.week_num < week),
      priorPieces: priorPieces.filter((p) => p.week_num < week),
      auditOpts: { engineActive: build.payload.engine_training != null },
      logPrefix: "[metcon-dry-run]",
    });
    return json({
      dry_run: true, saved: "nothing", from, week,
      examples_loaded: examples !== "", articles_loaded: articles !== "", last_month_pieces: previousCycleMetcons.length,
      sent_back: composed.retried,
      first_pass_violations: composed.firstPassViolations,
      violations: composed.violations,
      warnings: composed.warnings,
      text: composed.pieces.map(pieceAsText).join("\n\n"),
      pieces: composed.pieces,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
