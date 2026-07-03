// deno test supabase/functions/_shared/cohort/cohort-builders_test.ts --allow-env --no-check
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildGymCohortEnvelope, type GymCohortConfig } from "./build-gym-cohort-envelope.ts";
import { buildCohortRoster } from "./build-cohort-roster.ts";
import { computeCohortScaling } from "../engine/cohort.ts";
import { getDomainPack } from "../domain-packs/registry.ts";
import type { WriterOutput } from "../v2-output-schema.ts";

const NOW = "2026-07-03T00:00:00.000Z";
const VOCAB = ["Back Squat", "Snatch", "Row (Calories)"];

const CONFIG: GymCohortConfig = {
  tenant_id: "gym-123",
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
