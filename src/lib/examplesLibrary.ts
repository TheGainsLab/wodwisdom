// Public examples library content (/examples) — real outputs from the product,
// curated as proof. The product pages carry the argument; this page carries
// the evidence, so entries are screenshots plus a short founder-voice caption
// saying what the viewer is looking at.
//
// Adding an example = appending to EXAMPLE_ENTRIES and dropping the image in
// public/images/. Coach answers are NOT here — /qa is their home, and the
// Examples page links to it as a fourth tab.

export type ExamplesTab = 'evaluations' | 'programming' | 'engine';

export const EXAMPLES_TABS: Record<ExamplesTab, string> = {
  evaluations: 'Evaluations',
  programming: 'Programming',
  engine: 'Engine',
};

export const EXAMPLES_TAB_ORDER: ExamplesTab[] = ['evaluations', 'programming', 'engine'];

export interface ExampleEntry {
  tab: ExamplesTab;
  /** Path under public/, e.g. "/images/hero-eval.png". */
  image: string;
  alt: string;
  title: string;
  caption: string;
}

export const EXAMPLE_ENTRIES: ExampleEntry[] = [
  // ── Evaluations ──────────────────────────────────────────────────
  {
    tab: 'evaluations',
    image: '/images/hero-eval.png',
    alt: 'The opening of a real athlete evaluation',
    title: 'Where you stand',
    caption:
      'Every evaluation opens with the big picture: where your lifts, skills, and conditioning stand, measured against 15 million competition event scores.',
  },
  {
    tab: 'evaluations',
    image: '/images/weak-eval.png',
    alt: 'An evaluation identifying an athlete’s limiting weakness',
    title: 'Finding the constraint',
    caption:
      'The evaluation doesn’t just score you — it identifies the weakness holding back everything else, and explains why fixing it comes first.',
  },
  {
    tab: 'evaluations',
    image: '/images/section2-eval.png',
    alt: 'A full section of a written evaluation',
    title: 'The full write-up',
    caption:
      'A complete section from a real evaluation: what we measured, what it means, and what your training should do about it.',
  },

  // ── Programming ──────────────────────────────────────────────────
  {
    tab: 'programming',
    image: '/images/Program-week.png',
    alt: 'A week of generated programming',
    title: 'A week of programming',
    caption:
      'One week from a real generated program. Every session has a purpose — and the emphasis follows the weaknesses the evaluation found.',
  },
  {
    tab: 'programming',
    image: '/images/Training-Day-Image.png',
    alt: 'A full training day — warm-up, skills, strength, metcon, and cool-down',
    title: 'Inside a training day',
    caption:
      'Every day breaks down into blocks — warm-up to cool-down — each with loads, targets, and coaching cues computed from the athlete’s own numbers.',
  },

  // ── Engine ───────────────────────────────────────────────────────
  {
    tab: 'engine',
    image: '/images/work-rest-ratio.png',
    alt: 'Work-to-rest ratio analytics',
    title: 'Work : rest, session by session',
    caption:
      'The work-to-rest breakdown across a training block — how much time this athlete spent working versus recovering, and how that shifts by day type.',
  },
  {
    tab: 'engine',
    image: '/images/comparison.png',
    alt: 'Output comparison across training structures',
    title: 'Output across day types',
    caption:
      'The same athlete produces very different output depending on what the day is asking for. That’s by design — each structure targets its own adaptation.',
  },
  {
    tab: 'engine',
    image: '/images/HR-analytics.png',
    alt: 'Average heart rate by day type',
    title: 'Heart rate by day type',
    caption:
      'Endurance days live low, anaerobic days spike. Proof the program trains the whole spectrum — not one band in the middle.',
  },
  {
    tab: 'engine',
    image: '/images/sessions.png',
    alt: 'Sessions by day type',
    title: 'Training distribution',
    caption:
      'Sessions by day type across the program — the distribution behind “conditioning, not cardio.”',
  },
  {
    tab: 'engine',
    image: '/images/power-duration-curve.png',
    alt: 'Power-duration curve across time domains',
    title: 'The shape of your engine',
    caption:
      'Power across short, medium, and long time domains — your power-duration curve, built from every session you log.',
  },
];
