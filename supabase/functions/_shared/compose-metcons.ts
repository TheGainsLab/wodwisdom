/**
 * compose-metcons — compose the conditioning pieces for a set of slots (a
 * month, or ONE WEEK in weekly mode), with the variety audit, one retry,
 * boundary repairs and the drop-illegal fallback. Extracted from
 * generate-program-v3's metcons stage (2026-11-13, weekly Programming PR 3)
 * so the weekly cron composes each week the same way.
 *
 * Weekly mode: `priorPieces` are the month's earlier weeks; they are shown to
 * the composer as ALREADY COMPOSED and included in the audit's view of the
 * month, so distinctness is a running check against what is written. Only
 * the NEW pieces are returned.
 */

import { MODELS } from "./model-profiles.ts";
import { callMetconComposer, type ComposedMetcon, type MetconComposerInputs, type MetconSlot } from "./metcon-composer.ts";
import {
  auditMetconVariety,
  dropIllegalComposedPieces,
  formatMetconVarietyViolationsForRetry,
  repairComposerEmission,
  stripStructuralRestRows,
} from "./metcon-variety-audits.ts";
import { trimComposedMovementAnnotations } from "./movement-name-repair.ts";

export type AuditOpts = Omit<Parameters<typeof auditMetconVariety>[1], "slots">;

export interface ComposeResult {
  pieces: ComposedMetcon[];
  violations: string[];
  warnings: string[];
  retried: boolean;
  firstPassViolations: string[];
  repairs: string[];
}

/** One line per piece, for the composer's ALREADY COMPOSED list. */
export function summarizeComposedPiece(m: ComposedMetcon): string {
  const moves = (m.movements ?? []).map((x) => x.movement).filter(Boolean).join(", ");
  const td = (m as unknown as { time_domain?: string }).time_domain ?? "";
  return `W${m.week_num}D${m.day_num} ${m.format ?? ""} ${td}: ${moves}`.replace(/\s+/g, " ").trim();
}

export async function composeMetconsForSlots(opts: {
  inputs: Omit<MetconComposerInputs, "slots">;
  slots: MetconSlot[];
  priorSlots?: MetconSlot[];
  priorPieces?: ComposedMetcon[];
  auditOpts: AuditOpts;
  vocabulary: string[];
  doNotProgram: string[];
  equipment: Record<string, boolean>;
  logPrefix?: string;
}): Promise<ComposeResult> {
  const tag = opts.logPrefix ?? "[compose-metcons]";
  const prior = opts.priorPieces ?? [];
  const priorSlots = opts.priorSlots ?? [];
  const inputs: MetconComposerInputs = {
    ...opts.inputs,
    slots: opts.slots,
    ...(prior.length ? { already_composed_this_month: prior.map(summarizeComposedPiece) } : {}),
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
    const nameRepairs = trimComposedMovementAnnotations(output.metcons, opts.vocabulary);
    if (nameRepairs.length) console.warn(`${tag} movement names repaired: ${nameRepairs.join(" | ")}`);
    // The month as the audit sees it: what was written before + what was just composed.
    output.metcons = [...prior, ...onlyNew(output.metcons)];
    return { output, repairs: [...repairs, ...nameRepairs] };
  };

  let { output, repairs } = await composeRepaired();
  let audit = auditMetconVariety(output, auditOpts);
  let retried = false;
  let firstPassViolations: string[] = [];
  if (!audit.passed) {
    retried = true;
    firstPassViolations = audit.violations;
    console.warn(`${tag} metcon variety violations (retrying once): ${audit.violations.join(" | ")}`);
    const retry = await composeRepaired(formatMetconVarietyViolationsForRetry(audit.violations));
    output = retry.output;
    repairs = [...repairs, ...retry.repairs];
    audit = auditMetconVariety(output, auditOpts);
    if (!audit.passed) {
      // Founder ruling 2026-09-01: nothing content-shaped fails a job. A piece
      // still illegal after the retry is dropped; the fill rebuilds its slot.
      const dropped = dropIllegalComposedPieces(output, { vocabulary: opts.vocabulary, doNotProgram: opts.doNotProgram, equipment: opts.equipment });
      if (dropped.length) {
        console.warn(`${tag} illegal composed pieces dropped (fill will rebuild their slots): ${dropped.join(" | ")}`);
        repairs = [...repairs, ...dropped];
        audit = auditMetconVariety(output, auditOpts);
      }
      if (!audit.passed) console.warn(`${tag} metcon variety violations persist (accepting): ${audit.violations.join(" | ")}`);
    }
  }
  if (audit.warnings.length) console.log(`${tag} metcon variety warnings: ${audit.warnings.join(" | ")}`);
  return { pieces: onlyNew(output.metcons), violations: audit.violations, warnings: audit.warnings, retried, firstPassViolations, repairs };
}
