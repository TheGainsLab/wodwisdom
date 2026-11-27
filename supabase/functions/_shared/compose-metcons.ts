/**
 * compose-metcons — write the metcons for a set of slots (week 1 on a first
 * build, one later week from the weekly job), count what code counts, and
 * send a miss back once. What comes back ships: nothing here deletes or
 * rewrites a piece.
 *
 * `priorPieces` are the month's earlier weeks. The composer is shown them as
 * THIS MONTH SO FAR and the counts run over the month so far as a whole.
 * Only the NEW pieces are returned.
 */

import { MODELS } from "./model-profiles.ts";
import { callMetconComposer, describeComposedPiece, type ComposedMetcon, type MetconComposerInputs, type MetconSlot } from "./metcon-composer.ts";
import {
  auditMetconVariety,
  formatMetconVarietyViolationsForRetry,
  repairComposerEmission,
  stripStructuralRestRows,
} from "./metcon-variety-audits.ts";

import type { WriterPayload } from "./build-writer-payload.ts";
import type { TrainingDesignInput } from "./training-design-input.ts";
import { athleteWordsElsewhere } from "./athlete-file-text.ts";

/**
 * Everything the composer is given about the athlete, from the build's
 * payload and plan inputs. ONE builder, used by the real build and by the
 * dry run (metcon-dry-run), so the dry run shows the composer exactly what a
 * build would. Slots and notes are added by the caller.
 */
export function buildComposerInputs(
  payload: WriterPayload,
  tdi: TrainingDesignInput,
  library: { examples: string; articles: string; previousCycleMetcons: string[] },
): Omit<MetconComposerInputs, "slots"> {
  return {
    goal_text: payload.training_context.goal_text ?? null,
    basics: {
      age: payload.basics.age ?? null,
      sex: payload.basics.gender ?? null,
      bodyweight: payload.basics.bodyweight ?? null,
    },
    units: payload.basics.units === "kg" ? "kg" : "lbs",
    lifts: tdi.lifts,
    skills: payload.skills,
    conditioning_benchmarks: payload.conditioning,
    equipment: tdi.equipment,
    injuries_text: payload.training_context.injuries_constraints_text ?? null,
    do_not_program: tdi.do_not_program,
    athlete_words: athleteWordsElsewhere(payload.athlete_model?.self_report, []),
    coach_notes: payload.training_context.coach_notes ?? [],
    vocabulary: tdi.vocabulary,
    previous_cycle_metcons: library.previousCycleMetcons,
    examples: library.examples,
    articles: library.articles,
    // The athlete's completed Engine sessions, or null. Rebuilt on every
    // generation, so the composer sees their current Engine month.
    engine_training: payload.engine_training ?? null,
  };
}

export type AuditOpts = Omit<Parameters<typeof auditMetconVariety>[1], "slots">;

export interface ComposeResult {
  pieces: ComposedMetcon[];
  violations: string[];
  warnings: string[];
  retried: boolean;
  firstPassViolations: string[];
  repairs: string[];
}

export async function composeMetconsForSlots(opts: {
  inputs: Omit<MetconComposerInputs, "slots">;
  slots: MetconSlot[];
  priorSlots?: MetconSlot[];
  priorPieces?: ComposedMetcon[];
  auditOpts: AuditOpts;
  logPrefix?: string;
}): Promise<ComposeResult> {
  const tag = opts.logPrefix ?? "[compose-metcons]";
  const prior = opts.priorPieces ?? [];
  const priorSlots = opts.priorSlots ?? [];
  const inputs: MetconComposerInputs = {
    ...opts.inputs,
    slots: opts.slots,
    ...(prior.length ? { already_composed_this_month: prior.map(describeComposedPiece) } : {}),
  };
  const auditOpts = { ...opts.auditOpts, slots: [...priorSlots, ...opts.slots] };
  const newKeys = new Set(opts.slots.map((s) => `${s.week_num}-${s.day_num}`));
  const onlyNew = (all: ComposedMetcon[]) => all.filter((m) => newKeys.has(`${m.week_num}-${m.day_num}`));

  const composeRepaired = async (retryViolations?: string) => {
    const raw = await callMetconComposer(inputs, { model: MODELS.fable, ...(retryViolations ? { retryViolations } : {}) });
    const { output, repairs } = repairComposerEmission(raw);
    if (repairs.length) console.warn(`${tag} composer emission repaired: ${repairs.join(" | ")}`);
    const strippedRest = stripStructuralRestRows(output);
    if (strippedRest > 0) console.log(`${tag} stripped ${strippedRest} structural Rest row(s)`);
    // The month as the audit sees it: what was written before + what was just composed.
    output.metcons = [...prior, ...onlyNew(output.metcons)];
    return { output, repairs };
  };

  let { output, repairs } = await composeRepaired();
  let audit = auditMetconVariety(output, auditOpts);
  let retried = false;
  let firstPassViolations: string[] = [];
  if (!audit.passed) {
    retried = true;
    firstPassViolations = audit.violations;
    console.warn(`${tag} metcon count misses (sending back once): ${audit.violations.join(" | ")}`);
    const retry = await composeRepaired(formatMetconVarietyViolationsForRetry(audit.violations));
    output = retry.output;
    repairs = [...repairs, ...retry.repairs];
    audit = auditMetconVariety(output, auditOpts);
    if (!audit.passed) {
      // Nothing content-shaped fails a job, and no composed piece is deleted
      // (2026-11-26): pieces used to be dropped here when a movement's name
      // was on the avoid list, off the movement list, or contained a machine
      // word the athlete had unticked. What is left after the retry ships.
      if (!audit.passed) console.warn(`${tag} metcon count misses remain (accepting): ${audit.violations.join(" | ")}`);
    }
  }
  if (audit.warnings.length) console.log(`${tag} metcon warnings: ${audit.warnings.join(" | ")}`);
  return { pieces: onlyNew(output.metcons), violations: audit.violations, warnings: audit.warnings, retried, firstPassViolations, repairs };
}
