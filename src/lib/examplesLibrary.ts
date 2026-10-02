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
        title: 'Start with the basics',
        caption:
          'We begin with the same information you’d expect to give a coach: age, height, weight, lifts, skills, and a few conditioning benchmarks.\n\nYou don’t need perfect data. If you only know roughly where you stand, that’s enough to get started.\n\nComplete the basics and the system can already begin tailoring its answers to you.',
      },
      {
        image: '/images/eval-intake-benchmarks.png',
        alt: 'Conditioning benchmarks — running and rowing times entered in the profile',
        title: 'Give us what you know',
        caption:
          'We ask for the basics of your athletic profile: your lifts, skills, and a few conditioning benchmarks.\n\nEnter as much as you know. You don’t need every number, and you don’t need perfect precision — a reasonable estimate is enough to get started.\n\nThe inputs are simple. What we do with them is different.',
      },
      {
        image: '/images/eval-summary.png',
        alt: 'Evaluation opening verdict',
        title: 'The coach’s read',
        caption:
          'The Evaluation opens with the big picture.\n\nBefore it gets into the details, it tells you what matters most: where you’re already strong, where the biggest opportunity is, and what should drive the training next.\n\nHere, the athlete’s engine is strong, but raw strength — especially pressing — is the clearest limiter.\n\nIt doesn’t just score the inputs. It interprets them and makes a coaching judgment.',
      },
      {
        image: '/images/eval-strengths.png',
        alt: 'Evaluation strengths section',
        title: 'What not to waste time on',
        caption:
          'A good evaluation doesn’t just find weaknesses. It recognizes what’s already working — and decides how much attention it still needs.\n\nHere, strong endurance, advanced skills, and a balanced hinge pattern are all identified as strengths. They stay in the program, but they don’t need to drive it.\n\nThe system keeps them sharp with regular touches while more training time goes toward the athlete’s bigger opportunities.\n\nThat’s coaching judgment: maintain what’s already strong, and spend your time where the gains are.',
      },
      {
        image: '/images/eval-weaknesses.png',
        alt: 'Evaluation weaknesses and priorities, ranked',
        title: 'Ranked, with the why',
        caption:
          'The Evaluation doesn’t just list weaknesses. It ranks them, explains why they matter, and decides which ones deserve the most training attention.\n\nHere, pressing strength is the biggest gap. Squat strength comes next. The jerk looks more like a technique problem than a strength problem, while the remaining gymnastics gaps are lower-cost accessory work.\n\nThat distinction matters because the program won’t treat everything equally.\n\nThese priorities become the work — the things the AI programs to improve first.',
      },
      {
        image: '/images/eval-analysis.png',
        alt: 'Evaluation analysis — the full reasoning across strengths, weaknesses, and conditioning',
        title: 'The reasoning behind the plan',
        caption:
          'This is where the Evaluation goes deeper.\n\nThe AI weighs the athlete as a whole — strengths, weaknesses, age, goals, training frequency, recovery, and how confident it is in the underlying data — then decides what to push, what to maintain, what to touch lightly, and what not to prioritize yet.\n\nIt also explains the tradeoffs. Strong conditioning gets maintained instead of pushed. Pressing strength gets the emphasis. Jerk technique is treated as high-return work. Lower-priority skills stay in the background.\n\nAnd when the evidence is uncertain, it says so. Self-reported lifts start with lower confidence; logged training sharpens the picture over time.\n\nThis is the reasoning behind the program — not just what to train, but why, how much, and what comes first.',
      },
      {
        image: '/images/eval-recommendations.png',
        alt: 'Evaluation recommendations — four prioritized prescriptions',
        title: 'The prescription',
        caption:
          'The Evaluation finishes by turning all of that reasoning into a clear training plan.\n\nWhat should lead the cycle. What should support it. What needs technique work. What can stay in the background.\n\nHere, pressing strength becomes the lead priority, lower-body strength gets a structured progression, jerk technique gets regular attention, and lower-priority skill gaps are handled as accessory work.\n\nIf you move forward with AI Programming, these recommendations become the starting point for the program — alongside your goals, schedule, equipment, and preferences.\n\nThe Evaluation doesn’t just tell you what needs work. It tells the AI what to build next.',
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
        title: 'The whole day is built around you',
        caption:
          'This is a complete training day generated from the athlete’s Evaluation, profile, goals, and priorities.\n\nWarm-up. Skills. Strength. Accessories. Metcon. Cool-down.\n\nEach block is individualized — the movements, loads, reps, percentages, and conditioning are chosen for this athlete, not pulled from a shared template.\n\nAnd the day is built as a whole: skills before fatigue, the main strength priority in the right place, supporting accessory work, conditioning that fits the day, and recovery work to finish.\n\nThis isn’t one workout with personalized numbers. It’s an entire training day built for one athlete.',
      },
      {
        image: '/images/programming-intent.webp',
        alt: 'Today’s Training Intent — the program explaining why the day is built this way',
        title: 'Know what the day is trying to do',
        caption:
          'Every training day comes with its own intent.\n\nBefore you start, AI Coach explains what the session is trying to accomplish, why the blocks are ordered the way they are, which priorities they support, and how the conditioning fits with the rest of the day.\n\nIt’s the same kind of conversation you’d want from a coach when you walk into the gym: here’s what we’re working on today, here’s why, and here’s how to approach it.\n\nYou don’t just get the workout. You understand the plan behind it.',
      },
      {
        image: '/images/programming-strength.webp',
        alt: 'Strength block — Bench Press 5×5 at 195 lbs, 75% of tested max, RPE 7',
        title: 'Your numbers, proven methods',
        caption:
          'The program uses your actual numbers to prescribe the work. Here, 5×5 bench at 195 is 75% of this athlete’s tested max, with a target RPE of 7.\n\nChange the athlete, and the prescription changes.\n\nBut personalization doesn’t mean reinventing strength training. The program still uses proven lifts, loading principles, and progression — it simply applies them to your abilities and priorities.\n\nIndividualized numbers. Familiar methods. Training built for you.',
      },
      {
        image: '/images/programming-skills-coach.webp',
        alt: 'Skills block with AI Coach game plan and per-movement cues for butterfly pull-ups and legless rope climbs',
        title: 'Every block carries a coach',
        caption:
          'Tap Coach on any block and you get guidance for the work in front of you.\n\nFirst, the game plan: what this block is for, what should feel hard, what should stay controlled, and where your attention belongs.\n\nThen, movement-by-movement coaching: cues, common faults, reminders, and what to watch for — all informed by your skill level and training history.\n\nHere, the system knows butterfly pull-ups are a strength and legless rope climbs are the limiter, so the advice changes accordingly: one clean ascent beats any grind.\n\nYou don’t just get the work. You get coached through how to do it well.',
      },
      {
        image: '/images/programming-metcon.webp',
        alt: 'Metcon block — AMRAP 13 with an AI game plan predicting rounds and naming the limiter',
        title: 'The metcon, with a game plan',
        caption:
          'Every metcon comes with a strategy built around the athlete.\n\nThe Coach looks at the workout, your profile, your Evaluation, and what you’ve already done that day, then tells you how to approach it — expected rounds, likely limiter, pacing, where to stay controlled, and where to push.\n\nHere, the target is 4–5 rounds, with grip and lat fatigue identified as the main limiter. So the advice is specific: row around 70%, keep the toes-to-bar relaxed, and protect grip for the power cleans.\n\nYou’re not just given a metcon. You’re told how to get the most out of it.',
      },
      {
        image: '/images/programming-accessory.webp',
        alt: 'Accessory block — dumbbell rows and banded tricep extensions with rest guidance',
        title: 'The small work is personalized too',
        caption:
          'Accessory work is easy to overlook, but it’s where a lot of gaps get addressed.\n\nThe program uses your Evaluation, history, and goals to choose the supporting work that adds the most value — here, rows to balance the day’s pressing and triceps work to support pressing strength.\n\nThe load, reps, and rest are prescribed for quality, not just to fill time.\n\nThe main work drives the day. The accessory work fills the gaps. Both are built around you.',
      },
      {
        image: '/images/programming-coach-change.webp',
        alt: 'AI Coach conversation — athlete’s rower broke, coach proposes swapping to Echo Bike with Apply and Keep buttons',
        title: 'Change the plan without losing the purpose',
        caption:
          'Life changes. Your training can too.\n\nBroken equipment. Travel. Limited time. A movement that needs to be adjusted. Tell AI Coach what changed, and it can modify the session while preserving what the workout was designed to accomplish.\n\nHere, a broken rower becomes an Echo Bike swap. The rest of the metcon stays intact, the stimulus is preserved, and the Coach even explains how the substitution may change the feel of the workout.\n\nReview the change. Tap Apply. Keep training.\n\nThis isn’t a static program you have to work around. It’s a program that can work around you.',
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
          'Every Engine session starts by telling you what you’re training and how the day is structured.\n\nThe spectrum shows where the session sits between endurance and power. Here, the work is 8 rounds of 1:30 on / 1:30 off, with 12 total minutes of work.\n\nFrom there, everything you need is one tap away: workout details, your history and past targets, pacing guidance, warm-up, and AI Coach.\n\nYou know the purpose of the session before you start — and you have the tools to execute it well.',
      },
      {
        image: '/images/engine-day-details.webp',
        alt: 'Workout details — every round with a personal calorie target, cal/min rate, and RPM',
        title: 'Every interval is personalized',
        caption:
          'Open the workout details and every round has a target built from your own performance.\n\nHere, each 90-second interval is set at about 24 calories, with the pace and RPM shown alongside it so you know exactly what to hold.\n\nThat same idea carries across the program — calories, meters, pace, RPM, or split time, depending on the machine.\n\nYou’re not guessing at intensity. Every interval is calibrated to give you the stimulus you need.',
      },
      {
        image: '/images/engine-day-timer.webp',
        alt: 'Built-in work timer — 2:36 elapsed with the calorie goal, block, and round on screen',
        title: 'Your target stays in front of you',
        caption:
          'Start the session and your goal stays on screen while the clock runs.\n\nYou can see the target for the interval, the round you’re in, and the work/rest structure in real time — so you always know whether you’re on pace for the intended stimulus.\n\nPrefer the machine’s own monitor? That’s fine too. The timer is optional.\n\nThe point is simple: you know the number before you start, and you can pace against it while you train.',
      },
      {
        image: '/images/engine-day-pacing.webp',
        alt: 'AI Coach pacing answer citing the athlete’s previous session, RPE, and heart rate',
        title: 'Ask how to attack the session',
        caption:
          'Tap Pace this and AI Coach builds the plan around you.\n\nIt sees your profile, Evaluation, training history, previous sessions, targets, RPE, and the workout in front of you. Then it turns that context into specific pacing guidance for this session — how hard to start, what to hold, where fatigue is likely to show up, and how to approach each interval.\n\nHere, the Coach knows the athlete’s previous Max Aerobic Power session came in at 106% of target at RPE 8, so the advice starts from what this athlete has actually done — not from generic pacing rules.\n\nThe question may be simple. The answer is built from your data.',
      },
      {
        image: '/images/engine-day-history.webp',
        alt: 'Workout history — two Max Aerobic Power sessions a week apart, output rising from 16.3 to 18.4 cal/min',
        title: 'Your history stays with you',
        caption:
          'Every session is stored, so you can see exactly how your performance is changing over time.\n\nHere, the same Max Aerobic Power work moves from 16.3 cal/min to 18.4 one week later — with RPE recorded alongside it.\n\nThat history gives you a clearer picture of your progress, and it gives the AI better information for what comes next.\n\nYou can see how far you’ve come. The system uses that history to decide where to push next.',
      },
      {
        image: '/images/engine-day-equipment.webp',
        alt: 'Equipment selection — modality picker with a per-machine time-trial baseline',
        title: 'Train on the machine you want',
        caption:
          'Row. Bike. Ski. Run. Treadmill. Mix them up.\n\nThe Gains Lab keeps a separate performance baseline for each modality, so your targets stay personalized to the machine you’re actually using.\n\nHere, today’s Echo Bike target comes from this athlete’s own Echo Bike time trial. Switch to the rower or treadmill and the system uses that modality’s data instead.\n\nYou don’t have to fit your training to the platform. The platform adapts to how you train.',
      },
      {
        image: '/images/engine-analytics-overview-v2.webp',
        alt: 'Analytics overview — 12 sessions at 108% average performance, five day types from anaerobic to threshold, and energy system paces with the 2.56× ratio',
        title: 'Your whole engine, in one place',
        caption:
          'This is the rollup.\n\nSessions completed. Average performance against target. RPE. Equipment used. Training split across day types. Time-trial baselines. Aerobic and anaerobic pace. Glycolytic reserve.\n\nInstead of a list of workouts, you get a living picture of how your conditioning is developing.\n\nYou can see what you’ve trained, how you’re responding, where you’re improving, and what still needs work — and the AI sees the same picture when it decides what comes next.',
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
        title: 'Your score becomes useful',
        caption:
          'Most workout scores get logged, ranked, and forgotten.\n\nHere, your effort becomes a real data point — power output, watts per kilogram, time domain, movements, and percentile against our competition data.\n\nThat gives you a clearer picture of where your work capacity is strongest and weakest. More importantly, the AI sees the same thing and uses it to shape what comes next.\n\nYour workout history stops being a record of the past. It becomes evidence for your future training.',
      },
      {
        image: '/images/analytics-power-duration.webp',
        alt: 'Power vs Duration chart — every logged metcon as a bar from 3:12 to 17:45, one selected showing its full read and the athlete’s note',
        title: 'Your workouts become a fitness curve',
        caption:
          'Each logged metcon becomes another point on your personal power-duration curve — from short, high-power efforts to longer tests of sustained work capacity.\n\nNow the pattern becomes visible.\n\nThis athlete produces more power in shorter workouts, then drops off as duration increases. That tells us where fitness is strongest, where it begins to fade, and what the program should do about it.\n\nShort-duration capacity can be maintained while longer-duration work gets more attention.\n\nAnd because every point includes the workout’s movements, duration, output, and your own feedback, the system can drill deeper than the curve alone.\n\nYou see where your fitness breaks down. The AI uses that information to decide what to build next.',
      },
      {
        image: '/images/engine-analytics-comparison.webp',
        alt: 'Average pace comparison across day types — anaerobic 45.5, max aerobic power 17.3, endurance 11.5 cal/min',
        title: 'Your engine isn’t one thing',
        caption:
          'Anaerobic power. Max aerobic power. Endurance. Repeatability. They’re different qualities, and they should be measured separately.\n\nHere, the same athlete produces 45.5 cal/min on anaerobic work, 17.3 at max aerobic power, and 11.5 on endurance work — three very different demands on the same machine.\n\nThe Gains Lab tracks more than 20 conditioning stimuli, so you can see exactly where your engine is strongest, where it falls off, and how each quality is changing over time.\n\nThe AI sees the same map — and can target the parts of your conditioning that need the most work.',
      },
      {
        image: '/images/analytics-energy-ratio.webp',
        alt: 'Energy System Paces — Echo Bike bars at 1.00× time trial, 1.10× aerobic, 2.83× glycolytic, with a 2.56× Energy Systems Ratio',
        title: 'See how your engine is built',
        caption:
          'Your engine isn’t just “good” or “bad.” It has different parts.\n\nThis view compares what you can sustain near threshold, what you can produce at max aerobic power, and what you can generate at all-out intensity — all relative to your own baseline.\n\nThat shows how your aerobic and anaerobic systems are developed relative to each other, where you rely most heavily on one system, and where there may be room to improve.\n\nYou can also see your average and peak pace across the work you’ve logged.\n\nInstead of one conditioning score, you get a map of how your engine actually works — and the AI can train the parts that need it most.',
      },
      {
        image: '/images/analytics-targets-evolution.webp',
        alt: 'Targets vs Actual — three Max Aerobic Power sessions: targets 15.3, 16.3, 16.8 against actuals 16.3, 18.4, 18.7',
        title: 'Your results change what comes next',
        caption:
          'Logging a result isn’t just adding another score to your history. It tells the system what you’re capable of now.\n\nHere, the athlete beats a Max Aerobic Power target of 15.3 cal/min. The next target rises to 16.3. They beat that too, and the target moves again.\n\nThe system doesn’t simply copy the last score or chase every breakthrough. It uses your performance to keep the next demand challenging, repeatable, and appropriate for your current fitness.\n\nAs you improve, your targets improve with you — so you’re always training the athlete you are today, not the athlete you were two months ago.',
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
