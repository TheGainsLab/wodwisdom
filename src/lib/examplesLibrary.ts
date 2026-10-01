// Public examples library content (/examples) — real outputs from the product,
// curated as proof. The product pages carry the argument; this page carries
// the evidence, so entries are screenshots plus a short founder-voice caption
// saying what the viewer is looking at.
//
// Adding an example = appending to EXAMPLE_ENTRIES and dropping the image in
// public/images/. Coach answers are NOT here — /qa is their home, and the
// Examples page links to it as a fourth tab.

export type ExamplesTab = 'evaluations' | 'programming' | 'engine' | 'analytics';

export const EXAMPLES_TABS: Record<ExamplesTab, string> = {
  evaluations: 'Evaluations',
  programming: 'Programming',
  engine: 'Engine',
  analytics: 'Analytics',
};

export const EXAMPLES_TAB_ORDER: ExamplesTab[] = ['evaluations', 'programming', 'engine', 'analytics'];

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
      'Generated from about five minutes of self-reported input — the same intake you’d do. Read it top to bottom and notice what it’s doing: establishing the facts, weighing them, reasoning its way to a prescription. This is the foundation a program is built from.',
    steps: [
      {
        image: '/images/eval-intake-profile.png',
        alt: 'Athlete profile intake — basics and athletic data steps',
        title: 'What we ask',
        caption:
          'We start with the basics — age, height, weight, and gender. Then we ask about your lifts, skills, and conditioning. It’s the same information you’d expect to give a coach. You don’t need exact numbers for everything. If you only know roughly where you stand, that’s enough to get started — and completing Step 1 already unlocks tailored answers from the AI Coach.',
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
        title: 'The coach’s read',
        caption:
          'This is how the evaluation opens: not with a score, but with a read. The single clearest opportunity in an otherwise well-rounded profile, named in one sentence — before a single detail is unpacked. It’s not scoring inputs. It’s making a coaching call from the evidence.',
      },
      {
        image: '/images/eval-strengths.png',
        alt: 'Evaluation strengths section',
        title: 'What not to waste time on',
        caption:
          'A good evaluation doesn’t just hunt for weaknesses — it recognizes what’s already working and decides how much attention it still needs. A 19:55 5k and a 6:44 2k row get kept sharp with regular touches, “but it doesn’t need to be pushed while strength is the focus.” Strong skills and a balanced hinge stay in the rotation too — no special emphasis needed. That’s coaching judgment: maintain the strengths, spend your time where the gains are. That’s how training time doesn’t get wasted.',
      },
      {
        image: '/images/eval-weaknesses.png',
        alt: 'Evaluation weaknesses and priorities, ranked',
        title: 'Ranked, with the why',
        caption:
          'Not a list — a diagnosis. It notices the jerk (265) barely clears the push press (255), and concludes it’s technique, not strength, capping the clean & jerk — so the fix is cheap. It also separates major priorities from low-cost accessory work, so everything doesn’t get treated as equally important. That’s reasoning, not a template.',
      },
      {
        image: '/images/eval-analysis.png',
        alt: 'Evaluation analysis — the full reasoning across strengths, weaknesses, and conditioning',
        title: 'The reasoning — hedges included',
        caption:
          'This is where the evaluation goes deeper. It weighs the athlete as a whole — strengths, weaknesses, age, goals, training frequency, recovery, and its own confidence in the data — then decides what to push, what to maintain, what to touch lightly, and what not to prioritize yet. It’s also honest about its limits. Self-reported lifts start with lower confidence — as you log real training, the calls sharpen. This is the reasoning behind the program: not just what to train, but why, how much, and what comes first.',
      },
      {
        image: '/images/eval-recommendations.png',
        alt: 'Evaluation recommendations — four prioritized prescriptions',
        title: 'The prescription',
        caption:
          'The evaluation finishes by turning the reasoning into a short list of clear training priorities. What should lead the cycle. What should support it. What needs technique work. What can stay in the background. If you move forward with AI Programming, these recommendations become inputs to the program generator — alongside your goals, schedule, equipment, and preferences. The evaluation doesn’t just tell you what’s wrong. It tells the system what to do next.',
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
        image: '/images/engine-day-timer.webp',
        alt: 'Built-in work timer — 2:36 elapsed with the calorie goal, block, and round on screen',
        title: 'Run it on the built-in timer — or don’t',
        caption:
          'Start the session and the timer runs the whole thing: your goal on screen (~50.4 cal here), which block and round you’re in, work and rest called automatically. Prefer the rower’s own monitor? Skip the timer entirely and log your numbers straight off the machine.',
      },
      {
        image: '/images/engine-day-pacing.webp',
        alt: 'AI Coach pacing answer citing the athlete’s previous session, RPE, and heart rate',
        title: 'Ask how to attack it',
        caption:
          'Tap “Pace this” and the coach plans the session against the athlete’s actual history — their previous Max Aerobic Power session came in at 106% of target at RPE 8, and the pacing advice starts from that.',
      },
      {
        image: '/images/engine-day-history.webp',
        alt: 'Workout history — two Max Aerobic Power sessions a week apart, output rising from 16.3 to 18.4 cal/min',
        title: 'The history that makes it smart',
        caption:
          'Every session lands in your history — and the system reads it. Same workout, one week apart: 16.3 cal/min, then 18.4. That improvement is why the next session’s targets are higher. Progress isn’t a feeling here; it’s a number the program acts on.',
      },
      {
        image: '/images/engine-day-equipment.webp',
        alt: 'Equipment selection — modality picker with a per-machine time-trial baseline',
        title: 'Pick your engine',
        caption:
          'Choose the machine on the way in. Each modality carries its own time-trial baseline — today’s targets come from this athlete’s Echo Bike test. Switch machines and the targets follow.',
      },
      {
        image: '/images/engine-analytics-overview.webp',
        alt: 'Analytics overview — 9 sessions at 109% average performance, sessions split evenly across day types, energy system ratios, and peak vs average pace',
        title: 'Where it all adds up',
        caption:
          'Nine sessions in, this athlete is averaging 109% of their targets at RPE 7.6 — working slightly above prescription without redlining. Look at the day-type split: two sessions each across anaerobic, endurance, interval, and max aerobic power. The whole spectrum, trained evenly — that’s conditioning, not cardio.',
      },
    ],
  },
  analytics: {
    title: 'One athlete’s training, as data',
    intro:
      'Most apps’ analytics describe your past — a reward screen after the work. Ours are the operating system: the numbers you see here are the same inputs the AI uses to write what comes next. Measured in watts, ranked against 15 million competition scores, honest when the day was ordinary, and fed straight back into the program.',
    steps: [
      {
        image: '/images/programming-logged-metcon.webp',
        alt: 'A logged Fran — 3:32 Rx converted to 3.88 W/kg, 99th percentile, short time domain',
        title: 'A score becomes a measurement',
        caption:
          'It starts the moment you log. A 3:32 Fran isn’t stored as a diary entry — it’s converted into physics: 3.88 watts per kilogram, 99th percentile of the Open field, short time domain. Power is the common language that lets a sprint couplet and a 20-minute grinder sit on the same scale.',
      },
      {
        image: '/images/analytics-power-duration.webp',
        alt: 'Power vs Duration chart — every logged metcon as a bar from 3:12 to 17:45, one selected showing its full read and the athlete’s note',
        title: 'Every workout lands on your curve',
        caption:
          'Each logged metcon becomes a point on your personal power-duration curve, short efforts to long. Tap any bar for the full read — and notice the athlete’s own note riding with the numbers: “it was hard.” The system keeps what you felt next to what you produced, because the coach reads both.',
      },
      {
        image: '/images/engine-analytics-comparison.webp',
        alt: 'Average pace comparison across day types — anaerobic 45.5, max aerobic power 17.3, endurance 11.5 cal/min',
        title: 'Compared across stimuli',
        caption:
          'The same athlete, three energy systems: 45.5 cal/min on anaerobic days, 17.3 at max aerobic power, 11.5 on endurance. A 4× spread on the same machine — proof each day type demands something different, and each one is tracked on its own axis.',
      },
      {
        image: '/images/analytics-energy-ratio.webp',
        alt: 'Energy System Paces — Echo Bike bars at 1.00× time trial, 1.10× aerobic, 2.83× glycolytic, with a 2.56× Energy Systems Ratio',
        title: 'Two engines, one number',
        caption:
          'Those day types distill into a single derived metric. Every bar is a multiple of the athlete’s own time-trial pace — the dashed 1.00× baseline. Aerobic sits at 1.10×, glycolytic at 2.83×, and the ratio between them is the headline: a 2.56× glycolytic reserve, the gap between what you can produce in a burst and what you can sustain. The program trains both ends, and this number is how you watch them move.',
      },
      {
        image: '/images/analytics-targets-evolution.webp',
        alt: 'Targets vs Actual — three Max Aerobic Power sessions: targets 15.3, 16.3, 16.8 against actuals 16.3, 18.4, 18.7',
        title: 'The data writes the program',
        caption:
          'This is the part no reward screen does. Three Max Aerobic Power sessions: Sep 17 — target 15.3, actual 16.3. Sep 24 — the target is exactly that 16.3; the athlete posts 18.4. Sep 29 — the bar rises again to 16.8, beaten again at 18.7. Raised every time, and notice it didn’t naively chase the 18.4 breakout — the system sets demands it believes you can repeat. Your analytics aren’t a mirror; they’re the input.',
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
];
