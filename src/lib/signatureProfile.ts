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

// Prior sds from the open_rx_general_v1 params (diagonal of prior_cov_pct).
// Used only to compute per-dial RESOLUTION (how much of the prior has been
// pinned down); the fit itself always reads the live params row.
export const PRIOR_SD: Record<string, number> = {
  aerobic_capacity: 8.8,
  anaerobic_capacity: 4.4,
  gymnastics_pressing: 7.4,
  gymnastics_pulling: 13.0,
  midline: 2.6,
  mixed_modal_conditioning: 2.9,
  olympic_lifting: 7.0,
  posterior_chain: 3.7,
  powerlifting_strength: 8.0,
  skill_coordination: 5.9,
  squat_cycling: 3.7,
  upper_body_pressing: 3.0,
};

// ------------------------------------------------------ classification

/** Evidence-backed limiter: probability must come from a negative mean,
 *  not from width alone (two-card rule). */
export function evidenceLimiters(p: FittedProfileView, max = 2): LimiterItem[] {
  return Object.entries(p.limiterPosterior)
    .filter(([axis, prob]) => {
      const ax = p.axes[axis];
      if (!ax) return false;
      // mean must be meaningfully negative AND carry real posterior mass
      return ax.mean < -2 && prob >= 0.12;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([axis, prob]) => ({
      axis,
      label: AXIS_META[axis]?.label ?? axis,
      p: prob,
    }));
}

/** Width-driven unknowns: dials still mostly at the prior. */
export function unknownDials(p: FittedProfileView, max = 3): UnknownItem[] {
  return Object.entries(p.axes)
    .map(([axis, ax]) => ({
      axis,
      resolution: 1 - ax.sd / (PRIOR_SD[axis] ?? (ax.sd || 1)),
    }))
    .filter((d) => d.resolution < 0.35)
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
  if (n < 6) return 'shallow';
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
      absolute: Math.min(99, Math.max(1, p.level.mean + ax.mean)),
      resolution: Math.max(0, Math.min(1, 1 - ax.sd / (PRIOR_SD[axis] ?? (ax.sd || 1)))),
    }))
    .sort((a, b) => b.relative - a.relative);
}

// ------------------------------------------------------------- story

const COHORT_NAMES: Record<string, string> = {
  open_rx_general: 'the worldwide RX Open field',
};

function pctPhrase(level: number): string {
  if (level >= 50) {
    return `top ${Math.max(1, Math.round(100 - level))}%`;
  }
  return `ahead of ${Math.max(1, Math.round(level))}%`;
}

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

  // --- tilt / strengths: relative language only
  const top = dials[0];
  const tiltSize = Math.abs(dials[0].relative) > 10 || Math.abs(dials[dials.length - 1].relative) > 10
    ? 'big'
    : Math.abs(dials[0].relative) > 4 || Math.abs(dials[dials.length - 1].relative) > 4
      ? 'mild'
      : 'flat';
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
    const g = shutGates.slice(0, 2).map((m) => GATE_NAMES[m] ?? m.replace(/_/g, ' ')).join(' and ');
    s.push(
      `Unlocking ${g} would open more of the test than any capacity gain of the same effort.`,
    );
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
