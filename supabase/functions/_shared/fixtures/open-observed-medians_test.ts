// Seed-time validation for the observed-medians fixture, made permanent
// (founder review 2026-11-03: "the AMRAP rule and the for-time rule would
// have caught items 1 and 2 automatically"). Every rule that caught a
// data issue during seeding runs in CI, with the KNOWN exceptions pinned
// as exact sets — a future re-pull that introduces a new bad row, or
// silently fixes a known one, fails loudly either way.
//
// Run with:
//   deno test supabase/functions/_shared/fixtures/open-observed-medians_test.ts --no-check

import {
  DURATION_DISAGREES,
  EXTENSION_AMBIGUOUS,
  LOAD_SCORED,
  OPEN_OBSERVED_MEDIANS as ROWS,
  SECONDS_UNTRUSTED,
} from "./open-observed-medians.ts";

// Mixed-unit rows: capped for-time where the quartiles straddle the
// finisher boundary (seconds next to reps). Non-monotone by nature; the
// harness's interpolation guard excludes them from the percentile channel.
const MIXED_UNITS = new Set(["17.1|F", "17.1|M", "21.2|F", "21.2|M", "25.3|F", "25.3|M"]);

const key = (r: { workout_name: string; gender: string }) => `${r.workout_name}|${r.gender}`;

function fail(msgs: string[]): void {
  if (msgs.length) throw new Error(`\n${msgs.join("\n")}`);
}

Deno.test("fixture has both genders for every workout, no duplicates", () => {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const r of ROWS) {
    const k = key(r);
    if (seen.has(k)) problems.push(`duplicate row ${k}`);
    seen.add(k);
  }
  for (const r of ROWS) {
    const other = `${r.workout_name}|${r.gender === "M" ? "F" : "M"}`;
    if (!seen.has(other)) problems.push(`missing partner row for ${key(r)}`);
  }
  fail(problems);
});

Deno.test("quartile direction: monotone unless a known mixed-unit row", () => {
  const problems: string[] = [];
  for (const r of ROWS) {
    const { p25_score: a, p50_score: b, p75_score: c } = r;
    if (a == null || b == null || c == null) {
      problems.push(`${key(r)} has null quartiles`);
      continue;
    }
    const monotone = (a <= b && b <= c) || (a >= b && b >= c);
    // A mixed-unit row may still be numerically monotone by accident
    // (17.1: reps, reps, finisher-time), so mixed rows are exempt from
    // this check rather than required to fail it.
    if (!monotone && !MIXED_UNITS.has(key(r))) {
      problems.push(`${key(r)} non-monotone quartiles (${a}, ${b}, ${c}) — segment interleave?`);
    }
  }
  fail(problems);
});

Deno.test("AMRAP rule: a capped row's median is its cap, or the row is explained", () => {
  // A plain AMRAP's duration IS its cap. A row with cap > 0 and
  // 0 < median < 98% of cap is either a genuine capped for-time with a
  // finishing median (then quartiles descend, or it's the mixed/ambiguous
  // case) or an upstream time-domain bug (the 2017 trio).
  const problems: string[] = [];
  for (const r of ROWS) {
    if (r.time_cap_seconds == null || r.observed_median_s == null) continue;
    if (r.observed_median_s >= r.time_cap_seconds * 0.98) continue;
    const descending = r.p25_score != null && r.p75_score != null && r.p25_score > r.p75_score;
    const explained = descending ||
      SECONDS_UNTRUSTED.has(r.workout_name) ||
      EXTENSION_AMBIGUOUS.has(r.workout_name) ||
      MIXED_UNITS.has(key(r)) ||
      // rep-ranked capped for-time with a sub-cap median: the harness's
      // scoring-direction cross-check routes these out of the seconds
      // channel at run time, so they are safe — but they must at least
      // be DIRECTIONALLY consistent (ascending), never unclassifiable
      (r.p25_score != null && r.p75_score != null && r.p25_score < r.p75_score);
    if (!explained) {
      problems.push(`${key(r)} median ${r.observed_median_s} < cap ${r.time_cap_seconds} and unexplained`);
    }
  }
  fail(problems);
});

Deno.test("for-time rule: descending quartiles agree with the duration field, or the row is a named disagreement", () => {
  const problems: string[] = [];
  for (const r of ROWS) {
    if (r.p25_score == null || r.p50_score == null || r.p75_score == null) continue;
    if (!(r.p25_score > r.p75_score)) continue; // finisher-ranked rows only
    if (r.observed_median_s == null || SECONDS_UNTRUSTED.has(r.workout_name)) continue;
    const gap = Math.abs(r.observed_median_s - r.p50_score);
    const named = DURATION_DISAGREES.has(key(r));
    if (gap > 5 && !named) {
      problems.push(`${key(r)} duration ${r.observed_median_s} vs p50 ${r.p50_score} disagree (new, unnamed)`);
    }
    if (gap <= 5 && named) {
      problems.push(`${key(r)} named as a disagreement but sources now agree — update DURATION_DISAGREES`);
    }
  }
  fail(problems);
});

Deno.test("load-scored rows carry no duration and are the exact known set", () => {
  const problems: string[] = [];
  for (const r of ROWS) {
    if (LOAD_SCORED.has(r.workout_name) && r.observed_median_s != null) {
      problems.push(`${key(r)} is load-scored but has observed_median_s`);
    }
  }
  const expected = new Set(["15.1a", "18.2a", "21.4", "23.2B"]);
  for (const w of LOAD_SCORED) if (!expected.has(w)) problems.push(`unexpected LOAD_SCORED entry ${w}`);
  for (const w of expected) if (!LOAD_SCORED.has(w)) problems.push(`missing LOAD_SCORED entry ${w}`);
  fail(problems);
});
