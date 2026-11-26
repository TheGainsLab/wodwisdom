/**
 * The "Workout Details" rows of an Engine day: every part of the session with
 * its duration and its target, exactly as the athlete sees them.
 *
 * ONE function builds the rows. The day page draws them, and the same rows are
 * sent to the AI Coach as text (2026-11-26). Before this the coach was sent a
 * single duration-weighted average and told it was "the number on the
 * athlete's screen". It was not on the screen, and for sessions whose parts
 * have different paces (base and flux, rising rounds, flux stages) it was not
 * even the average of what was shown, so the coach gave pacing that
 * contradicted the screen.
 *
 * Pure: the page passes in the helpers it already uses, so the numbers here
 * are the page's own numbers.
 */

/** The block settings this file reads (a subset of the page's BlockParams). */
export interface BreakdownParams {
  rounds?: number | number[] | string;
  paceRange?: number[] | string;
  workDuration?: number | number[] | string;
  restDuration?: number | number[] | string;
  workProgression?: string;
  burstTiming?: string;
  burstDuration?: number;
  baseDuration?: number | number[];
  fluxDuration?: number | number[];
  fluxPaceRange?: number[];
  workDurationOptions?: number[];
  restDurationOptions?: number[];
  workDurationIncrement?: number;
  restDurationIncrement?: number;
  paceProgression?: string;
  paceIncrement?: number;
  fluxIncrement?: number;
  fluxStartIntensity?: number;
}

export interface BreakdownRow {
  key: string;
  kind: 'work' | 'rest';
  /** Colouring only. */
  variant?: 'flux' | 'burst';
  /** As shown in the label column: WORK, FLUX, BASE, BURST, R1…, REST. */
  label: string;
  durationSeconds: number;
  /** The computed target for this part (total output, or the rate for watts);
   *  null when the screen shows `text` instead. */
  goal: number | null;
  /** What the screen shows when there is no computed target: "Max Effort",
   *  a percentage of baseline, or "—". Null on rest rows. */
  text: string | null;
  /** Rows of one round share a group (the page wraps them together). */
  group?: number;
}

export interface BreakdownBlock {
  blockIdx: number;
  /** The pace badge beside "Block N" ("MAX", "85%", "80–90%"), or "". */
  pace: string;
  rows: BreakdownRow[];
}

export interface BreakdownHelpers<P extends BreakdownParams> {
  resolveNum: (v: number | number[] | string | undefined, fallback?: number) => number;
  resolveRest: (rest: number | number[] | string | undefined, workDur: number) => number;
  parseBurstTiming: (timing: string) => number;
  formatPace: (pace: number[] | string | undefined) => string;
  /** The page's own per-part goal (curve snapshot, or the baseline maths). */
  goalFor: (bp: P, segDuration: number, label: string, blockIdx: number, ordinal: number, roundPaceOverride?: number) => number | null;
  /** Flux Stages: the stepped flux goal (curve snapshot when there is one). */
  fluxStageGoal: (blockIdx: number, ordinal: number, segDuration: number, fluxIntensity: number) => number | null;
}

export function buildBreakdown<P extends BreakdownParams>(
  blocks: Array<{ index: number; bp: P }>,
  h: BreakdownHelpers<P>,
): BreakdownBlock[] {
  return blocks.map(({ index: blockIdx, bp }) => {
    const rounds = h.resolveNum(bp.rounds, 1);
    const workDur = h.resolveNum(bp.workDuration, 0) || (bp.workDurationOptions?.[0] ?? 0);
    const restDur = h.resolveRest(bp.restDuration, workDur) || (bp.restDurationOptions?.[0] ?? 0);
    const pace = h.formatPace(bp.paceRange);
    const rows: BreakdownRow[] = [];
    const rest = (key: string, seconds: number, group?: number): BreakdownRow =>
      ({ key, kind: 'rest', label: 'REST', durationSeconds: seconds, goal: null, text: null, ...(group != null ? { group } : {}) });

    if (bp.workProgression === 'alternating_paces' && bp.baseDuration && bp.fluxDuration) {
      // Flux: alternating WORK and FLUX parts.
      const baseDur = h.resolveNum(bp.baseDuration, 300);
      const fluxDur = h.resolveNum(bp.fluxDuration, 60);
      let remaining = workDur;
      let segIdx = 0;
      while (remaining > 0) {
        const bSeg = Math.min(baseDur, remaining);
        rows.push({ key: `b-${segIdx}`, kind: 'work', label: 'WORK', durationSeconds: bSeg, goal: h.goalFor(bp, bSeg, 'Base', blockIdx, segIdx), text: pace || '—' });
        remaining -= bSeg;
        if (remaining <= 0) break;
        const fSeg = Math.min(fluxDur, remaining);
        rows.push({ key: `f-${segIdx}`, kind: 'work', variant: 'flux', label: 'FLUX', durationSeconds: fSeg, goal: h.goalFor(bp, fSeg, 'Flux', blockIdx, segIdx), text: h.formatPace(bp.fluxPaceRange ?? bp.paceRange) || '—' });
        remaining -= fSeg;
        segIdx++;
      }
      if (restDur > 0) rows.push(rest('rest', restDur));
    } else if (bp.workProgression === 'continuous_with_bursts' && bp.burstTiming && bp.burstDuration) {
      // Polarized: BASE parts with max-effort BURSTs.
      const burstInterval = h.parseBurstTiming(bp.burstTiming);
      const burstDur = bp.burstDuration;
      let remaining = workDur;
      let segIdx = 0;
      while (remaining > 0) {
        const baseSeg = Math.min(burstInterval, remaining);
        rows.push({ key: `base-${segIdx}`, kind: 'work', label: 'BASE', durationSeconds: baseSeg, goal: h.goalFor(bp, baseSeg, 'Base', blockIdx, segIdx), text: pace || '—' });
        remaining -= baseSeg;
        if (remaining <= 0) break;
        const bSeg = Math.min(burstDur, remaining);
        rows.push({ key: `burst-${segIdx}`, kind: 'work', variant: 'burst', label: 'BURST', durationSeconds: bSeg, goal: null, text: 'Max Effort' });
        remaining -= bSeg;
        segIdx++;
      }
      if (restDur > 0) rows.push(rest('rest', restDur));
    } else if (bp.workProgression === 'progressive_flux_intensity' && bp.baseDuration && bp.fluxDuration) {
      // Flux Stages: each FLUX part steps up in intensity.
      const baseDur = h.resolveNum(bp.baseDuration, 300);
      const fluxDur = h.resolveNum(bp.fluxDuration, 60);
      const startIntensity = bp.fluxStartIntensity ?? 0.75;
      const increment = bp.fluxIncrement ?? 0.05;
      let remaining = workDur;
      let segIdx = 0;
      while (remaining > 0) {
        const bSeg = Math.min(baseDur, remaining);
        rows.push({ key: `b-${segIdx}`, kind: 'work', label: 'WORK', durationSeconds: bSeg, goal: h.goalFor(bp, bSeg, 'Base', blockIdx, segIdx), text: pace || '—' });
        remaining -= bSeg;
        if (remaining <= 0) break;
        const fSeg = Math.min(fluxDur, remaining);
        const fluxIntensity = startIntensity + segIdx * increment;
        rows.push({ key: `f-${segIdx}`, kind: 'work', variant: 'flux', label: 'FLUX', durationSeconds: fSeg, goal: h.fluxStageGoal(blockIdx, segIdx, fSeg, fluxIntensity), text: `${Math.round(fluxIntensity * 100)}%` });
        remaining -= fSeg;
        segIdx++;
      }
    } else if (bp.workProgression === 'continuous' && bp.paceProgression !== 'increasing') {
      // Continuous: one unbroken work part.
      const totalDur = workDur * rounds;
      const isMax = bp.paceRange === 'max_effort';
      const goal = h.goalFor(bp, totalDur, 'Work', blockIdx, 0);
      rows.push({ key: 'work', kind: 'work', label: 'WORK', durationSeconds: totalDur, goal: isMax ? null : goal, text: isMax ? 'Max Effort' : (pace || '—') });
    } else {
      // Intervals: one row per round, rest between rounds.
      const workInc = bp.workDurationIncrement ?? 0;
      const restInc = bp.restDurationIncrement ?? 0;
      const isMax = bp.paceRange === 'max_effort';
      for (let r = 0; r < rounds; r++) {
        const roundWorkDur = Math.max(0, workDur + r * workInc);
        const roundRestDur = Math.max(0, restDur + r * restInc);
        const effectivePaceInc = bp.paceIncrement
          ?? (bp.paceProgression === 'increasing' && Array.isArray(bp.paceRange) && rounds > 1
            ? (bp.paceRange[1] - bp.paceRange[0]) / (rounds - 1)
            : undefined);
        const roundPace = bp.paceProgression === 'increasing' && Array.isArray(bp.paceRange) && effectivePaceInc
          ? bp.paceRange[0] + r * effectivePaceInc
          : undefined;
        const goal = h.goalFor(bp, roundWorkDur, 'Work', blockIdx, r, roundPace);
        rows.push({ key: `r-${r}`, kind: 'work', label: `R${r + 1}`, durationSeconds: roundWorkDur, goal: isMax ? null : goal, text: isMax ? 'Max Effort' : (pace || '—'), group: r });
        if (roundRestDur > 0 && r < rounds - 1) rows.push(rest(`rest-${r}`, roundRestDur, r));
      }
    }
    return { blockIdx, pace, rows };
  });
}

/**
 * The same rows as text for the AI Coach, one line per part, in screen order.
 * `goalText` is the page's own formatter for a computed target (the string in
 * the row's goal column), so the wording matches the screen character for
 * character. Rest rows are included so the coach sees the work-to-rest shape.
 */
export function breakdownLines(
  breakdown: BreakdownBlock[],
  f: { formatDuration: (seconds: number) => string; goalText: (goal: number, durationSeconds: number) => string; blockRestSeconds?: number | null },
): string[] {
  const lines: string[] = [];
  const many = breakdown.length > 1;
  breakdown.forEach((block, i) => {
    for (const row of block.rows) {
      const where = many ? `Block ${block.blockIdx + 1} ` : '';
      if (row.kind === 'rest') {
        lines.push(`${where}REST ${f.formatDuration(row.durationSeconds)}`);
      } else {
        const target = row.goal != null ? f.goalText(row.goal, row.durationSeconds) : (row.text ?? '—');
        lines.push(`${where}${row.label} ${f.formatDuration(row.durationSeconds)}: ${target}`);
      }
    }
    if (f.blockRestSeconds && i < breakdown.length - 1) lines.push(`BLOCK REST ${f.formatDuration(f.blockRestSeconds)}`);
  });
  return lines;
}
