// deno test supabase/functions/_shared/engine-switch_test.ts --no-check
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { translateSwitchPosition, type SwitchMappingRow } from "./engine-switch.ts";

/** A main-program mapping: `perWeek` days a week, 4 weeks a month, `months` months. */
function mainMapping(perWeek: number, months = 3): SwitchMappingRow[] {
  const rows: SwitchMappingRow[] = [];
  let seq = 1;
  for (let m = 1; m <= months; m++) {
    for (let w = 1; w <= 4; w++) {
      for (let d = 0; d < perWeek; d++) rows.push({ seq: seq++, month: m, week: (m - 1) * 4 + w });
    }
  }
  return rows;
}
const three = mainMapping(3), four = mainMapping(4), five = mainMapping(5);

Deno.test("the founder's example: 3-day, month two week two → 4-day, month two week three", () => {
  // 3-day: month 2 = positions 13-24; week 6 = 16-18. Athlete completed 17 (mid week two of month two).
  const r = translateSwitchPosition(three, 17, four, 0);
  // 4-day: week 7 (month 2, week 3) starts at position 25
  assertEquals(r.position, 25);
  assertEquals(r.week, 7);
  assertEquals(r.carried, true);
});

Deno.test("finishing a week exactly lands at the start of the next", () => {
  const r = translateSwitchPosition(three, 18, four, 0); // week 6 complete
  assertEquals(r.position, 25); // week 7
});

Deno.test("switching down keeps the week: 5-day week 6 → 3-day week 7", () => {
  const r = translateSwitchPosition(five, 28, three, 0); // 5-day week 6 = 26-30; 28 is mid-week
  assertEquals(r.week, 7);
  assertEquals(r.position, 19); // 3-day week 7 starts at 19
});

Deno.test("no progress in the old program → old rule, day 1", () => {
  const r = translateSwitchPosition(three, 0, five, 0);
  assertEquals(r.position, 1);
  assertEquals(r.carried, false);
});

Deno.test("never moves backwards in a program already progressed in", () => {
  // Athlete was on the 5-day up to position 40 (week 8), then on the 3-day to week 2 → back to 5-day
  const r = translateSwitchPosition(three, 5, five, 40);
  assertEquals(r.position, 41);
});

Deno.test("past the end of the new program lands on its last day", () => {
  const r = translateSwitchPosition(five, 60, three, 0); // 5-day week 12 complete; 3-day has 12 weeks → week 13 doesn't exist
  assertEquals(r.position, 36);
  assertEquals(r.carried, true);
});

Deno.test("mappings without week numbers fall back to the old rule", () => {
  const noWeeks = three.map((r) => ({ ...r, week: null }));
  assertEquals(translateSwitchPosition(noWeeks, 17, four, 0).carried, false);
  assertEquals(translateSwitchPosition(three, 17, noWeeks, 3).position, 4);
});
