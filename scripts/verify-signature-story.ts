/**
 * verify-signature-story — the story layer's copy rules as assertions,
 * run over the synthetic population (250 fixture profiles + edge cases).
 *
 *   npx tsx scripts/verify-signature-story.ts
 *
 * The story-layer spec (design doc, 2026-11-02) is enforceable because the
 * narrator is a pure function; this script IS the enforcement:
 *   R1  banned absolute-negative language ("weak", "bad at", "poor") —
 *       dials are relative, never deficits in absolute terms
 *   R2  at most 2 limiters, and every named limiter has mean < 0 (evidence-
 *       backed, never width-driven)
 *   R3  unknowns are described as not-knowing + a probe, never as limiters
 *   R4  the cohort is named in every non-empty story
 *   R5  zero-depth renders the onboarding sentence, no findings
 *   R6  shallow depth never claims a tilt reading
 *   R7  every story is 1-4 sentences
 * Exits non-zero on any violation; prints the shape coverage table.
 */

import fixture from '../src/lib/fixtures/syntheticProfiles.json';
import {
  buildStory,
  depthBand,
  evidenceLimiters,
  readProfile,
  unknownDials,
  type FittedProfileView,
} from '../src/lib/signatureProfile';

const profiles = fixture as unknown as FittedProfileView[];

const BANNED = [
  /\bweak\b/i, /\bbad at\b/i, /\bpoor\b/i, /\bworst\b/i, /\bdeficien/i,
  // R8: never claim what training will do (no response model exists) —
  // gate copy states measured exposure, not predicted payoff
  /would open more/i, /any capacity gain/i, /worth more than/i,
];

let failures = 0;
const shapeCounts = new Map<string, number>();

function fail(id: string, rule: string, detail: string) {
  failures++;
  console.error(`FAIL ${id} ${rule}: ${detail}`);
}

const cases: Array<{ id: string; p: FittedProfileView }> = profiles.map((p, i) => ({
  id: (p as unknown as { id?: string }).id ?? `syn_${i}`,
  p,
}));

// edge cases beyond the fixture
cases.push({
  id: 'edge_zero',
  p: {
    level: { mean: 50, sd: 25 },
    axes: Object.fromEntries(
      Object.keys(profiles[0].axes).map((a) => [a, { mean: 0, sd: 10 }]),
    ),
    limiterPosterior: Object.fromEntries(
      Object.keys(profiles[0].axes).map((a) => [a, 1 / 12]),
    ),
    nEvidence: 0,
    cohort: 'open_rx_general',
  },
});

for (const { id, p } of cases) {
  const read = readProfile(p);
  const story = read.story.join(' ');
  const band = depthBand(p.nEvidence);

  // R7
  if (read.story.length < 1 || read.story.length > 4) {
    fail(id, 'R7', `story has ${read.story.length} sentences`);
  }
  // R1
  for (const rx of BANNED) {
    if (rx.test(story)) fail(id, 'R1', `banned phrase ${rx} in: ${story}`);
  }
  // R2
  const lims = evidenceLimiters(p);
  if (lims.length > 2) fail(id, 'R2', `${lims.length} limiters`);
  for (const l of lims) {
    if (!(p.axes[l.axis].mean < 0)) {
      fail(id, 'R2', `limiter ${l.axis} has non-negative mean ${p.axes[l.axis].mean}`);
    }
  }
  // R3: no unknown axis may appear in the limiter list
  const unk = new Set(unknownDials(p).map((u) => u.axis));
  for (const l of lims) {
    if (unk.has(l.axis)) fail(id, 'R3', `${l.axis} is both limiter and unknown`);
  }
  // R4
  if (band !== 'zero' && !/RX Open field|open_rx_general/.test(story)) {
    fail(id, 'R4', `cohort not named: ${story}`);
  }
  // R5
  if (band === 'zero') {
    if (read.story.length !== 1 || !/haven't scored/.test(story)) {
      fail(id, 'R5', `zero-depth story wrong: ${story}`);
    }
  }
  // R6
  if (band === 'shallow' && /clearest surplus/.test(story)) {
    fail(id, 'R6', `shallow profile claims a tilt: ${story}`);
  }
  if (band === 'shallow' && /give points back/.test(story)) {
    fail(id, 'R6b', `shallow profile names a limiter: ${story}`);
  }
  if (band === 'shallow' && readProfile(p).limiters.length > 0) {
    fail(id, 'R6c', 'shallow read exposes a limiter card');
  }

  const shape = [
    band,
    lims.length > 0 ? 'lim' : 'nolim',
    unknownDials(p).length > 0 ? 'unk' : 'known',
  ].join('/');
  shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
}

console.log(`\nchecked ${cases.length} profiles across ${shapeCounts.size} shapes:`);
for (const [shape, n] of [...shapeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${shape.padEnd(22)} ${n}`);
}

// show three sample stories for eyeballing
for (const pick of ['syn_000', 'syn_001', 'edge_zero']) {
  const c = cases.find((x) => x.id === pick);
  if (c) console.log(`\n--- ${pick} (n=${c.p.nEvidence}) ---\n${buildStory(c.p).join('\n')}`);
}

if (failures > 0) {
  console.error(`\n${failures} copy-rule violations`);
  process.exit(1);
}
console.log('\nall copy rules hold');
