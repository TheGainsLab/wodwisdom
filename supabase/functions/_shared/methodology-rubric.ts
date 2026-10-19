/**
 * methodology-rubric.ts — turns the analyzer's raw stats into the
 * Methodology Adherence Score's dimension scores.
 *
 * Phase 1 scores the FOUR COMPUTED dimensions only (judged dimensions
 * ship later, labeled beta):
 *   1. Time-domain variance  — distribution of metcons across short/medium/long
 *   2. Modal balance         — share of W / G / M movement slots
 *   3. Movement coverage     — essential movements programmed vs. the canon
 *   4. Recovery distribution — same movements on consecutive days
 *
 * LAWS (from the design doc):
 * - A dimension the window can't support is EXCLUDED from the overall
 *   score and labeled with its reason — never guessed, never "neutral".
 * - Every score must be traceable: evidence lines quote the stats that
 *   produced it.
 * - Nothing here, and nothing a caller surfaces to a user, may contain
 *   the word "CrossFit" — the product awards a methodology adherence
 *   score with no vendor name attached.
 *
 * ALL NUMERIC CONSTANTS ARE PROVISIONAL pending the founder's editorial
 * pass on the rubric definitions. They are gathered in RUBRIC so that
 * pass is a one-block edit.
 */

import type { AnalysisOutput } from "./analyzer.ts";

/** Provisional rubric constants — the founder's editorial pass edits HERE. */
export const RUBRIC = {
  /** Weeks of programming needed before movement coverage is scoreable. */
  coverageMinWeeks: 4,
  /** Consecutive days needed before recovery distribution is scoreable. */
  recoveryMinDays: 2,
  /** Points deducted per consecutive-day movement overlap. */
  overlapPenalty: 18,
  /** A modality below this share of movement slots is flagged as light. */
  modalityFloor: 0.2,
  /** Time-domain score blend: presence of each domain vs. evenness of spread. */
  tdPresenceWeight: 0.4,
  tdSpreadWeight: 0.6,
} as const;

export interface DimensionScore {
  key: "time_domain_variance" | "modal_balance" | "movement_coverage" | "recovery_distribution";
  label: string;
  /** 0–100, or null when excluded. */
  score: number | null;
  /** Present exactly when score is null. */
  excluded_reason?: string;
  /** One-paragraph plain-language reading of the score. */
  verdict: string;
  /** The stats the score is computed from, as printable lines. */
  evidence: string[];
}

export interface RubricResult {
  /** Mean of the scored dimensions; null when nothing was scoreable. */
  overall: number | null;
  scored_dimensions: number;
  total_dimensions: number;
  dimensions: DimensionScore[];
  /** Actionable, deterministic findings derived from the low stats. */
  findings: string[];
  window: { days: number; weeks: number };
}

/** Normalized Shannon entropy of a distribution: 1 = even, 0 = one bucket. */
function evenness(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const nonZero = counts.filter((c) => c > 0);
  if (total === 0 || counts.length < 2) return 0;
  if (nonZero.length === 1) return 0;
  let h = 0;
  for (const c of nonZero) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(counts.length);
}

const pct = (n: number, total: number) => total > 0 ? Math.round((n / total) * 100) : 0;

export function scoreMethodology(
  analysis: AnalysisOutput,
  window: { days: number; weeks: number },
  essentialTotal: number,
): RubricResult {
  const dimensions: DimensionScore[] = [];
  const findings: string[] = [];

  // ── 1. Time-domain variance (metcons only) ─────────────────────────────
  {
    const td = analysis.time_domains;
    const counts = [td.short ?? 0, td.medium ?? 0, td.long ?? 0];
    const total = counts.reduce((a, b) => a + b, 0);
    const evidence = [
      `Short (<8 min): ${counts[0]} · Medium (8–15): ${counts[1]} · Long (>15): ${counts[2]} — of ${total} scored metcons.`,
    ];
    if (total === 0) {
      dimensions.push({
        key: "time_domain_variance", label: "Time-domain variance", score: null,
        excluded_reason: "No metcons with a readable time domain in this window.",
        verdict: "Nothing to score: the window has no metcons whose duration could be read or estimated.",
        evidence,
      });
    } else {
      const present = counts.filter((c) => c > 0).length;
      const score = Math.round(100 * (
        RUBRIC.tdPresenceWeight * (present / 3) +
        RUBRIC.tdSpreadWeight * evenness(counts)
      ));
      const missing = (["short", "medium", "long"] as const).filter((k) => (td[k] ?? 0) === 0);
      const verdict = missing.length === 0
        ? `All three time domains are programmed across ${total} metcons.`
        : `${total} metcon${total === 1 ? "" : "s"}, ${missing.length === 2 ? "all in one band" : "uneven spread"}: no ${missing.join(" or ")} work in this window. The methodology expects exposure across all three domains.`;
      dimensions.push({ key: "time_domain_variance", label: "Time-domain variance", score, verdict, evidence });
      if (missing.includes("long")) findings.push("Add at least one piece over 15 minutes — the window has no long time-domain work.");
      if (missing.includes("short")) findings.push("Add at least one short piece (under 8 minutes) — no short time-domain work in the window.");
    }
  }

  // ── 2. Modal balance ───────────────────────────────────────────────────
  {
    const mb = analysis.modal_balance;
    const w = mb.Weightlifting ?? 0, g = mb.Gymnastics ?? 0, m = mb.Monostructural ?? 0;
    const total = w + g + m;
    const evidence = [
      `Weightlifting ${pct(w, total)}% · Gymnastics ${pct(g, total)}% · Monostructural ${pct(m, total)}% — of ${total} movement slots.`,
    ];
    if (total === 0) {
      dimensions.push({
        key: "modal_balance", label: "Modal balance", score: null,
        excluded_reason: "No recognized movements in this window.",
        verdict: "Nothing to score: no movements could be matched to a modality.",
        evidence,
      });
    } else {
      const score = Math.round(100 * evenness([w, g, m]));
      const light = ([["weightlifting", w], ["gymnastics", g], ["monostructural", m]] as const)
        .filter(([, c]) => c / total < RUBRIC.modalityFloor);
      const verdict = light.length === 0
        ? "All three modalities carry a meaningful share of the work."
        : `${light.map(([n]) => n).join(" and ")} ${light.length === 1 ? "is" : "are"} under ${Math.round(RUBRIC.modalityFloor * 100)}% of movement slots${light.some(([, c]) => c === 0) ? " (absent)" : ""}.`;
      dimensions.push({ key: "modal_balance", label: "Modal balance", score, verdict, evidence });
      for (const [name, c] of light) {
        findings.push(c === 0
          ? `No ${name} work programmed — add it to the window.`
          : `${name[0].toUpperCase()}${name.slice(1)} is light (${pct(c, total)}% of slots) — consider adding a piece.`);
      }
    }
  }

  // ── 3. Movement coverage (needs a long window) ─────────────────────────
  {
    if (window.weeks < RUBRIC.coverageMinWeeks) {
      dimensions.push({
        key: "movement_coverage", label: "Movement coverage", score: null,
        excluded_reason: `Window too short — coverage needs ${RUBRIC.coverageMinWeeks}+ weeks of programming.`,
        verdict: `${window.weeks} week${window.weeks === 1 ? "" : "s"} can't show coverage. This dimension is excluded from the score — it never counts against the program.`,
        evidence: [`Window: ${window.days} days across ${window.weeks} week${window.weeks === 1 ? "" : "s"}.`],
      });
    } else {
      const missing = Object.values(analysis.not_programmed).reduce((s, arr) => s + arr.length, 0);
      const covered = Math.max(0, essentialTotal - missing);
      const score = essentialTotal > 0 ? Math.round(100 * (covered / essentialTotal)) : null;
      dimensions.push({
        key: "movement_coverage", label: "Movement coverage",
        score,
        ...(score === null ? { excluded_reason: "No essential-movement canon available to score against." } : {}),
        verdict: score === null
          ? "The movement canon is empty — nothing to measure coverage against."
          : `${covered} of ${essentialTotal} essential movements appear in the window; ${missing} missing.`,
        evidence: Object.entries(analysis.not_programmed)
          .filter(([, arr]) => arr.length > 0)
          .map(([cat, arr]) => `Missing ${cat}: ${arr.join(", ")}`),
      });
    }
  }

  // ── 4. Recovery distribution ───────────────────────────────────────────
  {
    const overlaps = analysis.consecutive_overlaps;
    if (window.days < RUBRIC.recoveryMinDays) {
      dimensions.push({
        key: "recovery_distribution", label: "Recovery distribution", score: null,
        excluded_reason: `Window too short — recovery needs ${RUBRIC.recoveryMinDays}+ training days.`,
        verdict: "A single training day can't show recovery spacing.",
        evidence: [`Window: ${window.days} day${window.days === 1 ? "" : "s"}.`],
      });
    } else {
      const score = Math.max(0, 100 - RUBRIC.overlapPenalty * overlaps.length);
      const verdict = overlaps.length === 0
        ? "No movement repeats on consecutive days."
        : `${overlaps.length} consecutive-day repeat${overlaps.length === 1 ? "" : "s"}: ${overlaps.map((o) => `${o.movements.join(", ")} (${o.days})`).join("; ")}.`;
      dimensions.push({
        key: "recovery_distribution", label: "Recovery distribution", score, verdict,
        evidence: overlaps.map((o) => `${o.days}: ${o.movements.join(", ")}`),
      });
      for (const o of overlaps) {
        findings.push(`Break up the ${o.movements.join("/")} repeat on ${o.days} — swap one piece or re-order the days.`);
      }
    }
  }

  const scored = dimensions.filter((d) => d.score !== null) as (DimensionScore & { score: number })[];
  const overall = scored.length > 0
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : null;

  return {
    overall,
    scored_dimensions: scored.length,
    total_dimensions: dimensions.length,
    dimensions,
    findings,
    window,
  };
}
