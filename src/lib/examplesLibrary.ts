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

/**
 * A walkthrough is an ordered sequence of screens telling one story — e.g.
 * a training day start to finish. Rendered as the tab's featured item,
 * above the gallery entries.
 */
export interface ExampleWalkthroughStep {
  image: string;
  alt: string;
  title: string;
  caption: string;
}

export interface ExampleWalkthrough {
  title: string;
  intro: string;
  steps: ExampleWalkthroughStep[];
}

export const EXAMPLE_WALKTHROUGHS: Partial<Record<ExamplesTab, ExampleWalkthrough>> = {
  evaluations: {
    title: 'A real evaluation, start to finish',
    intro:
      'Generated from about five minutes of self-reported input — the same intake you’d do. Read it top to bottom and notice what it’s doing: establishing the facts, weighing them, and reasoning its way to a prescription. This is the foundation a program is built from.',
    steps: [
      {
        image: '/images/eval-intake-profile.png',
        alt: 'Athlete profile intake — basics and athletic data steps',
        title: 'What we ask',
        caption:
          'Two steps: the basics, then your athletic data — lifts, skills, and conditioning. Scientific precision not required; a general idea is fine.',
      },
      {
        image: '/images/eval-intake-benchmarks.png',
        alt: 'Conditioning benchmarks — running and rowing times entered in the profile',
        title: 'A few honest numbers',
        caption:
          'Enter what you know — a mile time, a 2k row, bike calories. This athlete’s whole intake took about five minutes.',
      },
      {
        image: '/images/eval-summary.png',
        alt: 'Evaluation opening verdict',
        title: 'The verdict',
        caption:
          'It opens with a coach’s read, not a score: the clearest gap in an otherwise well-rounded profile, named in one sentence.',
      },
      {
        image: '/images/eval-strengths.png',
        alt: 'Evaluation strengths section',
        title: 'What not to waste time on',
        caption:
          'It knows what’s already working — and says so with numbers. A 19:55 5k and a 6:44 2k row get kept sharp with regular touches, “but it doesn’t need to be pushed while strength is the focus.” That’s how your training time doesn’t get wasted.',
      },
      {
        image: '/images/eval-weaknesses.png',
        alt: 'Evaluation weaknesses and priorities, ranked',
        title: 'Ranked, with the why',
        caption:
          'Not a list — a diagnosis. It notices the jerk (265) barely clears the push press (255), and concludes it’s technique, not strength, capping the clean & jerk — so the fix is cheap. That’s reasoning, not a template.',
      },
      {
        image: '/images/eval-analysis.png',
        alt: 'Evaluation analysis — the full reasoning across strengths, weaknesses, and conditioning',
        title: 'The reasoning — hedges included',
        caption:
          'It weighs everything together, and it’s honest about its limits: these lifts are self-reported, so its confidence is capped until real sessions get logged. As training data comes in, the calls sharpen.',
      },
      {
        image: '/images/eval-recommendations.png',
        alt: 'Evaluation recommendations — four prioritized prescriptions',
        title: 'The prescription',
        caption:
          'Four specific, prioritized recommendations. Tell it your goal and your schedule, and your program is built from exactly this reasoning.',
      },
    ],
  },
  programming: {
    title: 'A real training day, block by block',
    intro:
      'Pulled straight from a generated program — Week 1, Day 1 of a pressing-focused cycle, exactly as the athlete sees it. Warm-up to cool-down, every number computed from their evaluation. Then look closer: the program explains its own reasoning, and every block carries its own coach.',
    steps: [
      {
        image: '/images/programming-day-full.webp',
        alt: 'A complete training day — warm-up, skills, strength, accessory, metcon, and cool-down blocks',
        title: 'The whole day',
        caption:
          'Six blocks with a shape: prime the shoulders, practice skills while the nervous system is fresh, then the day’s main lift — 5×5 bench at 75% of this athlete’s tested max — supporting accessory work, a 13-minute conditioning piece, and a flush to finish. Every load and rep count is theirs, not a template’s.',
      },
      {
        image: '/images/programming-intent.webp',
        alt: 'Today’s Training Intent — the program explaining why the day is built this way',
        title: 'Why today looks like this',
        caption:
          'Tap “Today’s Training Intent” and the program shows its work: which evaluation priority each block serves, why the skills come before the pressing load, and why the metcon deliberately stays out of the way of the squat cycle’s recovery budget. Nothing here is random — and it tells you so.',
      },
      {
        image: '/images/programming-strength.webp',
        alt: 'Strength block — Bench Press 5×5 at 195 lbs, 75% of tested max, RPE 7',
        title: 'Your numbers, not a template’s',
        caption:
          'One line carries the whole point: 5×5 at 195 — 75% of this athlete’s tested max — at a prescribed effort. Change your max, and every number downstream changes with it.',
      },
      {
        image: '/images/programming-skills-coach.webp',
        alt: 'Skills block with AI Coach game plan and per-movement cues for butterfly pull-ups and legless rope climbs',
        title: 'Every block carries a coach',
        caption:
          'Tap Coach on any block and you get a game plan for the piece plus cues for each movement — what to do, what not to do — reasoned from this athlete’s skill ratings: their legless rope climb is the beginner-rated limiter here, so “one clean ascent beats any grind.”',
      },
      {
        image: '/images/programming-metcon.webp',
        alt: 'Metcon block — AMRAP 13 with an AI game plan predicting rounds and naming the limiter',
        title: 'The metcon, with a game plan',
        caption:
          'The conditioning piece comes with a prediction and a strategy: expect 4–5 rounds, the limiter is grip and lat fatigue stacking from earlier in the session — so row at 70%, keep the toes-to-bar relaxed. That’s a coach who watched your whole day, not just this workout.',
      },
      {
        image: '/images/programming-accessory.webp',
        alt: 'Accessory block — dumbbell rows and banded tricep extensions with rest guidance',
        title: 'The supporting work',
        caption:
          'Accessory volume chosen to support the day’s pressing — done for quality, with the rest spelled out. Every block type has a job.',
      },
      {
        image: '/images/programming-coach-change.webp',
        alt: 'AI Coach conversation — athlete’s rower broke, coach proposes swapping to Echo Bike with Apply and Keep buttons',
        title: 'Broken rower? Tell the coach.',
        caption:
          'This is a real conversation: the athlete’s rower died, so they told the coach. It reasoned through the swap — same calorie target, same stimulus — showed exactly what would change, and one tap on Apply rewrote the program. It even warned the bike would feel harder. That’s the difference between a program you follow and a program that works with you.',
      },
      {
        image: '/images/programming-months.webp',
        alt: 'Program overview — months and weeks of an ongoing personalized program',
        title: 'And it keeps going',
        caption:
          'Not a PDF you buy once — an ongoing program. Every month is generated from the last: what you logged, what got easier, what you told the coach. Month after month.',
      },
    ],
  },
  engine: {
    title: 'A training day, start to finish',
    intro:
      'Captured from a live athlete’s account — Day 8 of their program, a Max Aerobic Power session. This is what opening a day and doing the work actually looks like.',
    steps: [
      {
        image: '/images/engine-day-overview.webp',
        alt: 'Engine Day 8 — Max Aerobic Power day page with spectrum strip, session structure, and AI tools',
        title: 'Open the day',
        caption:
          'The day tells you what it trains — the spectrum strip places Max Aerobic Power on the slow-to-fast continuum — and exactly what it asks: 8 rounds, 1:30 on, 1:30 off. Warm-up, pacing, and the AI Coach are one tap away.',
      },
      {
        image: '/images/engine-day-details.webp',
        alt: 'Workout details — every round with a personal calorie target, cal/min rate, and RPM',
        title: 'Every round has your number',
        caption:
          'Open the details and every interval carries a target computed from this athlete’s own time-trial baseline: ~24 cal per 90-second round, with the rate and RPM to hit it. Nothing generic — these are their numbers.',
      },
      {
        image: '/images/engine-day-pacing.webp',
        alt: 'AI Coach pacing answer citing the athlete’s previous session, RPE, and heart rate',
        title: 'Ask how to attack it',
        caption:
          'Tap “Pace this” and the coach plans the session against the athlete’s actual history — their previous Max Aerobic Power session came in at 106% of target at RPE 8, and the pacing advice starts from that.',
      },
      {
        image: '/images/engine-day-equipment.webp',
        alt: 'Equipment selection — modality picker with a per-machine time-trial baseline',
        title: 'Pick your engine',
        caption:
          'Choose the machine on the way in. Each modality carries its own time-trial baseline — today’s targets come from this athlete’s Echo Bike test. Switch machines and the targets follow.',
      },
    ],
  },
};

export const EXAMPLE_ENTRIES: ExampleEntry[] = [
  // ── Programming ──────────────────────────────────────────────────
  {
    tab: 'programming',
    image: '/images/Program-week.png',
    alt: 'A week of generated programming',
    title: 'A week of programming',
    caption:
      'One week from a real generated program. Every session has a purpose — and the emphasis follows the weaknesses the evaluation found.',
  },
  // "Inside a training day" gallery entry retired — the walkthrough's first
  // step IS a full day, captured newer and cleaner.
  {
    tab: 'programming',
    image: '/images/power-duration-curve.png',
    alt: 'Metcon power analytics — average output and the power-duration curve across time domains',
    title: 'Your metcons, as data',
    caption:
      'Every logged metcon feeds this: your average output and your power-duration curve across short, medium, and long time domains — the fitness picture the next month of programming is built from.',
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
];
