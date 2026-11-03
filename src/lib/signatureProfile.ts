/**
 * signatureProfile — the athlete-facing read of a fitted capability profile.
 *
 * This module is the NARRATOR of the Workout Signatures athlete layer, and
 * it enforces the story-layer spec (design doc, 2026-11-02) by construction:
 *
 *  - NARRATOR BARRIER: every function here consumes the structured profile
 *    only (level, dials+sds, limiter posterior, gates, n, cohort). Raw
 *    scores and workouts are not in the input types, so no sentence can
 *    claim a finding the fit didn't make.
 *  - TWO-CARD RULE: an axis earns "limiter" only when its probability comes
 *    from a NEGATIVE MEAN (evidence of weakness). An axis whose limiter
 *    probability comes from posterior width alone is an UNKNOWN — routed to
 *    the assessment card, never described as a weakness.
 *  - TWO-LENS RULE: every dial renders both absolute ("top X% worldwide")
 *    and relative-to-self ("below your own line"). Copy never says "weak"
 *    for a relative deficit.
 *  - TEMPLATED STORY: sentences are assembled from a fixed set of fragments
 *    keyed to the profile's shape. scripts/verify-signature-story.ts runs
 *    the whole synthetic population through this module and asserts the
 *    copy rules; free-form generation, if it ever comes, sits behind these
 *    templates as a guardrail.
 */

// ---------------------------------------------------------------- types

export interface AxisPosterior {
  mean: number; // deviation from own level, percentile points (RELATIVE)
  sd: number;
  /** the prior sd THIS fit shrank from (written by the refit from the
   *  live params row — the single source; absent only on rows persisted
   *  before the column existed, in which case nothing classifies) */
  priorSd?: number;
  /** z-native dial (standard-normal units), present only on elite-cohort
   *  fits (open_rx_elite_v2_z) — the un-compressed ruler the fit ran on */
  meanZ?: number;
  sdZ?: number;
}

export interface FittedProfileView {
  level: { mean: number; sd: number };
  axes: Record<string, AxisPosterior>;
  /** P(axis is limiter), from the fit's posterior draws */
  limiterPosterior: Record<string, number>;
  nEvidence: number;
  cohort: string; // e.g. 'open_rx_general'
  /** gate switches when known: movement -> 'has' | 'lacks' | 'unknown' */
  gates?: Record<string, 'has' | 'lacks' | 'unknown'>;
}

export interface DialView {
  axis: string;
  label: string;
  definition: string;
  /** relative-to-self, percentile points */
  relative: number;
  sd: number;
  /** relative-to-self in sigma (z) units — elite-cohort fits only */
  relativeZ?: number;
  sdZ?: number;
  /** absolute percentile estimate for this axis (level + delta, clamped) */
  absolute: number;
  /** how settled this dial is: fraction of prior uncertainty resolved */
  resolution: number; // 0 = prior (unknown), 1 = fully pinned
}

export interface LimiterItem {
  axis: string;
  label: string;
  p: number;
}

export interface UnknownItem {
  axis: string;
  label: string;
  /** the kind of workout that would resolve it fastest */
  probe: string;
}

export interface ProfileRead {
  dials: DialView[]; // sorted, most positive first
  limiters: LimiterItem[]; // evidence-backed only, max 2
  unknowns: UnknownItem[]; // width-driven, max 3
  story: string[]; // 2-4 sentences, assembled from fragments
  depthBand: DepthBand;
}

export type DepthBand = 'zero' | 'shallow' | 'mid' | 'deep';

// ------------------------------------------------------- axis constants
// Labels and probes are display vocabulary; definitions mirror
// signature_axes (the DB stays the source of truth where available —
// callers may override via the axisMeta argument).

export const AXIS_META: Record<string, { label: string; definition: string; probe: string }> = {
  olympic_lifting: {
    label: 'Olympic lifting',
    definition: 'Snatch and clean & jerk — speed-strength, receiving positions, barbell cycling',
    probe: 'a heavy snatch or clean & jerk day',
  },
  powerlifting_strength: {
    label: 'Max strength',
    definition: 'Maximal slow lifts — heavy squats, deadlifts, presses near limit loads',
    probe: 'a 1RM squat or deadlift session',
  },
  posterior_chain: {
    label: 'Posterior chain',
    definition: 'Hinge capacity under volume — deadlifts, swings, pulls off the floor',
    probe: 'a high-rep deadlift or swing piece',
  },
  upper_body_pressing: {
    label: 'Upper-body pressing',
    definition: 'Pressing capacity under fatigue — push-ups, presses, jerks, dips',
    probe: 'a push-up or press volume test',
  },
  gymnastics_pulling: {
    label: 'Gymnastics pulling',
    definition: 'Bodyweight pulling — pull-ups, chest-to-bar, toes-to-bar, muscle-ups',
    probe: 'a max set of chest-to-bar or a muscle-up piece',
  },
  gymnastics_pressing: {
    label: 'Inverted pressing',
    definition: 'Inverted gymnastics — HSPU, handstand walks, wall walks',
    probe: 'a handstand push-up or wall-walk test',
  },
  midline: {
    label: 'Midline',
    definition: 'Trunk capacity under fatigue — GHD, L-sits, high-rep core',
    probe: 'a GHD or high-rep core piece',
  },
  skill_coordination: {
    label: 'Skill & coordination',
    definition: 'Rhythm skills — double-unders, pistols, rope climbs',
    probe: 'a max unbroken double-under set',
  },
  squat_cycling: {
    label: 'Squat cycling',
    definition: 'High-rep leg endurance — wall balls, light thrusters, lunge volume',
    probe: 'a big wall-ball or thruster set',
  },
  aerobic_capacity: {
    label: 'Aerobic engine',
    definition: 'Sustained-pace engine — long time domains, pacing, monostructural volume',
    probe: 'a 20-minute steady piece or a 5k',
  },
  anaerobic_capacity: {
    label: 'Anaerobic power',
    definition: 'Repeated high-power surges — sprints, short pain-cave efforts',
    probe: 'a short all-out interval test',
  },
  mixed_modal_conditioning: {
    label: 'Mixed-modal',
    definition: 'Transition economy — chippers, odd objects, grip and posture switching',
    probe: 'a multi-station chipper',
  },
};

/** The prior sd the fit shrank from. null = this row predates the
 *  prior_sd_pct column; we then DECLINE to classify resolution rather
 *  than classify against a client-side copy of model state (one
 *  refresh backfills). */
function priorSdOf(ax: AxisPosterior): number | null {
  return ax.priorSd ?? null;
}

// ------------------------------------------------------ classification

/** Evidence-backed limiter: probability must come from a negative mean,
 *  not from width alone (two-card rule). */
export function evidenceLimiters(p: FittedProfileView, max = 2): LimiterItem[] {
  return Object.entries(p.limiterPosterior)
    .filter(([axis, prob]) => {
      const ax = p.axes[axis];
      if (!ax) return false;
      // Evidence gate is RELATIVE to what the fit knows (review 2026-11-03
      // item 2): a fixed percentile threshold breaks under compression —
      // −2 is enormous at p96 and noise at p50. Require the mean to be
      // half a posterior sd below zero, plus real posterior mass.
      return ax.mean < -0.5 * ax.sd && prob >= 0.12;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([axis, prob]) => ({
      axis,
      label: AXIS_META[axis]?.label ?? axis,
      p: prob,
    }));
}

/** Width-driven unknowns: dials still mostly at the prior. An axis that
 *  already earned "limiter" is excluded — the two-card rule is DISJOINT by
 *  spec (unknowns are width ALONE), and a shallow dial can genuinely pass
 *  both gates: evidence-backed negative mean AND mostly-prior width (the
 *  z-space copy-checker profiles surfaced this, review 2026-11-03; it is
 *  reachable in pct space too). The limiter claim is the stronger one. */
export function unknownDials(p: FittedProfileView, max = 3): UnknownItem[] {
  const limiterAxes = new Set(evidenceLimiters(p).map((l) => l.axis));
  return Object.entries(p.axes)
    .filter(([axis]) => !limiterAxes.has(axis))
    .map(([axis, ax]) => {
      const ps = priorSdOf(ax);
      return { axis, resolution: ps ? 1 - ax.sd / ps : null };
    })
    .filter((d) => d.resolution !== null && d.resolution < 0.35)
    .map((d) => ({ axis: d.axis, resolution: d.resolution as number }))
    .sort((a, b) => a.resolution - b.resolution)
    .slice(0, max)
    .map((d) => ({
      axis: d.axis,
      label: AXIS_META[d.axis]?.label ?? d.axis,
      probe: AXIS_META[d.axis]?.probe ?? 'a focused test of this quality',
    }));
}

export function depthBand(n: number): DepthBand {
  if (n <= 0) return 'zero';
  // shallow runs to 10: the limiter validation showed the individual read
  // only beats the population prior from ~10-15 scores up (review item 5)
  if (n < 10) return 'shallow';
  if (n < 20) return 'mid';
  return 'deep';
}

export function buildDials(p: FittedProfileView): DialView[] {
  return Object.entries(p.axes)
    .map(([axis, ax]) => ({
      axis,
      label: AXIS_META[axis]?.label ?? axis,
      definition: AXIS_META[axis]?.definition ?? '',
      relative: ax.mean,
      sd: ax.sd,
      relativeZ: ax.meanZ,
      sdZ: ax.sdZ,
      absolute: Math.min(99, Math.max(1, p.level.mean + ax.mean)),
      resolution: (() => {
        const ps = priorSdOf(ax);
        return ps ? Math.max(0, Math.min(1, 1 - ax.sd / ps)) : 1;
      })(),
    }))
    .sort((a, b) => b.relative - a.relative);
}

// ------------------------------------------------------------- story

const COHORT_NAMES: Record<string, string> = {
  open_rx_general: 'the worldwide RX Open field',
  // same field, same scores — the elite cohort changes the RULER (z-space
  // fit above p85, where percentiles compress), not the comparison group
  open_rx_elite: 'the worldwide RX Open field',
};

function pctPhrase(level: number): string {
  if (level >= 50) {
    return `top ${Math.max(1, Math.round(100 - level))}%`;
  }
  return `ahead of ${Math.max(1, Math.round(level))}%`;
}

/** How many of the 73 ratified library tests each gate walls (measured
 *  from the signature library's gate annotations — a library fact,
 *  versioned with the library, not a model parameter). */
const GATE_EXPOSURE: Record<string, number> = {
  ring_muscle_up: 9,
  chest_to_bar: 9,
  bar_muscle_up: 8,
  kipping_hspu: 5,
  double_unders: 4,
  handstand_walk: 3,
  toes_to_bar: 2,
  single_leg_squat: 1,
};

const GATE_NAMES: Record<string, string> = {
  bar_muscle_up: 'the bar muscle-up',
  ring_muscle_up: 'the ring muscle-up',
  chest_to_bar: 'chest-to-bar pull-ups',
  handstand_walk: 'the handstand walk',
  kipping_hspu: 'handstand push-ups',
  double_unders: 'double-unders',
  pull_up: 'pull-ups',
};

/**
 * Assemble the story from fragments keyed to the profile's shape.
 * 2-4 sentences. Copy rules enforced here; the checker script verifies
 * them across the whole synthetic population.
 */
export function buildStory(p: FittedProfileView): string[] {
  const cohort = COHORT_NAMES[p.cohort] ?? p.cohort;
  const band = depthBand(p.nEvidence);
  const dials = buildDials(p);
  const limiters = evidenceLimiters(p);
  const unknowns = unknownDials(p);
  const shutGates = Object.entries(p.gates ?? {})
    .filter(([, s]) => s === 'lacks')
    .map(([m]) => m);

  const s: string[] = [];

  // --- opener: level, always both lenses' anchor, cohort always named
  if (band === 'zero') {
    s.push(
      `We haven't scored any of your workouts against ${cohort} yet — ` +
        `log a workout or link your Open history and your profile starts here.`,
    );
    return s;
  }
  const levelSentence = `You sit ${p.level.mean >= 50 ? 'in the ' : ''}${pctPhrase(p.level.mean)} of ${cohort}` +
    (band === 'shallow'
      ? `, from ${p.nEvidence} scored workout${p.nEvidence === 1 ? '' : 's'} so far — early picture, wide error bars.`
      : ` (±${p.level.sd.toFixed(1)}), read from ${p.nEvidence} scored workouts.`);
  s.push(levelSentence);

  // --- tilt / strengths: relative language only; unknowns can't be the
  // headline (a wide-prior axis with a small positive mean is not a
  // "clearest surplus" — review 2026-11-03 item 6), and tilt size is
  // judged in posterior-sd units, not raw points (item 2).
  const unknownSet = new Set(unknowns.map((u) => u.axis));
  const known = dials.filter((d) => !unknownSet.has(d.axis));
  const top = known[0] ?? dials[0];
  const zOf = (d: typeof dials[number]) => (d.sd > 0 ? Math.abs(d.relative) / d.sd : 0);
  const maxZ = Math.max(...known.map(zOf), 0);
  const tiltSize = maxZ > 1.5 ? 'big' : maxZ > 0.75 ? 'mild' : 'flat';
  if (band !== 'shallow') {
    if (tiltSize === 'flat') {
      s.push(`Your profile is even: no quality stands far from your own line yet.`);
    } else {
      s.push(
        `${top.label} runs ${top.relative >= 0 ? '+' : ''}${top.relative.toFixed(0)} above your own line — ` +
          `your clearest surplus relative to yourself.`,
      );
    }
  }

  // --- limiter clause: evidence-backed only, top-2, probabilities carried.
  // Shallow depth never names a limiter (spec: distance-from-pack + sharpen).
  if (band !== 'shallow' && limiters.length > 0) {
    const l = limiters
      .map((x) => `${x.label} (${Math.min(95, Math.round(x.p * 100))}%)`)
      .join(', then ');
    s.push(
      `Relative to your own level, the likeliest place you give points back is ${l} — ` +
        `a ranked read, not a verdict.`,
    );
  } else if (band === 'shallow') {
    s.push(
      `Too early to call a limiter — right now the best read is where you sit, not what holds you back.`,
    );
  }

  // --- unknown clause: not-knowing stated as not-knowing, with the probe
  if (unknowns.length > 0) {
    const u = unknowns[0];
    s.push(
      `We can't see your ${u.label.toLowerCase()} yet — ${u.probe} would tell us the most.`,
    );
  }

  // --- gates clause
  if (shutGates.length > 0) {
    // Copy rule (review 2026-11-03 item 3): never claim what training will
    // do — "would open more than any capacity gain" is a response-model
    // claim and there is no response model. State the measured exposure.
    const worst = shutGates
      .slice()
      .sort((a, b) => (GATE_EXPOSURE[b] ?? 0) - (GATE_EXPOSURE[a] ?? 0))[0];
    const nWalled = GATE_EXPOSURE[worst] ?? 0;
    const gName = GATE_NAMES[worst] ?? worst.replace(/_/g, ' ');
    if (nWalled > 0) {
      s.push(
        `Right now ${gName} walls you out of ${nWalled} of the library's 73 tests.`,
      );
    }
  }

  return s.slice(0, 4);
}

/** The full read, one call: what the panel renders. */
export function readProfile(p: FittedProfileView): ProfileRead {
  const band = depthBand(p.nEvidence);
  return {
    dials: buildDials(p),
    // the limiter CARD follows the story rule: never at shallow depth
    limiters: band === 'shallow' || band === 'zero' ? [] : evidenceLimiters(p),
    unknowns: unknownDials(p),
    story: buildStory(p),
    depthBand: band,
  };
}
