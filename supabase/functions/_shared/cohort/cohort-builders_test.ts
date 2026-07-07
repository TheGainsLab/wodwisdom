// deno test supabase/functions/_shared/cohort/cohort-builders_test.ts --allow-env --no-check
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildGymCohortEnvelope, mapSlidersToDesign, type GymCohortConfig } from "./build-gym-cohort-envelope.ts";
import { buildCohortRoster } from "./build-cohort-roster.ts";
import { computeCohortScaling } from "../engine/cohort.ts";
import { getDomainPack } from "../domain-packs/registry.ts";
import type { WriterOutput } from "../v2-output-schema.ts";

const NOW = "2026-07-03T00:00:00.000Z";
const VOCAB = ["Back Squat", "Snatch", "Row (Calories)"];

const CONFIG: GymCohortConfig = {
  days_per_week: 5,
  session_length_minutes: 60,
  equipment: ["rower", "barbell", "dumbbells", "pull_up_bar"],
  target_level: "intermediate",
  do_not_program: [],
  units: "lbs",
};

Deno.test("buildGymCohortEnvelope: valid shared payload + conditioning-forward tdi", () => {
  const { shared_payload, shared_training_design_input } = buildGymCohortEnvelope(CONFIG, VOCAB, NOW);

  // Reference lifts are derived + positive; equipment reflects config; vocab passed through.
  assert((shared_payload.lifts.back_squat ?? 0) > 0, "reference back_squat should be positive");
  assertEquals(shared_payload.equipment.rower, true);
  assertEquals(shared_payload.equipment.ghd, false);
  assertEquals(shared_payload.vocabulary, VOCAB);
  assertEquals(shared_payload.training_context.days_per_week, 5);
  assertEquals(shared_payload.athlete_model.created_at, NOW);

  // Deterministic cohort strategy: mixed-modal conditioning is the top priority.
  assertEquals(shared_training_design_input.priorities[0].focus, "mixed_modal_conditioning");
  assertEquals(shared_training_design_input.days_per_week, 5);
  assertEquals(shared_training_design_input.strength_emphasis, "balanced");
});

Deno.test("target_level scales reference loads (advanced > intermediate > beginner)", () => {
  const bs = (lvl: GymCohortConfig["target_level"]) =>
    buildGymCohortEnvelope({ ...CONFIG, target_level: lvl }, VOCAB, NOW).shared_payload.lifts.back_squat ?? 0;
  assert(bs("advanced") > bs("intermediate"));
  assert(bs("intermediate") > bs("beginner"));
});

Deno.test("reference lifts are self-consistent with the canonical inter-lift ratios (no self-flag)", () => {
  // The #6 fix: reference lifts derive from THRESHOLDS_V1, not a fourth standards
  // table, so the synthesized reference athlete sits at-standard on every ratio
  // buildAthleteModel checks — snatch/back_squat lands on the canonical 0.60, not 0.5625.
  const { shared_payload } = buildGymCohortEnvelope(CONFIG, VOCAB, NOW);
  const { back_squat, snatch, deadlift, clean_and_jerk } = shared_payload.lifts;
  assert(back_squat && snatch && deadlift && clean_and_jerk, "core reference lifts present");
  assert(Math.abs((snatch! / back_squat!) - 0.60) < 0.02, "snatch:back_squat ≈ canonical 0.60");
  assert(Math.abs((deadlift! / back_squat!) - 1.30) < 0.02, "deadlift:back_squat ≈ canonical 1.30");
  assert(Math.abs((clean_and_jerk! / back_squat!) - 0.80) < 0.02, "C&J:back_squat ≈ canonical 0.80");
});

Deno.test("buildCohortRoster: maps intake to slim AthleteInput", () => {
  const roster = buildCohortRoster([
    { athlete_ref: "u1", gender: "female", units: "lbs", lifts: { back_squat: 205 }, do_not_program: ["Snatch"] },
  ], NOW);
  assertEquals(roster.length, 1);
  assertEquals(roster[0].athlete_ref, "u1");
  assertEquals(roster[0].payload.lifts.back_squat, 205);
  assertEquals(roster[0].payload.basics.gender, "female");
  assertEquals(roster[0].payload.training_context.injuries_structured?.do_not_program, ["Snatch"]);
});

Deno.test("buildCohortRoster: empty roster → empty AthleteInput[] (F5 shared-program path)", () => {
  assertEquals(buildCohortRoster([], NOW), []);
});

Deno.test("buildCohortRoster: lift coercion drops zero/negative/non-finite 1RMs (asLiftValue parity)", () => {
  const [m] = buildCohortRoster([{
    athlete_ref: "u1",
    lifts: {
      back_squat: 300,          // valid
      deadlift: 0,              // zero → null
      snatch: -50,              // negative → null
      clean: Number.NaN,        // non-finite → null
      press: Number.POSITIVE_INFINITY, // non-finite → null
    } as Record<string, number>,
  }], NOW);
  assertEquals(m.payload.lifts.back_squat, 300);
  assertEquals(m.payload.lifts.deadlift, null);
  assertEquals(m.payload.lifts.snatch, null);
  assertEquals(m.payload.lifts.clean, null);
  assertEquals(m.payload.lifts.press, null);
});

Deno.test("buildCohortRoster: dedupes duplicate athlete_ref (first wins) — no UNIQUE collision", () => {
  const roster = buildCohortRoster([
    { athlete_ref: "u1", lifts: { back_squat: 200 } },
    { athlete_ref: "u1", lifts: { back_squat: 999 } },
    { athlete_ref: "u2", lifts: { back_squat: 150 } },
  ], NOW);
  assertEquals(roster.length, 2);
  assertEquals(roster[0].payload.lifts.back_squat, 200); // first wins
  assertEquals(roster[1].athlete_ref, "u2");
});

Deno.test("end-to-end deterministic scaling: envelope + roster + computeCohortScaling", () => {
  const pack = getDomainPack("crossfit@3");
  // A tiny shared program (what the LLM would produce) — one strength block.
  const shared = {
    month_plan: { summary: "test" },
    weeks: [{
      week_num: 1,
      days: [{
        day_num: 1,
        blocks: [{
          movements: [
            { movement: "Back Squat", target_pct_1rm: 70 },
            { movement: "Snatch", target_pct_1rm: 65 },
          ],
        }],
      }],
    }],
  } as unknown as WriterOutput;

  const [member] = buildCohortRoster([
    { athlete_ref: "u1", units: "lbs", lifts: { back_squat: 300 }, do_not_program: ["Snatch"] },
  ], NOW);

  const scaling = computeCohortScaling(shared, member, pack);

  const bs = scaling.scaled_movements.find((m) => m.movement === "Back Squat")!;
  // round(0.70 × 300 / 5) × 5 = 210
  assertEquals(bs.resolved_weight, 210);
  assertEquals(bs.basis_lift, "back_squat");
  assertEquals(bs.needs_substitution, false);

  const sn = scaling.scaled_movements.find((m) => m.movement === "Snatch")!;
  assertEquals(sn.needs_substitution, true); // in the member's do_not_program
  assertEquals(scaling.substitutions_pending, 1);
});

// ── mapSlidersToDesign (owner strategy sliders → design intent) ───────────────

Deno.test("mapSlidersToDesign: bands map to develop/maintain/deprioritize, ranked by value", () => {
  const d = mapSlidersToDesign({
    powerlifting_strength: 9,
    mixed_modal_conditioning: 8,
    olympic_lifting: 5,
    skill_coordination: 2,
  })!;
  assertEquals(d.priorities.map((p) => p.focus), ["powerlifting_strength", "mixed_modal_conditioning"]);
  assertEquals(d.priorities.map((p) => p.rank), [1, 2]);
  assertEquals(d.priorities[0].confidence, "high");
  assertEquals(d.maintain, ["olympic_lifting"]);
  assertEquals(d.deprioritize, ["skill_coordination"]);
});

Deno.test("mapSlidersToDesign: >4 develop sliders — overflow demotes to maintain", () => {
  const d = mapSlidersToDesign({
    olympic_lifting: 10,
    powerlifting_strength: 9,
    posterior_chain: 8,
    upper_body_pressing: 8,
    gymnastics_pulling: 7,
  })!;
  assertEquals(d.priorities.length, 4);
  assertEquals(d.priorities[0].focus, "olympic_lifting");
  // The 5th develop-band axis is not dropped — it demotes to maintain.
  assertEquals(d.maintain, ["gymnastics_pulling"]);
  assertEquals(d.deprioritize, []);
});

Deno.test("mapSlidersToDesign: no axis ≥7 — top of the MAINTAIN band develops, never the low band", () => {
  const d = mapSlidersToDesign({
    mixed_modal_conditioning: 6,
    posterior_chain: 5,
    aerobic_capacity: 4,
    skill_coordination: 2,
  })!;
  assertEquals(d.priorities.map((p) => p.focus), ["mixed_modal_conditioning", "posterior_chain"]);
  assertEquals(d.maintain, ["aerobic_capacity"]);
  assertEquals(d.deprioritize, ["skill_coordination"]);
});

Deno.test("mapSlidersToDesign: ONLY low sliders — default posture minus those axes, lows honored", () => {
  // The intent-inversion bug from review: "de-emphasize these two" must never
  // become "develop these two".
  const d = mapSlidersToDesign({ skill_coordination: 2, olympic_lifting: 1 })!;
  const prioritized = d.priorities.map((p) => p.focus);
  assert(!prioritized.includes("skill_coordination"), "low slider must not be developed");
  assert(!prioritized.includes("olympic_lifting"), "low slider must not be developed");
  assert(!d.maintain.includes("olympic_lifting"), "low slider must not be maintained either");
  assertEquals(d.deprioritize.sort(), ["olympic_lifting", "skill_coordination"].sort());
  assert(d.priorities.length > 0, "default priorities still allocate the cycle");
});

Deno.test("mapSlidersToDesign: empty/garbage input", () => {
  assertEquals(mapSlidersToDesign({}), null);
  assertEquals(mapSlidersToDesign({ not_a_focus: 9 }), null);
  // Out-of-range values clamp to the 0-10 contract instead of misbehaving.
  const d = mapSlidersToDesign({ powerlifting_strength: 100, midline: -5 })!;
  assertEquals(d.priorities.map((p) => p.focus), ["powerlifting_strength"]);
  assertEquals(d.deprioritize, ["midline"]);
});

Deno.test("buildGymCohortEnvelope: strategy sliders steer the tdi; null strategy = main-program default", () => {
  const withSliders = buildGymCohortEnvelope(
    { ...CONFIG, strategy: { sliders: { olympic_lifting: 9, powerlifting_strength: 8 } } },
    VOCAB, NOW,
  ).shared_training_design_input;
  assertEquals(withSliders.priorities[0].focus, "olympic_lifting");
  assertEquals(withSliders.priorities[0].confidence, "high");

  const defaulted = buildGymCohortEnvelope(CONFIG, VOCAB, NOW).shared_training_design_input;
  assertEquals(defaulted.priorities[0].focus, "mixed_modal_conditioning");
  // The Engine-era recipe is dead: nothing is deprioritized by default.
  assertEquals(defaulted.deprioritize, []);
});
