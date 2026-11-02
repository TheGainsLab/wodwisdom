/**
 * Golden parity test: the REAL open_rx_general_v1 parameters, frozen
 * evidence sets, frozen outputs from the numpy reference implementation
 * of the joint fit (scratchpad, 2026-11-02). If a params reseed, an
 * invSPD refactor, or a fit change moves these numbers, this fails —
 * loudly, which is the point. Tolerance 1e-4 (reference printed at 6dp).
 *
 * Run with:
 *   deno test supabase/functions/_shared/signature-profile-fit_golden_test.ts --no-check
 */

import { assertAlmostEquals } from "jsr:@std/assert";
import { fitProfile } from "./signature-profile-fit.ts";
import { OPEN_RX_GENERAL_V1 } from "./fixtures/open-rx-general-v1-params.ts";

const GOLD = {
  "parity3": {
    "level_mean": 68.359263,
    "level_sd": 5.907336,
    "axes_mean": {
      "aerobic_capacity": -3.196597,
      "anaerobic_capacity": -1.002608,
      "gymnastics_pressing": 0.578698,
      "gymnastics_pulling": 5.876738,
      "midline": 0.301643,
      "mixed_modal_conditioning": -0.582013,
      "olympic_lifting": -0.787688,
      "posterior_chain": -1.166298,
      "powerlifting_strength": -1.280063,
      "skill_coordination": 0.90813,
      "squat_cycling": -0.532014,
      "upper_body_pressing": -0.595538
    },
    "axes_sd": {
      "aerobic_capacity": 8.281057,
      "anaerobic_capacity": 4.369108,
      "gymnastics_pressing": 7.388135,
      "gymnastics_pulling": 10.78962,
      "midline": 2.556233,
      "mixed_modal_conditioning": 2.926016,
      "olympic_lifting": 6.689584,
      "posterior_chain": 3.521686,
      "powerlifting_strength": 7.560725,
      "skill_coordination": 5.847858,
      "squat_cycling": 3.627417,
      "upper_body_pressing": 2.896483
    }
  },
  "unbalanced_puller_weak": {
    "level_mean": 49.216658,
    "level_sd": 4.95038,
    "axes_mean": {
      "aerobic_capacity": 9.017565,
      "anaerobic_capacity": 2.222929,
      "gymnastics_pressing": -1.236689,
      "gymnastics_pulling": -15.535429,
      "midline": -0.709376,
      "mixed_modal_conditioning": 1.46513,
      "olympic_lifting": 2.259319,
      "posterior_chain": 2.675625,
      "powerlifting_strength": 2.961276,
      "skill_coordination": -1.870212,
      "squat_cycling": 1.516835,
      "upper_body_pressing": 1.54093
    },
    "axes_sd": {
      "aerobic_capacity": 7.248002,
      "anaerobic_capacity": 4.183051,
      "gymnastics_pressing": 7.364084,
      "gymnastics_pulling": 9.407081,
      "midline": 2.547258,
      "mixed_modal_conditioning": 2.833437,
      "olympic_lifting": 6.704013,
      "posterior_chain": 3.400938,
      "powerlifting_strength": 7.59558,
      "skill_coordination": 5.799932,
      "squat_cycling": 3.587921,
      "upper_body_pressing": 2.862028
    }
  },
  "single_wide": {
    "level_mean": 62.079198,
    "level_sd": 15.732929,
    "axes_mean": {
      "aerobic_capacity": 0.417376,
      "anaerobic_capacity": 0.123568,
      "gymnastics_pressing": -0.12261,
      "gymnastics_pulling": -0.622064,
      "midline": -0.035295,
      "mixed_modal_conditioning": 0.075829,
      "olympic_lifting": 0.129443,
      "posterior_chain": 0.182429,
      "powerlifting_strength": 0.148274,
      "skill_coordination": -0.178362,
      "squat_cycling": 0.046233,
      "upper_body_pressing": 0.061778
    },
    "axes_sd": {
      "aerobic_capacity": 8.812963,
      "anaerobic_capacity": 4.399943,
      "gymnastics_pressing": 7.4187,
      "gymnastics_pulling": 12.969691,
      "midline": 2.593989,
      "mixed_modal_conditioning": 2.94841,
      "olympic_lifting": 6.991971,
      "posterior_chain": 3.726647,
      "powerlifting_strength": 8.042706,
      "skill_coordination": 5.894633,
      "squat_cycling": 3.705465,
      "upper_body_pressing": 3.011499
    }
  }
} as Record<string, {
  level_mean: number;
  level_sd: number;
  axes_mean: Record<string, number>;
  axes_sd: Record<string, number>;
}>;

const SETS: Record<string, Array<{ percentile: number; discrimination: Record<string, number>; obsNoiseVar?: number }>> = {
  parity3: [
    { percentile: 84, discrimination: { gymnastics_pulling: 25, aerobic_capacity: 20, olympic_lifting: 15, posterior_chain: 10, gymnastics_pressing: 10, powerlifting_strength: 10, midline: 5, squat_cycling: 5 } },
    { percentile: 55, discrimination: { posterior_chain: 40, aerobic_capacity: 15, anaerobic_capacity: 20, powerlifting_strength: 15, mixed_modal_conditioning: 10 } },
    { percentile: 71, discrimination: { gymnastics_pulling: 60, anaerobic_capacity: 25, aerobic_capacity: 10, posterior_chain: 5 } },
  ],
  unbalanced_puller_weak: [
    { percentile: 38, discrimination: { gymnastics_pulling: 60, anaerobic_capacity: 25, aerobic_capacity: 15 } },
    { percentile: 40, discrimination: { gymnastics_pulling: 55, squat_cycling: 20, aerobic_capacity: 25 } },
    { percentile: 42, discrimination: { gymnastics_pulling: 40, aerobic_capacity: 35, powerlifting_strength: 25 } },
    { percentile: 41, discrimination: { gymnastics_pulling: 50, midline: 15, aerobic_capacity: 35 } },
    { percentile: 61, discrimination: { posterior_chain: 40, aerobic_capacity: 35, mixed_modal_conditioning: 25 } },
    { percentile: 63, discrimination: { aerobic_capacity: 55, anaerobic_capacity: 35, midline: 10 } },
  ],
  single_wide: [
    { percentile: 70, discrimination: { posterior_chain: 40, aerobic_capacity: 15, anaerobic_capacity: 20, powerlifting_strength: 15, mixed_modal_conditioning: 10 }, obsNoiseVar: 400 },
  ],
};

for (const [name, evidence] of Object.entries(SETS)) {
  Deno.test(`golden: ${name} matches the numpy reference on real params`, () => {
    const p = fitProfile(evidence, OPEN_RX_GENERAL_V1);
    const g = GOLD[name];
    assertAlmostEquals(p.level.mean, g.level_mean, 1e-4, "level mean");
    assertAlmostEquals(p.level.sd, g.level_sd, 1e-4, "level sd");
    for (const axis of OPEN_RX_GENERAL_V1.axes) {
      assertAlmostEquals(p.axes[axis].mean, g.axes_mean[axis], 1e-4, `${axis} mean`);
      assertAlmostEquals(p.axes[axis].sd, g.axes_sd[axis], 1e-4, `${axis} sd`);
    }
  });
}

Deno.test("golden: the unbalanced-menu diagnosis is the joint fit's (review item 1)", () => {
  const p = fitProfile(SETS.unbalanced_puller_weak, OPEN_RX_GENERAL_V1);
  // the two-stage fit read this athlete as "balanced, just unfit";
  // the joint fit must put the weakness on the pulling dial
  if (!(p.axes.gymnastics_pulling.mean < -10)) {
    throw new Error(`pulling delta should be strongly negative, got ${p.axes.gymnastics_pulling.mean}`);
  }
  if (!(p.limiterRanked[0] === "gymnastics_pulling")) {
    throw new Error(`limiter should be pulling, got ${p.limiterRanked[0]}`);
  }
});
