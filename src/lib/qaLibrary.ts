// Public Q&A library content — the "launch" set: general coaching questions
// only, distilled from the most-asked AI Coach questions. No entry may
// reference the user's program, the app's features, or product mechanics —
// program-specific entries ship in a later phase, if at all.
//
// Answers use a minimal inline markup: blank-line paragraph breaks and
// **bold** segments. Rendered by renderAnswer() in the QA pages.
//
// Adding an entry = appending to QA_ENTRIES. Slugs are permanent once
// published (they're the URLs) — never rename one, add a new entry instead.

export type QACategory =
  | 'week'
  | 'skills'
  | 'nutrition'
  | 'physiology'
  | 'conditioning'
  | 'coaches';

export const QA_CATEGORIES: Record<QACategory, string> = {
  week: 'Training Week',
  skills: 'Skills & Technique',
  nutrition: 'Nutrition',
  physiology: 'Physiology',
  conditioning: 'Conditioning & Pacing',
  coaches: 'For Coaches',
};

export interface QAEntry {
  slug: string;
  category: QACategory;
  question: string;
  /** Alternate phrasings, matched by search alongside the question. */
  variants: string[];
  answer: string;
}

export const QA_ENTRIES: QAEntry[] = [
  // ── Training Week ────────────────────────────────────────────────
  {
    slug: 'does-cardio-kill-my-gains',
    category: 'week',
    question: 'Does conditioning kill my strength and muscle gains?',
    variants: [
      'Can I do cardio after leg day?',
      'Will conditioning block muscle growth?',
      'Bike intervals after squats — bad idea?',
      'Is jump rope after leg day okay?',
    ],
    answer: `The "interference effect" is real but dramatically smaller than gym folklore says. In research, meaningful interference shows up mainly when high volumes of hard endurance work (especially running, with its eccentric load) directly collide with hypertrophy training in the same muscles, session after session. Moderate conditioning — a Zone 2 spin, bike intervals a day after squats, jump rope, sled pushes — does not erase muscle growth. Concurrent-training athletes get strong and jacked constantly; CrossFit is the proof.

Sensible precautions, in order of value: separate hard leg conditioning and hard leg strength by 24 hours when you can, or by 6+ hours when you can't; put strength first when both land in one session and strength is the priority; prefer low-impact modalities (bike, sled) near heavy leg days; and eat enough — under-fueling causes far more "interference" than any bike ever has.

And the reframe worth internalizing: aerobic fitness improves recovery between sets, between sessions, and between training days. Done sanely, conditioning is a **support system** for your strength training, not a tax on it.`,
  },
  {
    slug: 'lift-or-condition-first',
    category: 'week',
    question: 'Should I lift or condition first?',
    variants: [
      'Cardio before or after strength?',
      'Cardio before or after a WOD?',
      'Morning conditioning, evening lifting?',
    ],
    answer: `Priority goes first. Whatever quality you care most about improving gets your freshest hour — fatigue degrades strength work (technique decays, loads drop) faster than it degrades easy aerobic work.

If strength is the priority: lift first, condition after. An easy Zone 2 piece after lifting costs almost nothing and doubles as a flush. Save hard intervals for another slot.

If your engine is the priority: intervals first, lift after — accepting your loads will be modestly down.

Best of all, when life allows: split them. Morning and evening, or alternating days. Six-plus hours between sessions lets each get near-full quality.

The one combination to avoid regularly: hard leg intervals immediately before heavy squats or pulls. That's not interference — that's just lifting tired, and it's a technique-degradation and injury-risk problem more than an adaptation one.`,
  },
  {
    slug: 'training-while-traveling',
    category: 'week',
    question: 'How do I train while traveling with minimal equipment?',
    variants: [
      'Hotel gym workouts',
      'Metcons with just dumbbells and a jump rope',
      'Keeping my engine on the road',
    ],
    answer: `Travel training has one goal: preserve, don't build. Two or three honest sessions a week keeps every adaptation you own for several weeks — so drop the ambition and keep the habit.

With just dumbbells and a rope, lean on classic couplets and triplets kept simple: 5 rounds of 15 DB thrusters + 50 double-unders; an every-90-seconds alternating pattern of DB snatches, burpees, and rope; 21-15-9 devil's press and goblet squats with a DU buy-in each round. Simple structures survive bad equipment; clever ones don't.

For conditioning, anything with a monitor works — hotel bikes and treadmills are fine for Zone 2 and intervals even if the numbers aren't comparable to your home machine (pace by feel and duration instead of your usual targets). No machine at all? Runs, stairs, and rope intervals cover aerobic work completely.

And if a trip means training two days instead of five: make one hard and one easy, keep protein up, walk a lot, and come home without guilt.`,
  },
  {
    slug: 'how-often-max-effort',
    category: 'week',
    question: 'How many times a week should I go truly all-out?',
    variants: [
      'How often should I hit RPE 10?',
      'Can I max out every session?',
      "Why isn't every workout hard?",
    ],
    answer: `One to two genuinely maximal sessions a week — that's the budget, and it includes competition-pace metcons, not just interval days. True max efforts (time trials, all-out sprint work, redline metcons) carry a recovery cost of 48–72 hours in the systems they stress, and their benefits require you to arrive at them **able** to actually hit maximum. Stack three or four into a week and none of them is real — every "max" session quietly becomes a grind at RPE 8.5, which trains grinding, not power.

The uncomfortable math of conditioning: roughly 80% of your volume should be work you could call easy or controlled, and the small hard slice only works **because** of that ratio. Elite endurance athletes — people whose entire job is engine — train this way almost universally.

So an easy day on the schedule isn't resting you; it's making Thursday's hard day possible. Spend your max efforts like the scarce currency they are, and bring your whole self to the ones you get.`,
  },
  {
    slug: 'train-on-bad-sleep',
    category: 'week',
    question: 'Should I train on bad sleep — and when do I need a rest day?',
    variants: [
      "Skip training if I didn't sleep?",
      'Train through fatigue or rest?',
      'How do I know I need a day off?',
    ],
    answer: `One bad night: train, but demote the day. Do the session at the easy end of its intensity, or swap a hard interval day for the week's easy day and reshuffle. Skill under fatigue erodes first, so keep anything technical or maximal off the menu. One bad night barely dents physical capacity — the risk is quality, not safety.

A **pattern** — several short nights, a newborn, shift work — changes the answer. Sleep is where adaptation actually happens; training hard on chronic sleep debt is writing checks the recovery bank can't cash. In a rough stretch, hold frequency but cut intensity: easy aerobic work survives sleep deprivation well and even helps sleep, while max efforts and heavy CNS work should wait.

Take an unscheduled rest day when the signals stack: resting heart rate clearly elevated, yesterday's easy pace feeling hard, motivation flat for days (not hours), lingering soreness that isn't resolving, mood scraping bottom. Any two together — take the day. A rest day taken a day early costs nothing; taken a week late, it costs the week.`,
  },

  // ── Skills & Technique ───────────────────────────────────────────
  {
    slug: 'missing-snatches-in-the-catch',
    category: 'skills',
    question: 'I miss snatches in the catch even at weights I can pull high enough — why?',
    variants: [
      'Snatch drops in front of me',
      'Missing snatches behind',
      'Drills for snatch receiving position',
    ],
    answer: `If the bar goes high enough and you still miss, the pull isn't your problem — the **meeting** is. Common culprits, in rough order: pulling the bar backward-then-looping instead of keeping it close (bar crashes down out front); finishing the pull so long that you never get under (strength masking absent timing); an overhead position too weak or immobile to accept the bar where it lands; and — most fixable — fear-driven hesitation between extension and turnover, that fraction of a pause where the bar peaks and falls before you're under it.

Drills that attack the catch directly: snatch balance and drop snatch (train speed-under and confidence in the hole); high-hang and hip snatches (shrink the pull so the turnover becomes the whole rep); snatch-push-press + overhead squat (build the position's raw capacity); and tall snatch for pure turnover speed.

Diagnostic tip: where does the miss go? Out front usually means bar loop or slow turnover; behind usually means overpulling or jumping backward under a bar you launched away. Film one session from the side and it's rarely a mystery.`,
  },
  {
    slug: 'first-ring-muscle-up',
    category: 'skills',
    question: 'How do I get my first ring muscle-up?',
    variants: [
      'Strict pull-ups but no muscle-up',
      'Muscle-up transition drills',
      "Can't get the muscle-up timing right",
    ],
    answer: `If you own 5+ strict pull-ups and solid ring dips, you have the strength — what's missing is the **transition**, and the transition is a skill you drill, not a strength you grind toward.

Work three pieces separately. First, the false grip (if you're chasing a strict MU) or a deep aggressive kip (for kipping MU) — either way the bar of entry is keeping the rings close to your body; muscle-ups are lost the moment the rings drift away. Second, the hips-to-rings pull: low-ring banded transitions and feet-on-floor transition drills teach the pattern of pulling the rings to your sternum while your chest rotates **over** your hands rather than to them. Third, the catch: ring dips from a deep catch position, because your first real transitions will dump you into the bottom of a dip and you must own that position.

Sequence that works: 2–3 sessions a week, 15 minutes — false-grip hangs, then 3×5 low-ring transitions, then 3×3 deep catch dips. Most athletes with your pull-up base find the first muscle-up in 4–8 weeks. The day it happens, it will feel easy — that's how you'll know it was always timing.`,
  },
  {
    slug: 'stringing-toes-to-bar',
    category: 'skills',
    question: 'How do I string toes-to-bar together?',
    variants: [
      'T2B singles only',
      'Losing my swing between reps',
      'Kipping rhythm cues',
    ],
    answer: `Singles-only toes-to-bar almost always means the same thing: the swing dies at the bottom of every rep. Stringing them is about what happens **after** your toes touch — not before.

The pattern that works: as your feet come down, drive them **back behind you** into an arch (hollow-to-arch, not hollow-to-dead-hang). That backswing loads the next rep for free. Athletes who fail at stringing let their feet drop straight down beneath the bar, killing all rhythm — every rep starts from zero.

Cues that land: "kick to the ceiling, then kick your butt" · "toes touch, heels shoot back" · shoulders actively pushing down on the bar throughout — a passive hang cannot rebound.

Drill ladder: arch-hollow swings on the bar until the rhythm is metronomic; then knees-to-elbows **strung together** (same rhythm, smaller lever); then 2-rep sets of T2B with a deliberate backswing between — two connected reps prove the pattern; volume is then just repetition. Grip gives out before rhythm does at first, so practice fresh, in small sets, and stop before your swing degrades.`,
  },
  {
    slug: 'double-unders-in-workouts',
    category: 'skills',
    question: 'I can do 100 double-unders unbroken — why do I crash in workouts?',
    variants: [
      'Double-unders under fatigue',
      'DU efficiency in metcons',
      'Breathing during double-unders',
    ],
    answer: `Fresh double-unders and fatigued double-unders are almost different skills. Fresh, you can afford inefficiency — high bounce, tense shoulders, arms drifting wide, breath held. Under metcon fatigue, every one of those taxes collects at once: the legs that just did wall balls can't fund a high bounce, tense shoulders start clipping the rope, and the held breath adds an oxygen debt you pay on the next movement.

The fix is efficiency practice, not capacity practice. You don't need more max unbroken — you need cheaper reps: minimal bounce height (inches, not feet), elbows pinned to ribs with rotation from the wrists, soft knees, and — the one that changes workouts most — deliberate breathing on a rhythm, exhaling every few jumps. If you can't talk-count out loud during easy DUs, you're holding your breath.

Train it where it fails: pair DUs with a fatiguing movement — 10 wall balls + 30 DUs, five quiet rounds, pace controlled — and practice entering the set with a plan (one breath, wrists ready, first three jumps slightly slow). Smooth entry prevents the trip-restart-trip spiral that costs more than any single break.`,
  },
  {
    slug: 'substitutions-pistols-ghd-rope-climbs-hspu',
    category: 'skills',
    question: 'Substitutions for pistols, GHDs, rope climbs, and HSPU',
    variants: [
      'Pistol sub for knee pain',
      'No GHD at my gym',
      'Rope climb alternatives',
      "Can't do handstand push-ups yet",
    ],
    answer: `Substitute for the **stimulus**, not the shape.

**Pistols** (single-leg strength + balance): reverse lunges or step-ups at matched reps; box pistols to a depth target; skater squats. Knee pain specifically: elevate the heel and shorten range before abandoning the pattern — pain-free range first, depth later.

**GHD sit-ups / hip extensions** (long-lever midline + posterior chain): weighted sit-ups or V-ups at roughly 2:1 reps for sit-ups; good mornings, back extensions on a bench, or heavy banded pull-throughs for hip extensions.

**Rope climbs** (grip + vertical pulling): 3–4 strict or towel pull-ups per climb; rope pulls from floor to stand if you have a rope but not the skill; heavy sandbag or plate rows when there's no rope at all. Legless climbs sub at 4–5 pulls.

**HSPU** (vertical pressing): pike push-ups, feet elevated to scale up; dumbbell strict press or push press at moderate load; wall walks for positional strength. Negatives only if you can control 3+ seconds down.

Matched effort matters more than matched movements — pick the version that leaves you as worked as the original would have.`,
  },
  {
    slug: 'air-squat-points-of-performance',
    category: 'skills',
    question: 'What are the points of performance for the air squat?',
    variants: [
      'Air squat form checklist',
      'Squat depth standard',
      'Common air squat faults',
    ],
    answer: `The checklist: feet shoulder-width, toes slightly out. Weight in the heels — you should be able to wiggle your toes at the bottom. Lumbar curve held; chest up. The hips descend **back and down**, below the knee crease at the bottom. Knees track over the toes — never caving inward. Eyes on the horizon. Full hip and knee extension at the top; every rep finishes standing all the way up.

The faults worth coaching hardest, because they follow the athlete into every loaded squat: knees collapsing inward (weak glutes or unaware ones — cue "knees out" or band the knees); heels rising (weight shifted forward — slow the descent, cue the heels); lumbar rounding at depth ("butt wink" — often a mobility limit; squat only as deep as the spine stays neutral and earn the range); and cut depth, the most common of all — a squat above parallel is a different, easier movement.

Why so much fuss over an unloaded movement: the air squat is the pattern underneath the back squat, front squat, wall ball, thruster, and every squat clean you'll ever take. Flaws rehearsed here get expressed there, under load, at speed, when it matters.`,
  },
  {
    slug: 'gymnastics-fatigue',
    category: 'skills',
    question: 'Why do I fatigue faster on gymnastics than everything else?',
    variants: [
      'Gymnastics endurance is my weakness',
      'Pull-ups fall apart in workouts',
      'Conditioning fine, skills die',
    ],
    answer: `If your engine holds up on machines and barbells but pull-ups, T2B, and push-ups collapse mid-workout, the limiter usually isn't your conditioning — it's **local** muscular endurance and movement economy in the smaller upper-body machinery. A rower spreads work across your whole body; a strict pull-up concentrates it in lats, grip, and shoulder stabilizers most athletes have trained only for max reps, never for repeatability.

Economy compounds it: fatigued athletes abandon rhythm first, and muscling reps costs roughly triple exactly when you can least afford it.

The prescription: volume at submaximal intensity. Take movements you own and accumulate easy sets far from failure — for example, every minute on the minute for 10 minutes, do 30–40% of your max unbroken reps. Grease the pattern several times a week; it recovers fast because loads are light. Add density work (pairing a gymnastics movement with a monostructural piece at conversational pace) to practice keeping mechanics while breathing hard. Six weeks of this typically moves workout capacity more than any strength gain would.`,
  },
  {
    slug: 'hook-grip',
    category: 'skills',
    question: 'What is hook grip and why should I use it?',
    variants: [
      'Does hook grip hurt forever?',
      'Hook grip for cleans and snatches',
      'When not to hook grip',
    ],
    answer: `Hook grip: wrap the thumb around the bar first, then trap it under your first two fingers. The fingers pin the thumb; the thumb pins the bar. It converts your grip from a friction problem into a mechanical lock.

Why it matters for the Olympic lifts: during the violent extension of a clean or snatch, a conventional grip either slips or forces you to squeeze so hard that your forearms tense — and tense forearms slow the turnover, because the arms must whip loose and fast to get under the bar. The hook lets your arms stay relaxed while the bar stays attached. That's the real gift: not grip security, but **relaxation at speed**. It's also why mixed grip has no place in the Olympic lifts and why virtually every competitive lifter hooks every pull.

Yes, it hurts — for about two weeks. Commit to hooking every warm-up rep from empty bar onward and the thumbs adapt; tape helps early. Use it for snatches, cleans, and heavy pulls. Skip it where it earns nothing: presses, jerks off the rack, and high-rep light barbell cycling where a regular grip breathes better.`,
  },
  {
    slug: 'forward-lean-in-the-squat',
    category: 'skills',
    question: 'Why do I lean forward in my squat — and should I "sit back"?',
    variants: [
      'Chest drops in the squat',
      'Squat turns into a good morning',
      'Hips shoot up out of the bottom',
    ],
    answer: `Forward lean has three usual causes, and the fix depends on which one you have. **Ankle mobility:** if your shins can't travel forward, your torso must — test with a knee-to-wall check; heel-elevated squats or lifters fix it instantly, mobility work fixes it slowly. **Weak trunk or upper back:** the lean appears only as loads climb, and the bar drifts over mid-foot anyway — front squats, tempo work, and pause squats build the position. **A cue problem:** "sit back" is a deadlift-adjacent cue that serves low-bar squatters; in a high-bar or front squat it **creates** forward lean. Better: "sit down between your heels, knees out, chest proud."

And some forward lean is simply anatomy — long femurs and a short torso squat "leany" forever, safely. The line worth watching isn't the torso angle; it's whether the angle **changes** mid-rep. Hips shooting up while the chest dives is a position being lost, and that's the fault to train away.`,
  },
  {
    slug: 'squat-knee-pain-hip-shift',
    category: 'skills',
    question: 'Knee pain or a hip shift in the squat — what should I check?',
    variants: [
      'Inside knee pain from squats',
      'Shifting to one side out of the hole',
      'Knees cave on heavy reps',
    ],
    answer: `First, pattern: pain **during** specific reps with a technique fault visible on video is a movement problem; pain that lingers into the next day or shows up in daily life deserves a professional's eyes, not a cue.

Medial (inside) knee pain usually rides along with knees caving inward — the fix is rarely "think knees out" alone: strengthen abduction directly (banded lateral work, Copenhagen planks, single-leg squats), reduce load to where the knees track honestly, and rebuild volume there. A hip shift — drifting toward one side out of the bottom — usually reflects a side-to-side strength or mobility asymmetry: attack it with split squats and single-leg RDLs started on the weaker side, tempo pause squats at loads where the shift disappears, and patience; shifts fade as the weak side catches up.

What not to do: train through a worsening signal, or chase pain with more mobility work when the tissue wants strength. Pain that's stable and mild often resolves inside a sensible program; pain that's escalating never does.`,
  },
  {
    slug: 'deadlift-with-a-cranky-back',
    category: 'skills',
    question: 'How should I set up my deadlift with a cranky lower back or SI joint?',
    variants: [
      'Deadlifts with a history of back tweaks',
      'SI joint pain from pulling',
      'Should I switch to trap bar?',
    ],
    answer: `Three setup changes do most of the work. **Shorten the range:** pull from low blocks or a rack, or switch to a trap bar — less spinal flexion demanded, most of the training effect kept. **Brace before you bend:** big breath into the belly, ribs stacked over pelvis, lats engaged ("bend the bar around your shins") **before** the bar leaves the floor — most tweaks happen in the first inch, on a spine that wasn't ready. **Wedge, don't stretch:** hips closer to the bar, hinge until your hands reach it rather than reaching down with a soft back.

Program around the history, too: moderate loads for quality reps beat max singles for months after a cranky spell; RDLs and good mornings build the posterior chain with less bottom-position risk; and warm up the pattern (glute bridges, bird dogs, light hinges) rather than just the muscles.

SI-specific: single-leg work (split squats, step-ups, single-leg RDLs) often trains the region pain-free while symmetrical heavy pulling aggravates it. Persistent or radiating pain is a professional's territory — a program can respect an injury, it can't diagnose one.`,
  },
  {
    slug: 'russian-vs-american-kettlebell-swing',
    category: 'skills',
    question: 'Russian vs American kettlebell swing — which should I do?',
    variants: [
      'Are kettlebell swings overhead?',
      'Swing height standard',
      'Why does CrossFit swing overhead?',
    ],
    answer: `Unless the workout says otherwise: **CrossFit workouts mean American** — bell finishing overhead, arms by the ears — because that's the standard written into most WODs and competitions. **For training the hinge itself, the Russian swing** (bell to chest height) is the better tool: it's a pure, violent hip snap with no overhead demand, it loads heavier, and it keeps all the stimulus that makes swings valuable.

The honest trade-off: the American swing adds range and a vertical finish at the cost of shoulder demand — and for athletes with cranky shoulders or limited overhead mobility, that finish is often the worst position in the gym: lumbar compensation at the top of a ballistic movement. The extra "work" it does is mostly a longer arc, not a better hinge.

So: WOD says swings and you're healthy overhead — go American, hips doing the launching, arms just guiding. Overhead is questionable for you today — Russian at a heavier bell is a substitution no coach will argue with. Either way the swing is a hinge, not a squat: shallow knee bend, hard hip snap, bell floats.`,
  },
  {
    slug: 'pistols-hip-flexor-limited',
    category: 'skills',
    question: "I can't do a single-leg squat — my hip flexor gives out, not my leg",
    variants: [
      "Pistol progression when the front foot won't stay up",
      'Hip flexor cramps in pistols',
      'Single-leg squat strength standard',
    ],
    answer: `If the squatting leg is strong but the **front** leg keeps dropping — or the hip flexor cramps trying to hold it up — your limiter is active hip flexion strength in a shortened position, one of the least-trained qualities in the gym. The squat progression won't fix it; train the hip flexor directly.

Three drills, a few minutes several times a week: **seated leg lifts** — sit tall, leg straight, lift the heel off the floor and hold 5–10 seconds (harder than it sounds; this is the exact demand of the pistol's front leg); **standing banded march holds** — knee above hip height, resisting a light band, 15–20 seconds per side; **L-sit progressions** — tucked on parallettes or a box, the gold standard for compressed hip flexion.

Meanwhile, keep squatting single-leg in versions that sideline the limiter: box pistols (the free leg can hover lower), rings- or post-assisted pistols using minimal hand pressure, and pistols to a target with the heel lightly touching down. As the hip flexor strengthens, the versions converge. Most athletes with this specific limiter see the free leg stop dropping within 4–6 weeks.`,
  },
  {
    slug: 'shoulder-upper-back-mobility',
    category: 'skills',
    question: 'A 10-minute shoulder and upper-back mobility routine',
    variants: [
      'Overhead mobility for front rack and snatch',
      'Thoracic spine openers',
      'Tight lats limiting overhead',
    ],
    answer: `Most "tight shoulders" in CrossFit athletes are three restrictions stacked: a stiff thoracic spine, short lats, and pecs that pull the shoulders forward. Ten minutes, most days, in this order:

**Thoracic first** (it unlocks the rest): 2 minutes — foam-roller extensions over the mid-back, then open-book rotations, 8 per side. **Lats:** 2 minutes — side-lying or bench "puppy-pose" reaches with the elbows on a bench and hips sitting back, 45–60 seconds per position; add a light band overhead stretch, palms up. **Pecs/front line:** 2 minutes — doorway or rig stretch at two heights, 45 seconds each side. **Then load the new range:** 4 minutes — this is the step everyone skips, and it's why stretching alone never sticks. Waiter carries or a light overhead hold, wall slides, and 8–10 slow overhead squats or presses with a PVC pipe, owning the deepest honest position.

Test-retest something specific (front-rack elbows, overhead squat depth) weekly rather than chasing a feeling. Range you can't control under load isn't mobility yet — it's just slack.`,
  },

  // ── Nutrition ────────────────────────────────────────────────────
  {
    slug: 'eating-around-a-morning-workout',
    category: 'nutrition',
    question: 'What should I eat before and after a morning workout?',
    variants: [
      'Pre-workout breakfast for a 9am class',
      'Training a few hours after waking',
      'Post-workout meal timing',
    ],
    answer: `Working with a morning class a few hours after waking: eat a normal breakfast about 2–3 hours out — carbs you tolerate well, moderate protein, and go easy on fat and fiber right before training since both slow digestion. Something like eggs and toast with fruit, or oatmeal with protein, covers it. If your gap is under an hour, shrink it to something small and carb-forward — a banana, a slice of toast with honey — or train comfortably on nothing if that suits your stomach; a single session is never glycogen-limited by one missing meal.

Afterward, the window is real but generous: get a proper meal with 30–40g of protein and substantial carbs within a couple of hours. The "30-minute anabolic window" panic is dead science — total daily intake dwarfs timing for everyone training once a day.

The only version of this that goes wrong chronically: skipping breakfast, training hard at 9, then grazing until dinner. Under-fueled mornings compound into flat sessions and slow recovery. Eat like training matters, because it does.`,
  },
  {
    slug: 'protein-per-pound',
    category: 'nutrition',
    question: 'Do I really need 1g of protein per pound of bodyweight?',
    variants: [
      'Is 1g/lb a myth?',
      'How much protein on training days?',
      'Protein for muscle growth',
    ],
    answer: `The honest reading of the research: meaningful benefits of protein for muscle growth plateau around 1.6–2.2g per kilogram of bodyweight — which is roughly 0.7–1.0g per pound. So "1g per pound" isn't wrong; it's the generous end of right. It's a rounding-up of the science into a rule people can remember, with a built-in margin of safety.

Practical takeaways: if you're at or near 0.8g/lb consistently, you are not leaving gains on the table — consistency at 0.8 beats sporadic 1.2 every week of the year. Reasons to aim for the full 1g/lb anyway: you're in a calorie deficit (protein needs **rise** when cutting — it protects muscle), you're older (anabolic resistance raises the effective requirement), or you simply find high protein keeps you full and makes the rest of your diet easier to manage. There's no harm at these levels for healthy people.

Distribution matters mildly — three to four feedings of 25–40g beats one enormous dinner — but don't let meal-timing arithmetic obscure the only two numbers that really move outcomes: total daily protein and total daily calories.`,
  },
  {
    slug: 'high-carb-diet-athletes',
    category: 'nutrition',
    question: 'Is a high-carb diet unhealthy for a hard-training athlete?',
    variants: [
      'Worried about eating this many carbs',
      'Are carbs bad for you?',
      'Training twice a day — how many carbs?',
    ],
    answer: `The health warnings around carbohydrates come almost entirely from studies of sedentary people in calorie surplus. You are not that population. A twice-a-day athlete is a fundamentally different metabolic context: your training empties glycogen daily, your insulin sensitivity is high, and the carbs you eat are spent on performance rather than stored. For you, carbohydrate is the fuel of high-intensity work — glycolytic training literally runs on it — and chronic under-fueling shows up as flat sessions, poor recovery, disrupted sleep, and hormonal downturn long before it shows up as leanness.

Yes, all digestible carbs end up as glucose — but source still matters at the margins: mostly rice, potatoes, oats, fruit, and bread gives you micronutrients and fiber alongside the fuel; mostly candy doesn't. The old athlete's rule holds: the closer to training, the simpler the carb can be; further away, favor whole sources.

Markers worth trusting over ideology: bloodwork, body composition, energy, and performance. A high-carb athlete with good lipids, stable weight, and improving numbers has no problem to fix — regardless of what a podcast said this week.`,
  },
  {
    slug: 'fat-loss-without-wrecking-training',
    category: 'nutrition',
    question: 'Can I lose fat without wrecking my training?',
    variants: [
      'Cutting while doing CrossFit',
      'Fat loss and muscle gain at the same time?',
      'How big a deficit?',
    ],
    answer: `Yes — with a moderate deficit and a protein floor. The recipe that preserves training: eat 300–500 calories below maintenance (roughly 0.5–1% of bodyweight lost per week), hold protein at the high end (~1g per pound — it's most protective exactly when cutting), and take the deficit primarily from fat while keeping enough carbohydrate around your hardest sessions to fund them. Aggressive cuts save weeks on the calendar and cost months in lost muscle, flat workouts, and rebound.

Expect and accept: top-end power and long grinders feel slightly harder in a deficit; strength should hold or dip only mildly if protein and sleep are handled. If performance is falling off a cliff, the deficit is too deep — the scale is not the only gauge on the dashboard.

Recomposition — losing fat while gaining muscle — is genuinely available to newer athletes, the returning-from-a-break crowd, and those with more to lose; seasoned lean athletes mostly choose one direction at a time. Either way the fundamentals don't change: modest deficit, high protein, hard training, real sleep. There is no version of this that works without the last two.`,
  },

  // ── Physiology ───────────────────────────────────────────────────
  {
    slug: 'three-energy-systems',
    category: 'physiology',
    question: 'The three energy systems, explained simply',
    variants: [
      'What are the metabolic pathways?',
      'Phosphagen vs glycolytic vs oxidative',
      'Why does CrossFit train all three?',
    ],
    answer: `Your muscles spend one currency — ATP — and own three ways of earning it.

The **phosphagen system** is cash in your pocket: instant, powerful, and gone in ~10 seconds. It funds a max snatch, a short sprint, the first seconds of everything. It recharges with rest, which is why true power work demands long recovery.

The **glycolytic system** is a fast credit line: it burns carbohydrate quickly, without oxygen, funding brutal 20-second-to-2-minute efforts — but it accumulates metabolic debt (that burning, flooding feeling) that must be repaid.

The **oxidative system** is your salary: slower, but effectively unlimited while fuel and oxygen last. It funds everything long and easy — and it **pays down the debts** the other two run up. Every rest interval, every "getting your breath back," is oxidative work.

They're not switches — all three run constantly, in proportions set by intensity. Training tunes each: sprints build phosphagen power, intervals expand glycolytic capacity, volume builds the oxidative base. And because the aerobic system is the recovery engine for the other two, it's the one that quietly makes everything else better.`,
  },
  {
    slug: 'lactate-and-the-burn',
    category: 'physiology',
    question: 'What is lactate really — and what actually causes the burn?',
    variants: [
      'Does lactate cause soreness?',
      'How does the body clear lactate?',
      'Why does pH matter in workouts?',
    ],
    answer: `When you work hard enough that glycolysis outruns your aerobic system, you produce lactate — but lactate is not waste and not the cause of soreness. It's **fuel**: your heart, slow-twitch fibers, and even other muscles happily burn it. The burn you feel comes from the hydrogen ions released alongside it — accumulating acidity (falling pH) that interferes with muscle contraction and screams at your nervous system to slow down.

Clearance is an aerobic act: lactate gets shuttled to tissues that oxidize it, while your buffering systems mop up the acidity — which is why easy movement flushes you faster than sitting down; gentle work keeps blood moving through the machinery doing the cleanup. It's also why "lactate tolerance" training is really two adaptations: buffering more acid, and clearing lactate into fuel faster.

And next-day soreness? Unrelated. Lactate is back to baseline within about an hour of finishing. DOMS is micro-damage and its repair response — blame the eccentric reps, not the molecule. A bigger aerobic engine means faster clearing, quicker recovery between intervals, and more repeatable hard efforts: one more reason base training pays for everything.`,
  },
  {
    slug: 'vo2-max-and-zone-2',
    category: 'physiology',
    question: 'What are VO2 max and Zone 2 — and why does everyone keep saying "zone 2"?',
    variants: [
      'What does VO2 max actually measure?',
      'What is zone 2 training?',
      "How do I know I'm in zone 2?",
    ],
    answer: `**VO2 max** is the size of your aerobic engine: the maximum rate at which your body can take in, transport, and use oxygen. It sets the ceiling on every effort longer than a couple of minutes — you can't sustain work above what your oxygen machinery can supply. It's trained best from two directions at once: hard intervals near maximal oxygen uptake push the ceiling up, and easy volume builds the machinery underneath it.

**Zone 2** is the easy-volume side: work light enough that your oxidative system handles it entirely, hard enough to demand adaptation — roughly "the fastest pace at which you could still hold a conversation." Physiologically it maximizes mitochondrial and capillary development per unit of fatigue, which is why you can do a lot of it, week after week, without stealing from your hard days.

The reason coaches won't shut up about it: most athletes train too hard on easy days and too easy on hard days, living in a middle zone that generates fatigue faster than adaptation. Polarizing — genuinely easy most days, genuinely hard occasionally — is the most reliably successful structure in endurance science. Zone 2 isn't a trend; it's the foundation finally getting its billing.`,
  },
  {
    slug: 'neural-fatigue',
    category: 'physiology',
    question: 'Is "neural fatigue" a real thing?',
    variants: [
      'CNS fatigue — legit or broscience?',
      'Why am I weak but not sore?',
      'How long does nervous system recovery take?',
    ],
    answer: `Real, though fuzzier than gym lore pretends. What's well-established: after very intense work — maximal lifts, sprints, high-skill work under load, competition — force output can stay depressed even when muscles aren't damaged or sore. Part of that reduction is "central": the nervous system's drive to the muscle is diminished, measurable in the lab as reduced voluntary activation. The feeling is distinctive — bar speed slow at warm-up weights, reactions dull, no pop — strength gone missing without soreness to explain it.

Where broscience overreaches is the mechanism-mongering ("your CNS is fried for 10 days") and the precision. In practice, high-intensity work demanding maximal motor-unit recruitment at high frequencies **is** more centrally costly than repping moderate loads, and recovery of that sharpness can lag muscle recovery by a day or two. That's the real reason good programs space out maximal sessions and why heavy singles the day after a brutal metcon feel wooden.

Practical reading of the signals: sluggish warm-up weights and absent explosiveness = reduce intensity today, train the easy qualities. It resolves with sleep and easy days — no special protocol needed, and nobody's nervous system is "damaged" by a hard week.`,
  },
  {
    slug: 'phosphocreatine-resynthesis',
    category: 'physiology',
    question: 'What is phosphocreatine resynthesis — and can training improve it?',
    variants: [
      'How fast does PCr recover between sets?',
      'Why do sprints need long rest?',
      'Repeat sprint ability',
    ],
    answer: `Phosphocreatine (PCr) is the phosphagen system's ammunition — a small stockpile in the muscle that regenerates ATP nearly instantly, funding roughly the first 10 seconds of maximal effort. Once spent, it must be rebuilt — and here's the elegant part: **resynthesis is an aerobic process.** Oxygen-dependent metabolism refills the stockpile, on a curve: about half restored in ~30 seconds, most in 2–3 minutes, complete in 5+.

That one fact explains a surprising amount of training design. Why true power work uses rest intervals of 2–5 minutes: shorter rest means each sprint starts with a half-empty tank and quality collapses. Why repeat-sprint ability is really an **aerobic** quality: the athlete who recovers fastest between bursts is the one with the biggest oxidative engine. And why some conditioning formats pair short maximal bursts with easy aerobic work — the burst spends PCr, the aerobic system practices refilling it under realistic conditions.

Can you train it? Directly, modestly — creatine supplementation enlarges the stockpile, and sprint training improves the machinery. But the biggest lever is indirect: build the aerobic base, and every system that depends on oxygen — PCr refill included — gets faster.`,
  },
  {
    slug: 'power-vs-capacity',
    category: 'physiology',
    question: "Power vs capacity — what's the difference in conditioning?",
    variants: [
      'Am I a power athlete or endurance athlete?',
      'High output but fade fast',
      'Big engine but no top gear',
    ],
    answer: `Power is how high your output can spike; capacity is how long you can stay near it. Every energy system has both dimensions: anaerobic power (peak watts in a 10-second sprint) vs anaerobic capacity (holding ugly-hard for 60–90 seconds); aerobic power (your best 4–10 minute effort) vs aerobic capacity (the 30–60+ minute engine). They're related but separately trainable, and athletes are rarely balanced.

You can self-diagnose with numbers you already have. Compare your 10-second peak to your 2-minute pace to your 20-minute pace. A power-leaning athlete has a huge spike and a steep drop-off — wins the first interval, loses the session. A capacity-leaning athlete has a modest peak but barely fades — the diesel who can't kick.

Why it matters: the correct training is usually the opposite of your gift. Power athletes improve most from patient base and threshold volume; diesel athletes improve most from the maximal sprint work they avoid. Most athletes instinctively train their strength because it feels good — a good plan keeps the neglected half on the schedule.`,
  },

  // ── Conditioning & Pacing ────────────────────────────────────────
  {
    slug: 'faster-2-mile-5k-while-lifting',
    category: 'conditioning',
    question: 'How do I get faster at the 2-mile or 5K while still lifting?',
    variants: [
      'Cutting my 2-mile time for a test',
      'Running progression alongside strength',
      'Taking minutes off a timed run',
    ],
    answer: `A meaningful drop — say two minutes off a two-mile time over a few months — is an aerobic project with a small speed garnish, run on three quality days a week. **Day one: easy volume**, 30–45 minutes conversational, the unglamorous engine-builder — most lifters skip this run and it's the one doing the compounding. **Day two: threshold**, 15–25 total minutes at comfortably-hard (roughly the pace you could race for an hour) as cruise intervals — 3×8 minutes with short jogs. **Day three: intervals at goal pace** — e.g., 6–8×400m at target 2-mile pace with equal jog recovery, extending reps as fitness comes.

Fitting the lifting: keep two full-body strength days, put the interval run the day after (not before) heavy legs, and let the easy run float anywhere. Expect top-end leg strength to hold and bar speed to dip slightly during peak run volume — that reverses within weeks of the test.

Progress marker between test efforts: the same easy-run pace at a lower heart rate. When that moves, the race time is moving with it.`,
  },
  {
    slug: 'pacing-fran',
    category: 'conditioning',
    question: 'How should I pace Fran (and short named metcons like it)?',
    variants: [
      'Fran strategy by ability level',
      'Should I go unbroken?',
      'Why do I blow up at 21-15-9?',
    ],
    answer: `Fran — 21-15-9 thrusters (95/65) and pull-ups — punishes exactly one thing: starting like the workout is 90 seconds long when yours is five minutes. The blowup is chemical: an unbroken 21 at redline floods you with metabolic debt that the pull-ups immediately compound, and by the round of 15 you're paying interest on everything.

Pace by your reality, not the leaderboard's. **Sub-4 athletes** go unbroken or near it — for them the strategy question barely exists. **The 5–8 minute athlete** (most people) should break **before** being forced to: thrusters 12-9 or 11-10 with a three-breath pause, pull-ups in planned sets of 7-8, keeping every transition under five seconds — planned short breaks cost seconds; forced long breaks cost half-minutes. **Beyond 8 minutes**, scale — lighter bar, jumping pull-ups — because Fran's stimulus is a sprint, and a 12-minute Fran is a different (worse) workout than a 6-minute scaled one.

Universal moves: smooth first ten thrusters even when they feel free; breathe at the top of every thruster; and know your round-of-15 plan before the clock starts — that round is where Fran is won or surrendered.`,
  },
  {
    slug: 'partner-workout-strategy',
    category: 'conditioning',
    question: 'Partner workouts: how do you split the work?',
    variants: [
      'How to partition a team WOD',
      'Splitting reps in you-go-I-go',
      'Strategy for pairs workouts',
    ],
    answer: `Default rule: **short, frequent switches beat long heroic turns.** In a "split as needed" workout, the fastest teams work in small fast sets — 5–10 reps or 10–15 calories per turn — because each partner works near sprint pace and recovers while the other goes. Long turns feel productive and produce two tired athletes moving slowly.

Refinements: switch **before** slowing down — the moment your rep speed drops, the team is losing rep-per-second value; plan the split by strengths (the stronger presser eats more of the wall balls, the runner takes longer machine turns) but keep switches frequent even when uneven; on machines, account for transition cost — under ~15 calories per turn, the seat-swap eats the savings, so machine turns run a bit longer than rep turns.

For synchro portions, pace to the limiter from rep one — matching a partner mid-set is far more expensive than starting at their pace. And decide the plan **before** 3-2-1-go: teams that negotiate mid-workout donate seconds every round. Thirty seconds of strategy is worth minutes of time cap.`,
  },
  {
    slug: 'breathing-during-conditioning',
    category: 'conditioning',
    question: 'How should I breathe during hard conditioning?',
    variants: [
      'Exhale longer than inhale?',
      'Breathing rhythm on the erg',
      'I hold my breath during workouts',
    ],
    answer: `The mistakes are universal: holding the breath during effort, and shallow chest-panting during rest. Both accelerate the exact spiral you're trying to avoid.

During steady work, breathe on a **rhythm tied to the movement** — on a rower, one full breath per stroke at easy paces, exhaling on the drive; two breaths per stroke as intensity rises; on a bike, count a cadence (in for 2, out for 2). Rhythm keeps breathing mechanical instead of reactive, which is the whole game — reactive breathing is panic's front door.

Between intervals, the fastest reset is long exhales: in through the nose, out slowly through the mouth, exhale noticeably longer than the inhale. The long exhale nudges the nervous system toward "recover" and drops heart rate faster than gasping does. Two or three of those, then let breathing normalize.

Under a barbell, brace beats breath — take air before the rep, hold through the sticking point, breathe between reps. And in mixed workouts, treat transitions as breathing checkpoints: three deliberate breaths walking to the next station beats arriving one second sooner in oxygen debt.`,
  },
  {
    slug: 'training-after-illness-older-athletes',
    category: 'conditioning',
    question: 'Training as an older athlete when illness reset your HRV and resting heart rate',
    variants: [
      'Post-viral training with low HRV',
      'Resting heart rate stayed elevated after being sick',
      'Intervals cause crashes since being sick',
    ],
    answer: `When a virus durably shifts your baseline — HRV down, resting heart rate up, months later — the honest premise is that your recovery capacity has genuinely changed, at least for now, and training must meet the body where it is. What tends to work: keep or expand the **Zone 2 base** (it's the best-tolerated stimulus and the one that rebuilds autonomic balance); keep **strength work**, which most post-viral athletes tolerate far better than metabolic intensity; and reintroduce intensity in the smallest sensible doses — short strides or 20–30 second pickups inside easy sessions, long before structured 4×4s. If a Norwegian-style VO2 protocol reliably produces multi-day crashes, that's not weakness to push through; it's a dose exceeding current capacity. Shrink the dose, not the ambition.

Use your own morning numbers as the throttle: on clearly-suppressed days, train easy or not at all. Progress is measured in months — capacity that returns slowly still returns. And a persistent post-viral pattern deserves a physician's involvement alongside the programming; a coach manages the training, not the condition.`,
  },

  // ── For Coaches ──────────────────────────────────────────────────
  {
    slug: 'scaling-for-beginners',
    category: 'coaches',
    question: 'How do I scale workouts for beginners?',
    variants: [
      'Scaling principles for new athletes',
      'Same stimulus different load',
      'When to scale vs when to push',
    ],
    answer: `Scale to preserve the **stimulus**, not to shrink the workout. Every WOD has an intended experience — a time domain, an intensity, a feeling ("this should be 8 minutes of continuous movement," "these sets should break exactly once"). A correct scale delivers that experience at the athlete's current ability. A wrong scale — too heavy, too skilled — turns a conditioning piece into a strength test with rest breaks.

The scaling hierarchy, in order: reduce **load** first (the stimulus usually survives lighter weight intact); then **volume** (fewer reps to keep the time domain honest); then **movement substitution** (jumping pull-ups for pull-ups, elevated push-ups for push-ups — same pattern, accessible version); and only then structural changes.

For genuine beginners, add the standing rules: mechanics before consistency before intensity — new athletes earn intensity over weeks, not days; when in doubt, lighter and faster beats heavier and slower; and never program a beginner to failure on technical movements. The best scaling question a coach can ask: "What is this workout **supposed to feel like**?" — then engineer that feeling for the athlete in front of you.`,
  },
  {
    slug: 'virtuosity',
    category: 'coaches',
    question: 'What does "virtuosity" mean in coaching?',
    variants: [
      'Virtuosity in CrossFit',
      'Doing the common uncommonly well',
      'Why drill basics with advanced athletes?',
    ],
    answer: `Virtuosity — the term Greg Glassman borrowed from gymnastics — means **doing the common uncommonly well**: performing the fundamentals with a precision that goes beyond adequate. Not advanced movements done acceptably, but basic movements done beautifully — the air squat with perfect positions at any speed, the flawless kip swing, the push-up that would satisfy the strictest judge.

For coaches, it's a warning label about a universal temptation: the drift toward novelty. New coaches (and impatient athletes) want to teach the impressive thing — the muscle-up, the snatch complex — while the class's air squats quietly deteriorate. Glassman's point was that this drift is the mark of the amateur, and that the best coaches in any discipline are obsessive about fundamentals long after fundamentals stop being novel.

The practical coaching application: hold movement standards even when it slows a workout down; program basics prominently and coach them like they matter (because they're the layer everything else is built on); and praise quality of movement as loudly as scores. A gym where the whiteboard celebrates beautiful air squats produces better athletes — and fewer injuries — than one that only celebrates PRs.`,
  },
  {
    slug: 'class-briefing',
    category: 'coaches',
    question: 'How do I brief a class on a workout?',
    variants: [
      'Class briefing structure',
      'Explaining the stimulus to members',
      'WOD walkthrough template',
    ],
    answer: `A great briefing takes three minutes and answers four questions in order.

**What are we doing?** Read the workout, demo or point at each movement, state standards briefly (where the wall ball hits, what full extension means today).

**What should it feel like?** This is the part most coaches skip and the part members need most. Name the intended stimulus in plain words: "This is a sprint — you should finish under 8 minutes, uncomfortable the whole way," or "This is a grinder — steady pace, keep moving for all 20." Members can't hit a target they've never been shown.

**How do I pace it?** One concrete strategy: where to break sets **before** being forced to ("plan 12-8 on the pull-ups from round one"), which movement will bite ("the burpees are where this gets you"), what pace the first round should feel like.

**How do I scale it?** Announce the scaling options to the whole room — publicly, matter-of-factly — so scaling reads as intelligent, not remedial. Then name the target: "everyone should finish inside 12 minutes; pick the version of the workout that gets you there."

Then get them moving. Everything else is coached during the warm-up and the workout itself.`,
  },
  {
    slug: 'gym-challenges-and-education',
    category: 'coaches',
    question: 'Gym engagement ideas: weekly challenges and education',
    variants: [
      'Question-of-the-week ideas',
      'Monthly gym challenge ideas',
      'Skill challenges for members',
    ],
    answer: `Challenges that work share three traits: everyone can attempt them, they take under ten minutes, and they invite retesting. A rotation to steal from: accumulate a 5:00 squat hold; max-distance handstand walk (or max wall-facing hold); 2:00 max calories on any machine; dead-hang for time; max unbroken double-unders; a 500m row sprint; max strict pull-ups (banded versions welcome); broad jump for distance; a Turkish get-up ladder going up in load. Post a leaderboard alongside a "most improved" track — the retest story is what keeps average members engaged.

Education questions that spark real gym-floor conversation: "Why do your legs burn but your lungs recover first?" · "What's the difference between soreness and injury?" · "Why does the workout say 20 minutes easy instead of as fast as possible?" · "What does the damper actually change?" · "Why do we squat below parallel?" Post the question Monday, collect answers all week, give the coach's answer Friday — a small ritual that makes members students of the sport, which is exactly what retains them.`,
  },
];

/** Lookup by slug; undefined when the slug isn't published. */
export function findQAEntry(slug: string): QAEntry | undefined {
  return QA_ENTRIES.find((e) => e.slug === slug);
}

/**
 * Token-AND search over question + variants + category label.
 * Every whitespace-separated token must appear somewhere (case-insensitive).
 */
export function searchQAEntries(query: string): QAEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return QA_ENTRIES;
  return QA_ENTRIES.filter((e) => {
    const haystack = [e.question, ...e.variants, QA_CATEGORIES[e.category]]
      .join(' ')
      .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}
