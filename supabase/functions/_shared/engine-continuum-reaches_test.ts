import { assert, assertEquals } from "jsr:@std/assert";
import { ECHO_BIKE_CAL_CURVE_V1, C2_METERS_CURVE_V1 } from "./engine-continuum.ts";
import type { EngineDayTypeRow } from "./engine-catalogue.ts";
import { formatReaches, reachableBands, reachMap } from "./engine-continuum-reaches.ts";

const ROWS: EngineDayTypeRow[] = JSON.parse(await Deno.readTextFile(new URL("./fixtures/engine_day_types.json", import.meta.url)));
const byId = (id: string) => ROWS.find((r) => r.id === id)!;

Deno.test("reaches: anaerobic (15–120 s max efforts) covers the sprint bands up to the 2-min edge", () => {
  assertEquals(reachableBands(byId("anaerobic"), ECHO_BIKE_CAL_CURVE_V1), ["2–4 min", "1–2 min", "30–60 s", "≤30 s"]);
});

Deno.test("reaches: endurance at 0.7× is zone 2 only — it cannot probe a scored band", () => {
  assertEquals(reachableBands(byId("endurance"), ECHO_BIKE_CAL_CURVE_V1), ["zone 2 (40 min+)"]);
  assertEquals(reachableBands(byId("polarized"), ECHO_BIKE_CAL_CURVE_V1), ["zone 2 (40 min+)"]);
});

Deno.test("reaches: threshold (0.85–0.95×) lands at 10–40 min of effort on the Echo", () => {
  const bands = reachableBands(byId("threshold"), ECHO_BIKE_CAL_CURVE_V1);
  assert(bands.includes("10–20 min"), bands.join(","));
  assert(!bands.includes("4–10 min"), bands.join(","));
});

Deno.test("reaches: interval (0.8–1.1×) spans from zone 2 down to 4–10 min — a paced day's band follows its pace, not its clock", () => {
  const bands = reachableBands(byId("interval"), ECHO_BIKE_CAL_CURVE_V1);
  assertEquals(bands[0], "zone 2 (40 min+)");
  assertEquals(bands[bands.length - 1], "4–10 min");
});

Deno.test("reaches: hybrid_anaerobic (1.05–1.2×) is the paced type that reaches 2–4 min on the Echo", () => {
  const bands = reachableBands(byId("hybrid_anaerobic"), ECHO_BIKE_CAL_CURVE_V1);
  assert(bands.includes("2–4 min"), bands.join(","));
});

Deno.test("reaches: the same pace fraction is a shorter effort on the rower (pace curve is flatter)", () => {
  const echo = reachableBands(byId("hybrid_anaerobic"), ECHO_BIKE_CAL_CURVE_V1);
  const row = reachableBands(byId("hybrid_anaerobic"), C2_METERS_CURVE_V1);
  assert(row.includes("≤30 s") || row.includes("30–60 s"), row.join(","));
  assert(!echo.includes("≤30 s"), echo.join(","));
});

Deno.test("reaches: time_trial is a 10-min max effort → 10–20 min band; rocket_races_b (inherits) says nothing", () => {
  assertEquals(reachableBands(byId("time_trial"), ECHO_BIKE_CAL_CURVE_V1), ["10–20 min"]);
  assertEquals(formatReaches(byId("rocket_races_b"), ECHO_BIKE_CAL_CURVE_V1), null);
});

Deno.test("reaches: every type resolves to at least one band, except B (inherits) and the flux family (no workDuration in the envelope)", () => {
  for (const r of ROWS) {
    if (["rocket_races_b", "flux", "flux_stages"].includes(r.id)) continue;
    assert(reachableBands(r, ECHO_BIKE_CAL_CURVE_V1).length > 0, r.id);
  }
});

Deno.test("reaches: a max-effort line says which work length lands in each band", () => {
  assertEquals(
    formatReaches(byId("anaerobic"), ECHO_BIKE_CAL_CURVE_V1),
    "can reach: 2–4 min at 120 s work, 1–2 min at 60–119 s work, 30–60 s at 30–59 s work, ≤30 s at 15–29 s work (max effort — the band follows the work length)",
  );
});

Deno.test("reaches: a paced line says which pace lands in each band — MAP at 0.95–1.0× is a 10–20 min effort, not '3-min power'", () => {
  const m = reachMap(byId("max_aerobic_power"), ECHO_BIKE_CAL_CURVE_V1);
  const by = Object.fromEntries(m.map((r) => [r.band, r.at]));
  assertEquals(by["4–10 min"], "1.01–1.05×");
  assertEquals(by["10–20 min"], "0.93–1.0×");
  assert(by["20–40 min"].startsWith("0.8"), by["20–40 min"]);
  const line = formatReaches(byId("max_aerobic_power"), ECHO_BIKE_CAL_CURVE_V1)!;
  assert(line.endsWith("(the band follows the pace you set, not the clock)"), line);
  assert(line.includes("4–10 min at 1.01–1.05×"), line);
});

Deno.test("reaches: ascending reaches 2–4 min only at its top paces (1.13–1.3×)", () => {
  const by = Object.fromEntries(reachMap(byId("ascending"), ECHO_BIKE_CAL_CURVE_V1).map((r) => [r.band, r.at]));
  assertEquals(by["2–4 min"], "1.13–1.3×");
  assertEquals(by["4–10 min"], "1.01–1.12×");
});
