import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { weekShapeProblems } from "./pipeline.ts";

const day = { day_num: 1, blocks: [{ block_type: "strength", movements: [] }] };

Deno.test("sound week has no problems", () => {
  assertEquals(weekShapeProblems({ week_num: 2, days: [day, day, day] }, 3), []);
});

Deno.test("prose-shaped or cut-off input is caught", () => {
  assertEquals(weekShapeProblems({ summary: "here is the week" }, 3), ["days must be a list"]);
  assertEquals(weekShapeProblems({ days: [day, day] }, 3), ["expected 3 days, got 2"]);
  assertEquals(weekShapeProblems({ days: [day, { day_num: 2 }, day] }, 3), ["day 2 has no blocks"]);
});
