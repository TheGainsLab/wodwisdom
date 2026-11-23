// deno test supabase/functions/_shared/profile-on-file_test.ts --no-check --allow-env --allow-read
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProfileOnFileBlock, flattenIntake, PROFILE_ON_FILE_COLUMNS } from "./profile-on-file.ts";

const FULL = {
  days_per_week: 4,
  session_length_minutes: 45,
  units: "kg",
  height: 180,
  bodyweight: 82,
  goal: "Get strong. " + "And fitter. ".repeat(60) + "Nov 2026 update: strict HSPU first.",
  engine_goal: "Row a 2k under 7:00",
  engine_program_version: "main_5day",
  injuries_constraints: "Left knee: no running. " + "Careful with depth. ".repeat(15) + "ALSO right shoulder: no overhead pressing.",
  injuries_structured: { summary: "knee, shoulder", do_not_program: ["Running", "Strict Press"], suggested_subs: [] },
  injuries_constraints_hash: "h1",
  injuries_avoidance_confirmed: null,
  equipment: { rower: false, rope: false, barbell: true },
  coaching_intake_raw: { anything_else: "I love long chippers.\nHate burpees.", history: "" },
  coaching_intake: {
    coaching_intake_version: "v1",
    preferences: { loved: ["long chippers"], disliked: ["burpees"], skill_goals: [], avoid: [] },
    self_assessment: { perceived_strengths: [], perceived_weaknesses: [], weak_time_domain: null, weak_bucket: null },
    history: { training_age: "6 years", background: null, typical_week: null, past_worked: null, past_failed: null },
    goals: { success_3_6mo: null, competes: false, events: [] },
    constraints: { injuries: [], schedule_equipment_notes: null },
    response: { volume_tolerance: null, recovery_notes: null },
    freeform_notes: null,
  },
};

Deno.test("the block carries every setting the coach could not see: session length, height, equipment, avoid list, signup answers", () => {
  const b = buildProfileOnFileBlock(FULL);
  assert(b.startsWith("\n\nPROFILE ON FILE"));
  assert(b.includes("- Days per week (AI Programming): 4"));
  assert(b.includes("- Session length: 45 minutes"));
  assert(b.includes("- Units: kg"));
  assert(b.includes("- Height: 180 cm · Bodyweight: 82 kg"));
  assert(b.includes("- Equipment they have unticked (don't have): Rower, Climbing Rope"));
  assert(b.includes("- Equipment they have: Assault/Echo Bike, Ski Erg"));
  assert(b.includes('Anything else we should know? "I love long chippers. Hate burpees."'));
  assert(b.includes("preferences, loved: long chippers; preferences, disliked: burpees; history, training age: 6 years; goals, competes: no"));
});

Deno.test("the goal and the injury note are whole: the end of each is there", () => {
  const b = buildProfileOnFileBlock(FULL);
  assert(FULL.goal.length > 500 && FULL.injuries_constraints.length > 200);
  assert(b.includes("Nov 2026 update: strict HSPU first."));
  assert(b.includes("ALSO right shoulder: no overhead pressing."));
});

Deno.test("the Engine goal is shown only when it differs from the goal", () => {
  assert(buildProfileOnFileBlock(FULL).includes('- Engine goal (differs from the goal above): "Row a 2k under 7:00"'));
  assert(!buildProfileOnFileBlock({ ...FULL, engine_goal: FULL.goal }).includes("Engine goal"));
  // Cleared on the Engine dashboard while the profile goal stays: said, for an Engine athlete.
  assert(buildProfileOnFileBlock({ ...FULL, engine_goal: null }).includes("- Engine goal (differs from the goal above): none saved"));
  assert(!buildProfileOnFileBlock({ ...FULL, engine_goal: null, engine_program_version: null }).includes("Engine goal"));
});

Deno.test("the avoid list says which movements come from the injury note and which from missing equipment", () => {
  const b = buildProfileOnFileBlock(FULL);
  const injuryLine = b.split("\n").find((l) => l.startsWith("- Avoid list, from their injury note:"))!;
  const equipLine = b.split("\n").find((l) => l.startsWith("- Avoid list, from equipment they don't have:"))!;
  assert(injuryLine.includes("Running") && injuryLine.includes("Strict Press"));
  assert(!equipLine.includes("Strict Press"));
  // No rower and no rope: the movements that need them are on the equipment line, not the injury line.
  assert(/row/i.test(equipLine) && /rope climb/i.test(equipLine), equipLine);
  assert(!/rope climb/i.test(injuryLine));
});

Deno.test("an empty session length is said to be 60 (what the generator uses), and empties are stated, not dumped", () => {
  const b = buildProfileOnFileBlock({ units: null, equipment: {} });
  assert(b.includes("- Session length: 60 minutes (none saved; 60 is what the program is built to)"));
  assert(b.includes("- Days per week (AI Programming): not set"));
  assert(b.includes("- Units: lbs"));
  assert(b.includes("- Height: not set · Bodyweight: not set"));
  assert(b.includes("- Goal (whole, their words): none saved"));
  assert(b.includes("- Injury note (whole, their words): none saved"));
  assert(b.includes("- Equipment: checklist not reviewed yet"));
  assert(b.includes("- Avoid list, from their injury note: none"));
  assert(b.includes("- Signup answers: none saved"));
  assert(!b.includes("null") && !b.includes("{") && !b.includes("undefined"));
});

Deno.test("no profile row: no block", () => {
  assertEquals(buildProfileOnFileBlock(null), "");
});

Deno.test("signup facts: only fields that hold something, never nulls, empty lists or the version stamp", () => {
  assertEquals(flattenIntake(FULL.coaching_intake), [
    "preferences, loved: long chippers",
    "preferences, disliked: burpees",
    "history, training age: 6 years",
    "goals, competes: no",
  ]);
  assertEquals(flattenIntake(null), []);
  assertEquals(flattenIntake({ freeform_notes: " trains at 5am " }), ["freeform notes: trains at 5am"]);
});

Deno.test("compact: a full profile stays a short block with no raw JSON objects", () => {
  const b = buildProfileOnFileBlock(FULL);
  assert(b.split("\n").length <= 16, String(b.split("\n").length));
  assert(!b.includes("{") && !b.includes("null"));
});

Deno.test("every chat builds the block: chat selects its columns and puts it in the athlete context", () => {
  const chat = Deno.readTextFileSync(new URL("../chat/index.ts", import.meta.url));
  // The chat's one profile read names every column the block reads.
  const select = chat.match(/\.from\("athlete_profiles"\)\s*(?:\/\/.*\n\s*)*\.select\("([^"]+)"\)\s*\.eq\("user_id", user\.id\)/)?.[1] ?? "";
  const selected = select.split(",").map((c) => c.trim());
  for (const col of PROFILE_ON_FILE_COLUMNS) assert(selected.includes(col), `chat does not select ${col}`);
  assertEquals(new Set(selected).size, selected.length); // no column named twice
  assert(chat.includes("profileOnFile = buildProfileOnFileBlock(athleteProfile);"));
  // One string for general, program-day and Engine-day chat: the block is in it, unconditionally.
  const athlete = chat.slice(chat.indexOf("const systemAthlete ="), chat.indexOf("COACH_NOTE_PROMPT;"));
  assert(/athleteProfile\?\.age\) \+\n(\s*\/\/.*\n)*\s*profileOnFile \+/.test(athlete));
  for (const col of ["session_length_minutes", "height", "equipment", "injuries_structured", "injuries_avoidance_confirmed", "coaching_intake", "coaching_intake_raw"]) {
    assert((PROFILE_ON_FILE_COLUMNS as readonly string[]).includes(col), col);
  }
});
