/**
 * Day archetype specifications.
 *
 * Five archetypes drive the AI Programming generator. Each defines:
 *   - blocks: the ordered list of blocks that day contains (drives the
 *     skeleton emitter and parser-side block_type expectations)
 *   - displayLabel: how the archetype appears to the user ("Strength Day")
 *   - default total session minutes
 *   - per-block time allocations (used in prompt rules; UI may also surface)
 *   - purpose statement (one-liner for prompt context)
 *
 * The block_type values here MUST match the strings stored on
 * program_workout_blocks.block_type. Existing tracked values:
 *   'warm-up', 'mobility', 'skills', 'strength', 'metcon',
 *   'cool-down', 'accessory', 'active-recovery'
 *
 * 'active-recovery' is the Recovery Day's easy-movement block — parses
 * separately from warm-up / cool-down because it has different time,
 * purpose, and user-logging expectations.
 */

export type DayArchetype = "strength" | "metcon" | "fitness" | "skill" | "recovery";

export interface BlockSpec {
  /** block_type stored in program_workout_blocks */
  type: string;
  /** Header text emitted in the program text and parsed back */
  header: string;
  /** Suggested time allocation in minutes (min, max) */
  minutes: [number, number];
  /** One-liner for prompt context */
  purpose: string;
}

export interface ArchetypeSpec {
  archetype: DayArchetype;
  displayLabel: string;
  defaultTotalMinutes: number;
  purpose: string;
  blocks: BlockSpec[];
}

export const ARCHETYPES: Record<DayArchetype, ArchetypeSpec> = {
  strength: {
    archetype: "strength",
    displayLabel: "Strength Day",
    defaultTotalMinutes: 75,
    purpose: "Max strength, compound lift focus, neural/CNS demand. The hardest lifting day of the week.",
    blocks: [
      {
        type: "warm-up",
        header: "Warm-up & Mobility",
        minutes: [12, 15],
        purpose: "Extended warm-up for heavy lifting, lift-specific activation.",
      },
      {
        type: "strength",
        header: "Strength",
        minutes: [30, 40],
        purpose: "Primary compound lift, heavy scheme (5x3 @85%, clusters, tempo). Adequate rest. The main event.",
      },
      {
        type: "accessory",
        header: "Accessory",
        minutes: [15, 20],
        purpose: "Higher accessory volume than other days. Hypertrophy + at least one midline. Targets muscle groups not hit by today's primary lift.",
      },
      {
        type: "cool-down",
        header: "Cool down",
        minutes: [5, 8],
        purpose: "Longer cool-down — heavy lifting day demands it. Foam roll + 3-4 stretches.",
      },
    ],
  },

  metcon: {
    archetype: "metcon",
    displayLabel: "Metcon Day",
    defaultTotalMinutes: 60,
    purpose: "Glycolytic / metabolic conditioning, work capacity. Time domain rotates across the week.",
    blocks: [
      {
        type: "warm-up",
        header: "Warm-up & Mobility",
        minutes: [10, 12],
        purpose: "Gradually raise heart rate, rehearse metcon movements at low intensity.",
      },
      {
        type: "skills",
        header: "Skills",
        minutes: [5, 8],
        purpose: "Brief primer — NOT heavy progression work. Activation or movement rehearsal for the metcon.",
      },
      {
        type: "metcon",
        header: "Metcon",
        minutes: [15, 25],
        purpose: "The main event. Single time-domain target (short / medium / long). Complement nearby Strength Day movements.",
      },
      {
        type: "cool-down",
        header: "Cool down",
        minutes: [5, 10],
        purpose: "Active recovery walk or easy bike + stretches for taxed areas.",
      },
    ],
  },

  fitness: {
    archetype: "fitness",
    displayLabel: "Fitness Day",
    defaultTotalMinutes: 75,
    purpose: "Balanced stimulus across strength, skills, conditioning. Every domain gets exposure.",
    blocks: [
      {
        type: "warm-up",
        header: "Warm-up & Mobility",
        minutes: [10, 15],
        purpose: "General prep + 2-3 targeted drills matched to the day's primary work.",
      },
      {
        type: "skills",
        header: "Skills",
        minutes: [8, 12],
        purpose: "1 skill from Needs Attention or Intermediate bucket. Progression work, not to failure.",
      },
      {
        type: "strength",
        header: "Strength",
        minutes: [15, 20],
        purpose: "One primary compound lift. 3-5 working sets at 75-85% 1RM.",
      },
      {
        type: "accessory",
        header: "Accessory",
        minutes: [8, 12],
        purpose: "2-3 movements including at least one midline.",
      },
      {
        type: "metcon",
        header: "Metcon",
        minutes: [10, 20],
        purpose: "Varied time domain. Mixed modal, 2-3 movements. Moderate intensity.",
      },
      {
        type: "cool-down",
        header: "Cool down",
        minutes: [3, 5],
        purpose: "Easy walk or bike + 2-3 stretches.",
      },
    ],
  },

  skill: {
    archetype: "skill",
    displayLabel: "Skill Day",
    defaultTotalMinutes: 65,
    purpose: "Gymnastics and skill progression focus. Real skill acquisition happens here.",
    blocks: [
      {
        type: "warm-up",
        header: "Warm-up & Mobility",
        minutes: [12, 15],
        purpose: "Gymnastic-specific prep — scap activation, hollow/arch holds, wrist mobility.",
      },
      {
        type: "skills",
        header: "Skills",
        minutes: [25, 30],
        purpose: "The main event. 2-3 skill tracks in rotation. Deep progression work with a test set at the end.",
      },
      {
        type: "strength",
        header: "Strength",
        minutes: [15, 20],
        purpose: "Secondary lift that supports the day's skill work (e.g., strict press on HSPU day). Moderate volume at 70-80%.",
      },
      {
        type: "cool-down",
        header: "Cool down",
        minutes: [5, 5],
        purpose: "Stretch areas taxed by skill work — shoulders, wrists, lats, hip flexors.",
      },
    ],
  },

  recovery: {
    archetype: "recovery",
    displayLabel: "Recovery Day",
    defaultTotalMinutes: 35,
    purpose: "Active recovery — blood flow, parasympathetic recovery, movement without intensity. This is NOT aerobic training (that's Engine's job).",
    blocks: [
      {
        type: "warm-up",
        header: "Warm-up & Mobility",
        minutes: [10, 10],
        purpose: "Joint-by-joint opening + foam rolling on chronic tight areas. This is the main mobility session of the week.",
      },
      {
        type: "active-recovery",
        header: "Active Recovery",
        minutes: [20, 30],
        purpose: "Low-intensity movement at conversational pace. Easy walk / easy bike / light row / yoga flow / mobility circuit. If breathing hard, slow down. Purpose is blood flow and parasympathetic recovery — NOT training stimulus.",
      },
      {
        type: "cool-down",
        header: "Cool down",
        minutes: [5, 5],
        purpose: "Static stretches on chronic tight spots + 2-3 min slow nasal breathing.",
      },
    ],
  },
};

export function getArchetype(name: DayArchetype): ArchetypeSpec {
  return ARCHETYPES[name];
}

/** All block headers across all archetypes — for parser registration. */
export const ALL_BLOCK_HEADERS = [
  "Warm-up & Mobility",
  "Skills",
  "Strength",
  "Accessory",
  "Metcon",
  "Active Recovery",
  "Cool down",
] as const;
