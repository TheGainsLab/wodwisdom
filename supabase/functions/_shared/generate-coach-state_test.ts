import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coachStateShapeProblems } from "./generate-coach-state.ts";

const sound = {
  priorities: [], maintain: [], deprioritize: [],
  recovery_posture: { reasons: [] }, strength_emphasis: { reasons: [] },
};

Deno.test("sound shape has no problems", () => {
  assertEquals(coachStateShapeProblems(sound), []);
});

Deno.test("cut-off input (lists missing) is named field by field", () => {
  assertEquals(coachStateShapeProblems({ headline: "x", summary: "y" }), [
    "priorities must be a list",
    "maintain must be a list",
    "deprioritize must be a list",
    "recovery_posture.reasons must be a list",
    "strength_emphasis.reasons must be a list",
  ]);
});

Deno.test("a list emitted as an object is caught", () => {
  assertEquals(coachStateShapeProblems({ ...sound, priorities: { focus: "squat" } }), ["priorities must be a list"]);
});
