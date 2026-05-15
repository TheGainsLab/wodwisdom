/**
 * equipment-movements.ts
 *
 * Static map: which movements are blocked when the athlete doesn't have
 * each equipment piece. Used by build-writer-payload to expand the 18-key
 * boolean equipment map into a list of movements the writer must avoid.
 *
 * Display names match the canonical movement-name conventions used by the
 * v2 writer payload elsewhere (e.g. SKILL_DISPLAY_NAMES).
 *
 * Coverage philosophy: enumerate the common variants the writer is most
 * likely to reach for. Not exhaustive — if a movement name isn't here it
 * won't be filtered, but the prompt-level guidance + injury filter still
 * apply.
 *
 * Note: treadmill is intentionally empty. Running can happen outside;
 * not having a treadmill doesn't ban running.
 */

export const EQUIPMENT_TO_MOVEMENTS: Record<string, string[]> = {
  // Cardio machines — these block their dedicated movements.
  rower: ["Row", "Calorie Row", "1k Row", "2k Row", "5k Row"],
  assault_bike: ["Assault Bike", "Echo Bike", "Bike Calories", "Bike Erg"],
  ski_erg: ["Ski Erg", "Ski Calories"],
  treadmill: [],

  // Barbell & free weights.
  barbell: [
    "Back Squat", "Front Squat", "Overhead Squat",
    "Deadlift", "Romanian Deadlift", "Sumo Deadlift",
    "Snatch", "Power Snatch", "Hang Snatch", "Squat Snatch", "Snatch Pull", "Snatch Balance",
    "Clean", "Power Clean", "Hang Clean", "Squat Clean", "Clean Pull",
    "Clean and Jerk", "Jerk", "Push Jerk", "Split Jerk", "Push Press",
    "Press", "Strict Press", "Bench Press",
    "Thruster", "Bear Complex", "Floor Press",
  ],
  dumbbells: [
    "Dumbbell Snatch", "Dumbbell Clean", "Dumbbell Thruster",
    "Dumbbell Press", "Dumbbell Bench Press", "Dumbbell Row",
    "Devil Press", "Man Maker",
    "Dumbbell Lunge", "Dumbbell Step-Up", "Dumbbell Front Squat",
    "Renegade Row",
  ],
  kettlebells: [
    "Kettlebell Swing", "Kettlebell Snatch", "Kettlebell Clean",
    "Kettlebell Press", "Kettlebell Thruster",
    "Turkish Get-Up", "Goblet Squat", "Farmer Carry",
  ],

  // Gymnastics rigs.
  pull_up_bar: [
    "Pull-Up", "Strict Pull-Up", "Kipping Pull-Up", "Butterfly Pull-Up",
    "Chest-to-Bar Pull-Up", "Bar Muscle-Up",
    "Toes-to-Bar", "Knees-to-Elbow",
    "Hanging Leg Raise", "Hanging L-Sit",
  ],
  rings: [
    "Ring Row", "Ring Dip", "Muscle-Up", "Strict Ring Muscle-Up",
    "Ring Push-Up", "Ring Support Hold", "Strict Ring Dip",
  ],
  rope: ["Rope Climb", "Legless Rope Climb"],
  ghd: ["GHD Sit-Up", "GHD Back Extension"],
  parallettes: ["Parallette Push-Up", "L-Sit on Parallettes", "Stalder Press"],
  pegboard: ["Pegboard Climb"],

  // Other.
  box: ["Box Jump", "Box Jump-Over", "Step-Up", "Box Step-Up", "Box Squat"],
  wall_ball: ["Wall Ball", "Wall Ball Shot"],
  sled: ["Sled Push", "Sled Pull", "Prowler Push"],
  blocks: ["Block Snatch", "Block Clean", "Block Deadlift"],
  bands: ["Banded Pull-Apart", "Banded Squat", "Banded Pull-Through", "Banded Good Morning", "Band-Assisted Pull-Up"],
};

/**
 * Given the athlete's equipment booleans, return the deduplicated sorted
 * list of movements they should NOT be programmed because they lack the
 * required equipment.
 */
export function computeEquipmentBlockedMovements(
  equipment: Record<string, boolean>,
): string[] {
  const blocked = new Set<string>();
  for (const [key, hasIt] of Object.entries(equipment)) {
    if (hasIt) continue;
    const movements = EQUIPMENT_TO_MOVEMENTS[key] ?? [];
    for (const m of movements) blocked.add(m);
  }
  return Array.from(blocked).sort();
}
