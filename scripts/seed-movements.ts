/**
 * Seed the movements table from competition JSON + recognition-only movements.
 *
 * Usage:
 *   1. Place competition data in supabase/seed/competition-exercises.json
 *      (array of { exercise_name, slug } objects)
 *   2. Run: npx tsx scripts/seed-movements.ts
 *   3. Copy the SQL output and run in Supabase SQL Editor
 *
 * Or with inline data: npx tsx scripts/seed-movements.ts < path/to/competition.json
 */

import { readFileSync } from "fs";
import { resolve } from "path";

interface CompetitionRow {
  exercise_name: string;
  slug: string;
  workout_id?: string;
  workout_name?: string;
  format?: string;
  task_json?: unknown;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-–]\s*/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[&]/g, "and")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "unknown";
}

// Map competition exercise_name variants to canonical (aligns with analyzer)
const CANONICAL_MAP: Record<string, string> = {
  "double-under": "double_under",
  "double unders": "double_under",
  "power snatch": "power_snatch",
  "deadlift": "deadlift",
  "push-up": "push_up",
  "push up": "push_up",
  "box jump": "box_jump",
  "box jumps": "box_jump",
  "squat clean": "squat_clean",
  "jerk": "jerk",
  "bar-facing burpee": "bar_facing_burpee",
  "bar facing burpee": "bar_facing_burpee",
  "overhead squat": "overhead_squat",
  "muscle-up": "muscle_up",
  "muscle up": "muscle_up",
  "chest to bar pull-up": "chest_to_bar",
  "chest-to-bar pull-up": "chest_to_bar",
  "chest to bar pull up": "chest_to_bar",
  "wall ball": "wall_ball",
  "wall balls": "wall_ball",
  "thruster": "thruster",
  "clean and jerk": "clean_and_jerk",
  "clean & jerk": "clean_and_jerk",
  "snatch": "snatch",
  "push press": "push_press",
  "shoulder to overhead": "shoulder_to_overhead",
  "row": "row",
  "clean": "clean",
  "overhead walking lunge": "overhead_walking_lunge",
  "burpee box jump-over": "burpee_box_jump_over",
  "burpee box jump over": "burpee_box_jump_over",
  "dumbbell snatch": "dumbbell_snatch",
  "bar muscle-up": "bar_muscle_up",
  "bar muscle up": "bar_muscle_up",
  "squat snatch": "squat_snatch",
  "weighted walking lunge": "weighted_walking_lunge",
  "power clean": "power_clean",
  "handstand push-up": "handstand_push_up",
  "handstand push up": "handstand_push_up",
  "ring muscle-up": "ring_muscle_up",
  "ring muscle up": "ring_muscle_up",
  "dumbbell squat": "dumbbell_squat",
  "dumbbell hang clean and jerk": "dumbbell_hang_clean_and_jerk",
  "strict handstand push-up": "strict_hspu",
  "strict handstand push up": "strict_hspu",
  "handstand walk": "handstand_walk",
  "ground to overhead": "ground_to_overhead",
  "dumbbell thruster": "dumbbell_thruster",
  "alternating pistol squat": "pistol",
  "alternating pistol": "pistol",
  "wall walk": "wall_walk",
  "burpee pull-up": "burpee_pull_up",
  "shuttle run": "shuttle_run",
  "pull-up": "pull_up",
  "pull up": "pull_up",
  "box jump-over": "box_jump_over",
  "box jump over": "box_jump_over",
  "lateral burpee over dumbbell": "lateral_burpee_over_dumbbell",
  "dumbbell hang clean to overhead": "dumbbell_hang_clean_to_overhead",
  "walking lunge": "walking_lunge",
  "ghd sit-up": "ghd_sit_up",
  "ghd sit up": "ghd_sit_up",
  "rope climb": "rope_climb",
  "rope climbs": "rope_climb",
  "dumbbell walking lunge": "dumbbell_walking_lunge",
  "deficit handstand push-up": "deficit_hspu",
  "dumbbell front rack walking lunge": "dumbbell_front_rack_walking_lunge",
  "single-arm dumbbell snatch": "dumbbell_snatch",
  "single-arm overhead walking lunge": "overhead_walking_lunge",
  "crossover": "crossover",
  "lateral burpee box jump-over": "lateral_burpee_over_dumbbell",
  "chest to wall handstand push-up": "chest_to_wall_hspu",
  "v-up": "v_up",
  "run": "run",
  "kettlebell swing": "kettlebell_swing",
  "one-arm dumbbell snatch": "dumbbell_snatch",
  "one arm dumbbell snatch": "dumbbell_snatch",
  "dumbbell ground to overhead": "dumbbell_ground_to_overhead",
  "sprint": "run",
  "back squat": "back_squat",
  "front squat": "front_squat",
  "burpee muscle-up": "burpee_muscle_up",
  "hang squat snatch": "hang_squat_snatch",
  "hang power clean": "hang_power_clean",
  "legless rope ascent": "legless_rope_climb",
  "legless rope climb": "legless_rope_climb",
  "ring dip": "ring_dip",
  "strict muscle-up": "muscle_up",
  "kettlebell snatch": "kettlebell_snatch",
  "chest-to-bar pull-up": "chest_to_bar",
  "bike": "bike",
  "dumbbell farmer carry": "farmer_carry",
  "burpee box jump": "burpee_box_jump",
  "obstacle handstand walk": "handstand_walk",
  "dumbbell box step-over": "dumbbell_box_step_up",
  "dumbbell box step-up": "dumbbell_box_step_up",
  "right-arm dumbbell overhead lunge": "dumbbell_overhead_lunge",
  "left-arm dumbbell overhead lunge": "dumbbell_overhead_lunge",
  "max squat clean & jerk": "squat_clean_and_jerk",
  "dumbbell shoulder to overhead": "dumbbell_shoulder_to_overhead",
  "axle shoulder to overhead": "shoulder_to_overhead",
  "axle front rack walking lunge": "front_rack_walking_lunge",
  "dumbbell overhead lunge": "dumbbell_overhead_lunge",
  "assault bike": "assault_bike",
};

// Load modality from curated mapping (source of truth for W/G/M)
function loadModalityMap(): Record<string, "W" | "G" | "M"> {
  const path = resolve(process.cwd(), "supabase/seed/movement-modalities.json");
  const map: Record<string, "W" | "G" | "M"> = {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    for (const [key, val] of Object.entries(raw)) {
      if (key.startsWith("_") || typeof val !== "string") continue;
      if (val === "W" || val === "G" || val === "M") map[key] = val;
    }
  } catch (err) {
    console.error("Could not load movement-modalities.json:", err);
  }
  return map;
}

// Fallback when canonical is not in movement-modalities.json
function inferModality(canonical: string): "W" | "G" | "M" {
  const m = canonical.toLowerCase();
  if (
    m.includes("row") || m.includes("run") || m.includes("bike") ||
    m.includes("swim") || m.includes("ski") || m.includes("shuttle") ||
    m.includes("sprint") || m.includes("crossover") || m === "run"
  )
    return "M";
  if (
    m.includes("burpee") || m.includes("push_up") || m.includes("pull_up") ||
    m.includes("muscle_up") || m.includes("toes_to_bar") || m.includes("chest_to_bar") ||
    m.includes("box_jump") || m.includes("wall_ball") || m.includes("double_under") ||
    m.includes("rope_climb") || m.includes("handstand") || m.includes("pistol") ||
    (m.includes("lunge") && !m.includes("overhead") && !m.includes("walking")) ||
    m.includes("dip") || m.includes("ghd") || m.includes("v_up") ||
    m.includes("wall_walk") || m.includes("ring_muscle") || m.includes("bar_muscle") ||
    m.includes("l_sit") || m.includes("knee_raise") || m.includes("jumping_jack")
  )
    return "G";
  return "W";
}

function inferCategory(modality: "W" | "G" | "M"): string {
  return modality === "W" ? "Weightlifting" : modality === "G" ? "Gymnastics" : "Monostructural";
}

function toDisplayName(canonical: string): string {
  return canonical
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Recognition-only movements (competition_count = 0) — modality comes from movement-modalities.json
const RECOGNITION_ONLY = [
  "turkish_get_up", "tgu", "goblet_squat", "farmer_carry", "sdhp", "sumo_deadlift_high_pull",
  "kettlebell_swing", "kb_swing", "single_under", "jump_rope", "jumping_jack",
  "echo_bike", "ski_erg", "swim", "swimming",
];

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

function main() {
  const modalityMap = loadModalityMap();
  const getModality = (canonical: string) =>
    modalityMap[canonical] ?? inferModality(canonical);

  const seedPath = resolve(process.cwd(), "supabase/seed/competition-exercises.json");
  let rows: CompetitionRow[] = [];

  try {
    const raw = readFileSync(seedPath, "utf-8");
    const data = JSON.parse(raw);
    rows = Array.isArray(data) ? data : [];
  } catch {
    console.error("Could not read supabase/seed/competition-exercises.json. Using recognition-only movements.");
  }

  // Build aggregates from competition data
  const byCanonical = new Map<
    string,
    { slugs: Set<string>; aliases: Set<string>; displayName: string }
  >();

  for (const row of rows) {
    const name = (row.exercise_name || "").trim();
    if (!name || name.toLowerCase() === "rest") continue;

    const key = name.toLowerCase().replace(/\s+/g, " ").trim();
    const canonical =
      CANONICAL_MAP[key] ?? CANONICAL_MAP[name] ?? slugify(name);

    let entry = byCanonical.get(canonical);
    if (!entry) {
      entry = {
        slugs: new Set(),
        aliases: new Set(),
        displayName: toDisplayName(canonical),
      };
      byCanonical.set(canonical, entry);
    }
    entry.slugs.add(row.slug);
    if (name !== entry.displayName && name !== canonical.replace(/_/g, " ")) {
      entry.aliases.add(name);
    }
  }

  // Add recognition-only
  for (const canonical of RECOGNITION_ONLY) {
    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, {
        slugs: new Set(),
        aliases: new Set(),
        displayName: toDisplayName(canonical),
      });
    }
  }

  // Emit SQL — modality from movement-modalities.json, fallback to inference
  const values: string[] = [];
  const unmapped: string[] = [];
  for (const [canonical, entry] of byCanonical.entries()) {
    const modality = getModality(canonical);
    if (!modalityMap[canonical]) unmapped.push(canonical);
    const category = inferCategory(modality);
    const count = entry.slugs.size;
    const aliases = JSON.stringify([...entry.aliases]);
    const display = entry.displayName;
    values.push(
      `  ('${escapeSql(canonical)}', '${escapeSql(display)}', '${modality}', '${escapeSql(category)}', '${escapeSql(aliases)}'::jsonb, ${count})`
    );
  }
  if (unmapped.length > 0) {
    console.error("Movements not in movement-modalities.json (using inference):", unmapped.join(", "));
  }

  const sql = `-- Seed movements (run in Supabase SQL Editor)
INSERT INTO movements (canonical_name, display_name, modality, category, aliases, competition_count)
VALUES
${values.join(",\n")}
ON CONFLICT (canonical_name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  modality = EXCLUDED.modality,
  category = EXCLUDED.category,
  aliases = EXCLUDED.aliases,
  competition_count = EXCLUDED.competition_count;
`;
  console.log(sql);
}

main();
