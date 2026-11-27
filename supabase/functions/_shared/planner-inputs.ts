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
import { auditSkeletonSkillNames, buildSkillsBrief, coachStateForPlanner } from "./skills-plan.ts";

/** The coach state (without its skill areas), the athlete's skills, and the
 *  planner's article. Any part that is empty is left out. */
export function plannerDocument(
  coachState: CoachStateContent | null,
  payload: Pick<WriterPayload, "skills" | "equipment" | "training_context">,
  articles: string,
): string {
  return [
    coachState ? buildCoachStateDocumentBlock(coachStateForPlanner(coachState)) : "",
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
