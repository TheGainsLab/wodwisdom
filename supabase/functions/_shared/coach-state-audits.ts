/**
 * coach-state-audits.ts
 *
 * Deterministic integrity checks for CoachState output — the eval layer's
 * counterpart to v3-skeleton-audits. The tool schema already constrains WHAT
 * can be emitted (enums, per-athlete evidence + reason shaping); these audits
 * check the CROSS-FIELD claims a schema can't reach:
 *
 *   - reason codes the athlete's data cannot support (belt-and-braces with
 *     allowedReasonCodes shaping — catches cached/legacy outputs too)
 *   - already_at_standard on an axis whose own normatives sit well_below
 *   - "high" decision confidence when every underlying fact is low-confidence
 *     self-report and no competition data exists
 *   - the same focus appearing in priorities AND maintain/deprioritize
 *   - duplicate / out-of-range priority ranks
 *   - evidence keys that don't exist in this athlete's model
 *
 * Pure functions, no IO. Used by generate-coach-state's retry loop; violations
 * are quality defects, not fatal — the caller decides whether to retry/accept.
 */

import type { CoachStateContent, FocusArea } from "./coach-state.ts";
import { allowedReasonCodes, type ReasonShapingInputs } from "./coach-state.ts";
import type { Normative } from "./athlete-model.ts";

export interface CoachStateAuditResult {
  passed: boolean;
  violations: string[];
}

/** The payload shape the audits need — structurally satisfied by WriterPayload. */
export interface CoachStateAuditInputs extends ReasonShapingInputs {
  athlete_model: ReasonShapingInputs["athlete_model"] & {
    normative?: Record<string, Normative>;
    competition_movements?: Record<string, unknown>;
    capabilities?: Record<string, { confidence?: string } | undefined>;
  };
}

/** Which strength normatives speak for each focus axis. Only axes with
 *  normative coverage appear — gymnastics/conditioning axes are judged from
 *  competition movements / self-report, which these audits don't second-guess.
 *  posterior_chain is the hinge BALANCE axis (deadlift vs squat);
 *  powerlifting_strength is ABSOLUTE force vs bodyweight. */
const FOCUS_NORMATIVE_KEYS: Partial<Record<FocusArea, string[]>> = {
  olympic_lifting: ["snatch_to_back_squat", "clean_jerk_to_back_squat", "snatch_to_clean_jerk"],
  powerlifting_strength: ["back_squat_to_bodyweight", "deadlift_to_bodyweight"],
  posterior_chain: ["deadlift_to_back_squat"],
  upper_body_pressing: ["press_to_bodyweight", "bench_to_bodyweight"],
};

export function auditCoachState(
  cs: CoachStateContent,
  payload: CoachStateAuditInputs,
): CoachStateAuditResult {
  const violations: string[] = [];
  const model = payload.athlete_model;
  const normative = model.normative ?? {};

  // 1. Reason codes the athlete's data cannot support.
  const allowed = new Set<string>(allowedReasonCodes(payload));
  const reasonSites: Array<[string, readonly string[]]> = [
    ...cs.priorities.map((p) => [`priority ${p.focus}`, p.reasons] as [string, readonly string[]]),
    ...cs.maintain.map((m) => [`maintain ${m.focus}`, m.reasons] as [string, readonly string[]]),
    ...cs.deprioritize.map((d) => [`deprioritize ${d.focus}`, d.reasons] as [string, readonly string[]]),
    ["recovery_posture", cs.recovery_posture.reasons],
    ["strength_emphasis", cs.strength_emphasis.reasons],
  ];
  for (const [site, reasons] of reasonSites) {
    for (const r of reasons) {
      if (!allowed.has(r)) {
        violations.push(`${site}: reason "${r}" is not supported by this athlete's data (no grounding input exists).`);
      }
    }
  }

  // 2. already_at_standard vs the axis's own normatives.
  const atStandardSites = [
    ...cs.maintain.filter((m) => m.reasons.includes("already_at_standard")).map((m) => m.focus),
    ...cs.deprioritize.filter((d) => d.reasons.includes("already_at_standard")).map((d) => d.focus),
  ];
  for (const focus of atStandardSites) {
    const keys = FOCUS_NORMATIVE_KEYS[focus];
    if (!keys) continue;
    const wellBelow = keys.filter((k) => normative[k]?.position === "well_below");
    if (wellBelow.length > 0) {
      violations.push(
        `${focus}: reason "already_at_standard" contradicts the model — ${wellBelow.join(", ")} sit(s) well_below the bar.`,
      );
    }
  }

  // 3. Confidence cap: all-self-reported, no competition → no "high" priorities.
  const caps = Object.values(model.capabilities ?? {});
  const allLowConfidence = caps.length > 0 &&
    caps.every((c) => (c?.confidence ?? "low") === "low");
  const hasCompetition = payload.competition != null ||
    (model.logged_competition_results ?? []).length > 0 ||
    Object.keys(model.competition_movements ?? {}).length > 0;
  if (allLowConfidence && !hasCompetition) {
    for (const p of cs.priorities) {
      if (p.confidence === "high") {
        violations.push(
          `priority ${p.focus}: confidence "high" but every underlying fact is low-confidence self-report with no competition data — cap at "medium".`,
        );
      }
    }
  }

  // 4. A focus cannot be developed and maintained/deprioritized at once.
  const priorityFoci = new Set(cs.priorities.map((p) => p.focus));
  for (const m of cs.maintain) {
    if (priorityFoci.has(m.focus)) {
      violations.push(`${m.focus} appears in both priorities and maintain — pick one.`);
    }
  }
  for (const d of cs.deprioritize) {
    if (priorityFoci.has(d.focus)) {
      violations.push(`${d.focus} appears in both priorities and deprioritize — pick one.`);
    }
  }

  // 5. Ranks: unique, 1..N.
  const ranks = cs.priorities.map((p) => p.rank);
  if (new Set(ranks).size !== ranks.length) {
    violations.push(`Duplicate priority ranks: ${ranks.join(", ")}.`);
  }
  for (const r of ranks) {
    if (r < 1 || r > cs.priorities.length + 1) {
      violations.push(`Priority rank ${r} is out of range for ${cs.priorities.length} priorities.`);
    }
  }

  // 6. Evidence keys must exist in this athlete's model (defense-in-depth
  //    behind the per-athlete enum — catches drifted cached outputs).
  const validEvidence = new Set([
    ...Object.keys(normative),
    ...Object.keys(model.competition_movements ?? {}),
    // Skill-pair flags count as evidence only when TRUE for this athlete.
    ...Object.entries((model as { derived_metrics?: Record<string, unknown> }).derived_metrics ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  ]);
  if (validEvidence.size > 0) {
    for (const p of cs.priorities) {
      for (const e of p.evidence) {
        if (!validEvidence.has(e)) {
          violations.push(`priority ${p.focus}: evidence key "${e}" does not exist in this athlete's model.`);
        }
      }
    }
  }

  // 7. month_in_review presence mirrors previous_cycle (v1.7): a review of a
  //    cycle that never happened is fabrication; a missing review when real
  //    history exists silently drops the training-evaluation render.
  const hasPrevCycle = payload.previous_cycle != null;
  const hasReview = typeof cs.month_in_review === "string" && cs.month_in_review.trim() !== "";
  if (hasPrevCycle && !hasReview) {
    violations.push(
      "month_in_review is missing but the payload carries a previous_cycle — emit the athlete-facing review of the completed cycle, grounded in its logged numbers.",
    );
  }
  if (!hasPrevCycle && hasReview) {
    violations.push(
      "month_in_review was emitted but this athlete has NO previous_cycle — omit the field entirely for a first cycle.",
    );
  }

  return { passed: violations.length === 0, violations };
}

/** Retry-message formatting, mirroring the skeleton audit loop's pattern. */
export function formatCoachStateViolationsForRetry(violations: string[]): string {
  return [
    "Your previous coach-state emission failed integrity checks. Fix ONLY these violations and re-emit via emit_coach_state — keep every judgment that is not named below unchanged.",
    "",
    ...violations.map((v) => `  - ${v}`),
  ].join("\n");
}
