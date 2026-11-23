// deno test supabase/functions/_shared/equipment-labels_test.ts --no-check --allow-read
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EQUIPMENT_LABELS, equipmentLabel } from "./equipment-labels.ts";
import { ALL_EQUIPMENT_KEYS } from "./tier-status.ts";

Deno.test("every canonical equipment key has a label, and nothing else does", () => {
  assertEquals(Object.keys(EQUIPMENT_LABELS).sort(), [...ALL_EQUIPMENT_KEYS].sort());
});

Deno.test("the labels are the ones the profile page's checklist shows", () => {
  const page = Deno.readTextFileSync(new URL("../../../src/pages/AthletePage.tsx", import.meta.url));
  const start = page.indexOf("const EQUIPMENT_GROUPS = [");
  const groups = page.slice(start, page.indexOf("\n];", start));
  const onPage: Record<string, string> = {};
  for (const m of groups.matchAll(/\{ key: '([a-z_]+)', label: '([^']+)' \}/g)) onPage[m[1]] = m[2];
  assertEquals(onPage, EQUIPMENT_LABELS);
});

Deno.test("an unknown key reads as its words", () => {
  assertEquals(equipmentLabel("air_runner"), "air runner");
  assertEquals(equipmentLabel("rope"), "Climbing Rope");
});
