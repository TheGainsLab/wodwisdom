// deno test supabase/functions/_shared/programming-week_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatUpcomingProgrammingWeek, pickNextWeek, summarizeProgramDay, type ProgramDayRow } from "./programming-week.ts";

const day = (w: number, d: number): ProgramDayRow => ({ id: `w${w}d${d}`, week_num: w, day_num: d, day_type: "fitness", classified_archetype: "fitness", workout_text: null });
const prog = [1, 2, 3, 4].flatMap((w) => [1, 2, 3].map((d) => day(w, d)));

Deno.test("nothing logged → week 1", () => {
  assertEquals(pickNextWeek(prog, new Set())?.map((d) => d.id), ["w1d1", "w1d2", "w1d3"]);
});

Deno.test("mid-week → the rest of that week", () => {
  assertEquals(pickNextWeek(prog, new Set(["w1d1", "w1d2"]))?.map((d) => d.id), ["w1d3"]);
});

Deno.test("week finished → next week; skipped days behind the frontier don't matter", () => {
  assertEquals(pickNextWeek(prog, new Set(["w1d1", "w1d3"]))?.map((d) => d.id), ["w2d1", "w2d2", "w2d3"]);
});

Deno.test("logged past the end → null", () => {
  assertEquals(pickNextWeek(prog, new Set(["w4d3"])), null);
});

Deno.test("summary keeps strength and metcon, drops warm-up and accessory", () => {
  const text = `Warm-up & Mobility:
5 min easy row
Skills:
Wall-facing handstand hold 3x20s
Strength:
5x3 @ 80%
Back Squat
Accessory:
3x12 DB Bulgarian split squats
Metcon:
12 min AMRAP:
8 kipping pull-ups`;
  const s = summarizeProgramDay(text);
  assertEquals(s.includes("Back Squat"), true);
  assertEquals(s.includes("12 min AMRAP"), true);
  assertEquals(s.includes("handstand"), true);
  assertEquals(s.includes("easy row"), false);
  assertEquals(s.includes("Bulgarian"), false);
});

Deno.test("format names the rule and lists the days", () => {
  const out = formatUpcomingProgrammingWeek([{ week: 2, day: 1, kind: "strength", summary: "Back squat 5x3" }]);
  assertEquals(out.includes("W2D1 strength: Back squat 5x3"), true);
  assertEquals(out.includes("never the day count"), true);
  assertEquals(formatUpcomingProgrammingWeek([]), "");
});
