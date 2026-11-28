/**
 * planner-inputs.ts — what the planner is sent besides the plan inputs, and
 * the counts run on what it returns. ONE place, used by the build
 * (generate-program-v3) and the dry run (metcon-dry-run), so the dry run
 * shows the planner exactly what a build would.
 */
import { buildCoachStateDocumentBlock, type CoachStateContent } from "./coach-state.ts";
import type { WriterPayload } from "./build-writer-payload.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import { auditSkeletonMetconMix, type SkeletonAuditResult } from "./v3-skeleton-audits.ts";
import { auditSkeletonSkillNames, buildSkillsBrief, coachStateForPlanner, stripSkillAreasFromTdi } from "./skills-plan.ts";
import { buildLiftsBrief, coachStateWithoutStrength, stripStrengthFromTdi } from "./strength-plan.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";

/** The plan inputs as the planner gets them: no skill area, no strength area
 *  and no strength emphasis. What is left of the coach's lists is conditioning. */
export function tdiForPlanner(tdi: TrainingDesignInput): TrainingDesignInput {
  return stripStrengthFromTdi(stripSkillAreasFromTdi(tdi));
}

/** The coach state (without its skill and strength areas), the athlete's
 *  lifts, the athlete's skills, and the planner's article. Any part that is
 *  empty is left out. */
export function plannerDocument(
  coachState: CoachStateContent | null,
  payload: Pick<WriterPayload, "skills" | "equipment" | "training_context" | "lifts" | "basics" | "athlete_model">,
  articles: string,
): string {
  return [
    coachState ? buildCoachStateDocumentBlock(coachStateWithoutStrength(coachStateForPlanner(coachState))) : "",
    buildLiftsBrief({
      lifts: payload.lifts,
      // deno-lint-ignore no-explicit-any
      normative: (payload.athlete_model as any)?.normative ?? null,
      goalText: payload.training_context?.goal_text ?? null,
      basics: payload.basics,
      injuriesText: payload.training_context?.injuries_constraints_text ?? null,
      coachNotes: payload.training_context?.coach_notes ?? [],
    }),
    buildSkillsBrief({
      skills: payload.skills as Record<string, string | null>,
      goalText: payload.training_context?.goal_text ?? null,
      equipment: payload.equipment,
    }),
    articles,
  ].filter(Boolean).join("\n\n");
}

/** Everything counted on a plan after the planner and sent back once on a
 *  miss: the metcon time-domain mix and rotation, and a skills day that
 *  names no skill. Never fails a job. */
export function planCounts(skeleton: SkeletonOutput, fromWeek = 1): SkeletonAuditResult {
  const mix = auditSkeletonMetconMix(skeleton, fromWeek);
  const violations = [...mix.violations, ...auditSkeletonSkillNames(skeleton, fromWeek)];
  return { rule: mix.rule, passed: violations.length === 0, violations };
}
