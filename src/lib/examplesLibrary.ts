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
          'The Evaluation opens with the big picture.\n\nBefore it gets into the details, it tells you what matters most: where you’re already strong, where the biggest opportunity is, and what should drive the training next.\n\nHere, the verdict is one sentence: pressing is the clearest gap in an otherwise well-rounded profile — light for this athlete’s size next to his pulling and squatting base.\n\nIt doesn’t just score the inputs. It interprets them and makes a coaching judgment.',
      },
      {
        image: '/images/eval-strengths.png',
        alt: 'Evaluation strengths section',
        title: 'What not to waste time on',
        caption:
          'A good evaluation doesn’t just find weaknesses. It recognizes what’s already working — and decides how much attention it still needs.\n\nHere, advanced pulling and midline work and a hinge that’s the athlete’s strongest pattern are identified as strengths. They stay in the program, but they don’t need to drive it.\n\nThe system keeps them sharp with maintenance doses while the training time goes toward the bigger opportunities.\n\nThat’s coaching judgment: maintain what’s already strong, and spend your time where the gains are.',
      },
      {
        image: '/images/eval-weaknesses.png',
        alt: 'Evaluation weaknesses and priorities, ranked',
        title: 'Ranked, with the why',
        caption:
          'The Evaluation doesn’t just list weaknesses. It ranks them, explains why they matter, and decides which ones deserve the most training attention.\n\nHere, pressing strength is the biggest gap. The Olympic lifts come next — a 165 snatch against a 325 back squat is technique and confidence, not leg strength, and the overhead squat proves it. Then more absolute leg strength, and finally a conditioning finding most athletes would never spot: the run holds pace over distance, but the row fades from the 2k to the 5k.\n\nThat distinction matters because the program won’t treat everything equally.\n\nThese priorities become the work — the things the AI programs to improve first.',
      },
      {
        image: '/images/eval-analysis.png',
        alt: 'Evaluation analysis — the full reasoning across strengths, weaknesses, and conditioning',
        title: 'The reasoning behind the plan',
        caption:
          'This is where the Evaluation goes deeper.\n\nThe AI weighs the athlete as a whole — strengths, weaknesses, the relationships between lifts, and how confident it is in the underlying data — then decides what to push, what to maintain, and what comes first.\n\nIt also explains the tradeoffs. Pressing gets the emphasis. The Olympic lifts are treated as technique work — the strength is already there, and the overhead squat exceeding the snatch proves the positions are too. The squat comes third, because more leg strength lifts the ceiling on everything else. And conditioning minutes get aimed at the specific gap the numbers revealed: sustained aerobic output.\n\nAnd when the evidence is uncertain, it says so. Self-reported lifts start as a sketch; logged training sharpens the picture over time.\n\nThis is the reasoning behind the program — not just what to train, but why, how much, and what comes first.',
      },
      {
        image: '/images/eval-recommendations.png',
        alt: 'Evaluation recommendations — four prioritized prescriptions',
        title: 'The prescription',
        caption:
          'The Evaluation finishes by turning all of that reasoning into a clear training plan.\n\nWhat should lead the cycle. What should support it. What needs technique work. What can stay in the background.\n\nHere, pressing leads with dedicated volume on bench and strict press. Olympic technical work comes next — snatch-focused, plus jerk work to close the gap on the clean. The squat runs second behind pressing while deadlift volume stays moderate — the hinge is already his strongest pattern — and conditioning biases toward longer, sustained-pace work.\n\nIf you move forward with AI Programming, these recommendations become the starting point for the program — alongside your goals, schedule, equipment, and preferences.\n\nThe Evaluation doesn’t just tell you what needs work. It tells the AI what to build next.',
      },
    ],
  },
  programming: {
    title: 'A real training day, block by block',
    intro:
      'One athlete runs this entire page \u2014 the same athlete whose evaluation you just read. These are his real inputs and the real training day the AI built from them: Week 1, Day 2, an Olympic-lifting session in service of the goals he typed. Every number on this page is his.',
    steps: [
      {
        image: '/images/programming-tell-us.png',
        alt: 'Make it Personal \u2014 schedule, equipment, and goals cards',
        title: 'First, you tell us',
        caption:
          'Before anything is generated, the program asks for three things: your schedule, your equipment, and your goals.\n\nThe program fits your life, so you won\u2019t have to scramble to squeeze in training. It\u2019s built around your equipment, so you don\u2019t have to scale or substitute. Your goals connect where you are today with what you\u2019re training to achieve.\n\nEverything that follows on this page was built from what went into these three cards.',
      },
      {
        image: '/images/programming-goals-words.png',
        alt: 'The goals card filled in \u2014 goal text, injury note, and preferences',
        title: 'His words, not a template',
        caption:
          'You don\u2019t choose a program or a track. You have a conversation.\n\nTell us exactly what you\u2019re training for and what you want to accomplish, along with anything we need to work around. Here, that\u2019s raising the Olympic lifts, getting stronger overhead, pacing long workouts, stringing ring muscle-ups together \u2014 and a note to keep deadlifts below 90%.\n\nThe AI combines your words with your profile and evaluation to build the program around your starting point, your goals, and your preferences.\n\nNot a group program you have to fit into. A program built for you.',
      },
      {
        image: '/images/programming-day-full-v2.png',
        alt: 'A complete training day \u2014 intent, coach bar, warm-up, skills, strength, accessory, metcon, cool-down',
        title: 'The whole day is built around you',
        caption:
          'This is Week 1, Day 2 \u2014 and his goals show up in every block. Midline work for stability. Pause snatches at 72% for positioning and timing. Overhead squats and snatch pulls to support the lifts. A short metcon to practice cycling the bar under fatigue. Warm-up and cool-down are built too \u2014 collapsed here so the main work leads.\n\nThis isn\u2019t a workout generator or a percentage progression. Every block has a purpose, and every block is designed with the others in mind. It\u2019s a complete training day built around the athlete.\n\nAnd it\u2019s not static. Every block has an Edit button and an AI Coach, and the chat can change today\u2019s workout \u2014 ask questions or adjust the training.',
      },
      {
        image: '/images/programming-intent-v2.png',
        alt: 'Today\u2019s Training Intent expanded \u2014 the program explaining the day\u2019s reasoning',
        title: 'Know what the day is trying to do',
        caption:
          'Before training, the AI Coach walks you through the plan, so you understand how the pieces work together to move you toward your goals \u2014 the purpose of each block, pacing, intensity, and where to prioritize quality over load.\n\nHere it explains why the midline work comes first, what the pause snatches are for \u2014 position and timing, not load \u2014 and why the metcon stays capped at 8 minutes instead of digging a hole.\n\nJust like meeting with your coach when you walk into the gym: you know what you\u2019re doing, why you\u2019re doing it, and how to get the most out of every session.',
      },
      {
        image: '/images/programming-strength-coach.png',
        alt: 'Snatch strength block with Coach open \u2014 game plan and per-movement cues',
        title: 'Every block carries a coach',
        caption:
          'Tap Coach on any block and you get a game plan, specific points of performance, and the common faults to avoid \u2014 how to approach the work, and what to emphasize to get the intended training benefit.\n\nAll of it informed by your abilities, your goals, and the purpose of the day. Here the cues know his numbers: \u201Cyour OHS at 185 far exceeds this load, so there\u2019s no excuse for a soft catch.\u201D\n\nIt\u2019s like having a personal coach by your side every time you train.',
      },
      {
        image: '/images/programming-metcon-plan.png',
        alt: 'Metcon block with its game plan \u2014 target time, limiter, and pacing',
        title: 'The metcon, with a game plan',
        caption:
          'Your workout. Your numbers. Your game plan.\n\nEvery metcon comes with a pacing strategy built for you \u2014 not just to finish the workout, but to get the right training stimulus. Here the Coach sets a 5:30\u20137:00 target because it knows 65 lbs is only ~39% of his snatch, and it knows the snatch work from earlier in this same session will make the 21s feel heavier than the load suggests.\n\nWhere to push, where to pace, how to manage fatigue. Coaching makes every session count.',
      },
      {
        image: '/images/programming-accessory-day.png',
        alt: 'Accessory block \u2014 overhead squats and snatch pulls with percentages and rest',
        title: 'The small work is personalized too',
        caption:
          'Every detail matters. Even the accessory work.\n\nYour coach looks at the entire training day \u2014 what the strength work develops, what the skills reinforce, what the metcon delivers \u2014 and uses the accessory block to support it: overhead squats at 70% to strengthen the catch, snatch pulls at 88% to build pull strength above the weights he\u2019s cycling.\n\nNothing is overlooked. Every part of your training works toward making you better \u2014 and like every other block, it comes with coaching guidance to get the intended benefit.',
      },
      {
        image: '/images/programming-coach-change-v2.png',
        alt: 'AI Coach conversation \u2014 hotel-gym dumbbell swap proposed with Apply and Keep original buttons',
        title: 'Change the plan without losing the purpose',
        caption:
          'Life changes. Your program changes with you.\n\nDifferent equipment, an injury to work around, short on time, extra skill practice \u2014 just tell us. Here, a hotel gym with no barbell: the coach asks what he actually has, does the math \u2014 a single 50 lb dumbbell keeps the same stimulus as the 65 lb bar \u2014 and writes the change up as a proposal. Apply, or keep the original. Your call, one tap.\n\nThe only way to get more personalized might be to have your coach move in with you.',
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
      'Most apps’ analytics describe your past — a reward screen after the work. Ours are the operating system: the numbers you see here are the same inputs the AI uses to write what comes next. Measured in watts, ranked against 15 million competition scores, and fed straight back into the program.',
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
  // Week-grid entry retired — legible percentages and exercise choices
  // invited scrutiny without the evaluation context that produced them;
  // its session-architecture point moved into the programming intro.
  // "Inside a training day" gallery entry retired — the walkthrough's first
  // step IS a full day, captured newer and cleaner.
];
