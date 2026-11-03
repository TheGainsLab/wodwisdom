/**
 * Golden parity test, z-space: the REAL open_rx_elite_v2_z parameters,
 * frozen elite evidence sets, frozen outputs from the numpy reference of
 * the joint fit (scratchpad, 2026-11-03). Evidence percentiles are stored
 * AS Z VALUES (pre-transformed by the reference's probit), so this test
 * pins the fit's linear algebra on the z ruler without depending on the
 * TypeScript probit approximation. Tolerance 1e-4.
 *
 * Run with:
 *   deno test supabase/functions/_shared/signature-profile-fit_golden_z_test.ts --no-check
 */

import { assertAlmostEquals } from "jsr:@std/assert";
import { fitProfile, normInv, normCdf, probitFromPct, pctFromZ } from "./signature-profile-fit.ts";
import { OPEN_RX_ELITE_V2_Z } from "./fixtures/open-rx-elite-v2-z-params.ts";

const GOLD = {
  "elite_three": {
    "level_mean": 1.610703,
    "level_sd": 0.190719,
    "axes_mean": {
      "aerobic_capacity": -0.278411,
      "anaerobic_capacity": 0.035706,
      "gymnastics_pressing": 0.126351,
      "gymnastics_pulling": 0.598846,
      "midline": 0.02236,
      "mixed_modal_conditioning": 0.057606,
      "olympic_lifting": -0.179053,
      "posterior_chain": -0.042396,
      "powerlifting_strength": -0.242183,
      "skill_coordination": 0.002037,
      "squat_cycling": -0.141303,
      "upper_body_pressing": -0.147976
    },
    "axes_sd": {
      "aerobic_capacity": 0.522769,
      "anaerobic_capacity": 0.373083,
      "gymnastics_pressing": 0.570232,
      "gymnastics_pulling": 0.461146,
      "midline": 0.206921,
      "mixed_modal_conditioning": 0.191381,
      "olympic_lifting": 0.404209,
      "posterior_chain": 0.288112,
      "powerlifting_strength": 0.415003,
      "skill_coordination": 0.490861,
      "squat_cycling": 0.333222,
      "upper_body_pressing": 0.211028
    }
  },
  "elite_pulling_hole": {
    "level_mean": 1.479642,
    "level_sd": 0.199923,
    "axes_mean": {
      "aerobic_capacity": 0.682904,
      "anaerobic_capacity": 0.136901,
      "gymnastics_pressing": -0.145154,
      "gymnastics_pulling": -0.727994,
      "midline": 0.030717,
      "mixed_modal_conditioning": 0.066821,
      "olympic_lifting": 0.0367,
      "posterior_chain": 0.081195,
      "powerlifting_strength": 0.018639,
      "skill_coordination": -0.135655,
      "squat_cycling": 0.03244,
      "upper_body_pressing": 0.076582
    },
    "axes_sd": {
      "aerobic_capacity": 0.397811,
      "anaerobic_capacity": 0.349898,
      "gymnastics_pressing": 0.565349,
      "gymnastics_pulling": 0.390107,
      "midline": 0.19021,
      "mixed_modal_conditioning": 0.18639,
      "olympic_lifting": 0.400335,
      "posterior_chain": 0.273749,
      "powerlifting_strength": 0.429082,
      "skill_coordination": 0.493896,
      "squat_cycling": 0.328458,
      "upper_body_pressing": 0.216859
    }
  },
  "elite_single_wide": {
    "level_mean": 1.16621,
    "level_sd": 0.489703,
    "axes_mean": {
      "aerobic_capacity": 0.095281,
      "anaerobic_capacity": 0.034324,
      "gymnastics_pressing": -0.042921,
      "gymnastics_pulling": -0.124404,
      "midline": -0.012064,
      "mixed_modal_conditioning": 0.009283,
      "olympic_lifting": 0.022677,
      "posterior_chain": 0.056351,
      "powerlifting_strength": 0.034607,
      "skill_coordination": -0.080471,
      "squat_cycling": -0.008823,
      "upper_body_pressing": 0.01379
    },
    "axes_sd": {
      "aerobic_capacity": 0.617495,
      "anaerobic_capacity": 0.39761,
      "gymnastics_pressing": 0.588735,
      "gymnastics_pulling": 0.785271,
      "midline": 0.210565,
      "mixed_modal_conditioning": 0.206308,
      "olympic_lifting": 0.460955,
      "posterior_chain": 0.299726,
      "powerlifting_strength": 0.490087,
      "skill_coordination": 0.498215,
      "squat_cycling": 0.367242,
      "upper_body_pressing": 0.259843
    }
  }
} as Record<string, {
  level_mean: number;
  level_sd: number;
  axes_mean: Record<string, number>;
  axes_sd: Record<string, number>;
}>;

// percentile fields below are Z VALUES (see header)
const SETS = {
  "elite_three": [
    {
      "percentile": 1.750686,
      "discrimination": {
        "gymnastics_pulling": 25,
        "aerobic_capacity": 20,
        "olympic_lifting": 15,
        "posterior_chain": 10,
        "gymnastics_pressing": 10,
        "powerlifting_strength": 10,
        "midline": 5,
        "squat_cycling": 5
      }
    },
    {
      "percentile": 1.475791,
      "discrimination": {
        "posterior_chain": 40,
        "aerobic_capacity": 15,
        "anaerobic_capacity": 20,
        "powerlifting_strength": 15,
        "mixed_modal_conditioning": 10
      }
    },
    {
      "percentile": 2.053749,
      "discrimination": {
        "gymnastics_pulling": 60,
        "anaerobic_capacity": 25,
        "aerobic_capacity": 10,
        "posterior_chain": 5
      }
    }
  ],
  "elite_pulling_hole": [
    {
      "percentile": 1.174987,
      "discrimination": {
        "gymnastics_pulling": 60,
        "anaerobic_capacity": 25,
        "aerobic_capacity": 15
      }
    },
    {
      "percentile": 1.226528,
      "discrimination": {
        "gymnastics_pulling": 55,
        "squat_cycling": 20,
        "aerobic_capacity": 25
      }
    },
    {
      "percentile": 1.340755,
      "discrimination": {
        "gymnastics_pulling": 40,
        "aerobic_capacity": 35,
        "powerlifting_strength": 25
      }
    },
    {
      "percentile": 1.880794,
      "discrimination": {
        "posterior_chain": 40,
        "aerobic_capacity": 35,
        "mixed_modal_conditioning": 25
      }
    },
    {
      "percentile": 2.053749,
      "discrimination": {
        "aerobic_capacity": 55,
        "anaerobic_capacity": 35,
        "midline": 10
      }
    }
  ],
  "elite_single_wide": [
    {
      "percentile": 1.644854,
      "discrimination": {
        "posterior_chain": 40,
        "aerobic_capacity": 15,
        "anaerobic_capacity": 20,
        "powerlifting_strength": 15,
        "mixed_modal_conditioning": 10
      },
      "obsNoiseVar": 0.30303
    }
  ]
} as Record<
  string,
  Array<{ percentile: number; discrimination: Record<string, number>; obsNoiseVar?: number }>
>;

for (const [name, evidence] of Object.entries(SETS)) {
  Deno.test(`golden z: ${name} matches the numpy reference on real params`, () => {
    const p = fitProfile(evidence, OPEN_RX_ELITE_V2_Z);
    const g = GOLD[name];
    assertAlmostEquals(p.level.mean, g.level_mean, 1e-4, "level mean");
    assertAlmostEquals(p.level.sd, g.level_sd, 1e-4, "level sd");
    for (const axis of OPEN_RX_ELITE_V2_Z.axes) {
      assertAlmostEquals(p.axes[axis].mean, g.axes_mean[axis], 1e-4, `${axis} mean`);
      assertAlmostEquals(p.axes[axis].sd, g.axes_sd[axis], 1e-4, `${axis} sd`);
    }
  });
}

Deno.test("golden z: the pulling hole is visible at elite level (the upgrade's point)", () => {
  // p88-91 pulling scores against p97-98 engine scores: on the percentile
  // ruler these sit a handful of points apart; in z the gap is real.
  const p = fitProfile(SETS.elite_pulling_hole, OPEN_RX_ELITE_V2_Z);
  if (!(p.axes.gymnastics_pulling.mean < -0.4)) {
    throw new Error(`pulling delta should be clearly negative in z, got ${p.axes.gymnastics_pulling.mean}`);
  }
  if (p.limiterRanked[0] !== "gymnastics_pulling") {
    throw new Error(`limiter should be pulling, got ${p.limiterRanked[0]}`);
  }
});

Deno.test("scale conversion: probit/CDF round-trip and reference points", () => {
  // reference values from Python statistics.NormalDist()
  assertAlmostEquals(normInv(0.85), 1.0364333894937898, 1e-7);
  assertAlmostEquals(normInv(0.9985), 2.967737925342534, 1e-6);
  assertAlmostEquals(normCdf(1.0364333894937898), 0.85, 1e-7);
  for (const pct of [3, 15, 50, 85, 93, 99, 99.9]) {
    assertAlmostEquals(pctFromZ(probitFromPct(pct)), Math.min(pct, 99.85), 1e-4, `round trip p${pct}`);
  }
  // the clip floor/ceiling (0.15 / 99.85) — outside, the transform saturates
  assertAlmostEquals(probitFromPct(0), normInv(0.0015), 1e-9);
  assertAlmostEquals(probitFromPct(100), normInv(0.9985), 1e-9);
});
