/**
 * metcon-variety-audits_test.ts
 *
 * Tests for the set-level metcon fence — each rule exercised with the failure
 * mode that motivated it (the 2026-08 findings: wall ball in 12/16 pieces,
 * zero barbell for capable athletes, cloned day-slot templates, machine-only
 * months).
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { ComposedMetcon, MetconSlot } from "./metcon-composer.ts";
import {
  auditMetconVariety,
  isBarbellMetconMovement,
  movementSignature,
} from "./metcon-variety-audits.ts";

let dayCounter = 0;
function piece(movements: string[], overrides: Partial<ComposedMetcon> = {}): ComposedMetcon {
  const idx = dayCounter++;
  return {
    week_num: Math.floor(idx / 3) % 4 + 1,
    day_num: (idx % 3) + 1,
    format: "amrap",
    block_scheme: "AMRAP 12",
    stated_duration_minutes: 12,
    movements: movements.map((m) => ({ movement: m, prescription: "10" })),
    stimulus_note: "Sustained repeatable pace across all rounds.",
    monostructural: false,
    ...overrides,
  };
}

/** A legal, varied 12-piece month (3-day athlete): distinct combos, spread
 *  movements, 4 formats, 2 barbell pieces, 1 reasoned mono piece. */
function goodMonth(): ComposedMetcon[] {
  dayCounter = 0;
  return [
    piece(["Row", "Wall Ball", "Burpee"], { format: "rft" }),
    piece(["Dumbbell Snatch", "Box Jump Over"], { format: "amrap" }),
    piece(["Thruster", "Pull Up"], { format: "rep_scheme", block_scheme: "21-15-9 for time" }),
    piece(["Run", "Kettlebell Swing"], { format: "intervals" }),
    piece(["Bike", "Wall Walk", "Sit Up"], { format: "amrap" }),
    piece(["Deadlift", "Bar Facing Burpee"], { format: "rft" }),
    piece(["Row"], {
      format: "intervals",
      monostructural: true,
      stimulus_note: "Deliberate monostructural VO2 session — repeatable 500m pace.",
    }),
    piece(["Burpee Box Jump Over", "Goblet Squat"], { format: "amrap" }),
    piece(["Run", "Push Up", "Walking Lunge"], { format: "chipper" }),
    piece(["Kettlebell Swing", "Toes To Bar"], { format: "emom" }),
    piece(["Wall Ball", "Shuttle Run", "Bike"], { format: "amrap" }),
    piece(["Dumbbell Thruster", "Double Under"], { format: "rft" }),
  ];
}

Deno.test("a varied, legal month passes", () => {
  const r = auditMetconVariety({ metcons: goodMonth() }, { barbellCapable: true });
  assertEquals(r.violations, []);
  assertEquals(r.passed, true);
});

Deno.test("repeated movement combination is flagged (cloned day-slot template)", () => {
  const m = goodMonth();
  m[8] = piece(["Wall Ball", "Row", "Burpee"]); // same combo as piece 1, reordered
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("repeats the movement combination")));
});

Deno.test("movement over the 1/3 frequency cap is flagged (wall-ball saturation)", () => {
  const m = goodMonth();
  for (let i = 0; i < 6; i++) m[i].movements.push({ movement: "Wall Ball", prescription: "12" });
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes('"wall ball"') && v.includes("cap")));
});

Deno.test("fewer than 3 formats / one format over half are flagged", () => {
  const m = goodMonth().map((p) => ({ ...p, format: "rft" as const }));
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("at least 3")));
  assert(r.violations.some((v) => v.includes("exceed half")));
});

Deno.test("zero barbell for a capable athlete is flagged; incapable athletes exempt", () => {
  const m = goodMonth().map((p) => ({
    ...p,
    movements: p.movements.filter((mv) => !isBarbellMetconMovement(mv.movement)),
  })).filter((p) => p.movements.length > 0);
  const flagged = auditMetconVariety({ metcons: m }, { barbellCapable: true });
  assertEquals(flagged.passed, false);
  assert(flagged.violations.some((v) => v.includes("barbell")));
  const exempt = auditMetconVariety({ metcons: m }, { barbellCapable: false });
  assertEquals(exempt.violations.filter((v) => v.includes("barbell")), []);
});

Deno.test("three monostructural pieces exceed the budget of 2", () => {
  const m = goodMonth();
  m[3] = piece(["Bike"], { monostructural: true });
  m[8] = piece(["Run"], { monostructural: true });
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("budget is 2")));
});

Deno.test("dumbbell/kettlebell implements never count as barbell", () => {
  assertEquals(isBarbellMetconMovement("Thruster"), true);
  assertEquals(isBarbellMetconMovement("Dumbbell Thruster"), false);
  assertEquals(isBarbellMetconMovement("Kettlebell Swing"), false);
  assertEquals(isBarbellMetconMovement("Power Clean"), true);
});

Deno.test("shuttle run is a floor movement: doesn't count mono, doesn't trip one-machine", () => {
  const m = goodMonth();
  const r = auditMetconVariety({ metcons: m });
  // piece 11 pairs Wall Ball + Shuttle Run + Bike — one machine only.
  assertEquals(r.violations.filter((v) => v.includes("modalities")), []);
  const twoMachines = [...m.slice(0, 11), piece(["Row", "Bike"], { format: "intervals" })];
  const r2 = auditMetconVariety({ metcons: twoMachines });
  assert(r2.violations.some((v) => v.includes("one machine per round-based piece")));
});

Deno.test("chipper may touch two machines; equipment ownership still enforced", () => {
  const m = goodMonth();
  m[8] = piece(["Run", "Single Under", "Row"], { format: "chipper", block_scheme: "For time (cap 22)" });
  const equipped = auditMetconVariety({ metcons: m }, {
    equipment: { rower: true, assault_bike: true, ski_erg: false },
  });
  assertEquals(equipped.violations.filter((v) => v.includes("modalities")), []);
  assertEquals(equipped.passed, true);

  // Same chipper for an athlete with no rower → equipment violation.
  const unequipped = auditMetconVariety({ metcons: m }, { equipment: { rower: false } });
  assert(unequipped.violations.some((v) => v.includes("requires rower")));
});

Deno.test("banned and out-of-vocabulary movements are violations", () => {
  const m = goodMonth();
  const r = auditMetconVariety({ metcons: m }, {
    vocabulary: ["Row", "Wall Ball", "Burpee", "Run", "Kettlebell Swing", "Bike", "Sit Up",
      "Thruster", "Pull Up", "Deadlift", "Bar Facing Burpee", "Box Jump Over", "Dumbbell Snatch",
      "Wall Walk", "Burpee Box Jump Over", "Goblet Squat", "Push Up", "Walking Lunge",
      "Toes To Bar", "Shuttle Run", "Dumbbell Thruster", "Double Under"],
    doNotProgram: ["Toes To Bar"],
  });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("do-not-program")));

  const invented = goodMonth();
  invented[0].movements.push({ movement: "Ski Erg", prescription: "10 cal" });
  const r2 = auditMetconVariety({ metcons: invented }, { vocabulary: ["Row", "Wall Ball", "Burpee"] });
  assert(r2.violations.some((v) => v.includes("not in this athlete's allowed vocabulary")));
});

Deno.test("previous-cycle signatures are never re-served", () => {
  const m = goodMonth();
  const prev = [movementSignature(m[2])];
  const r = auditMetconVariety({ metcons: m }, { previousCycleSignatures: prev });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("re-serves")));
});

Deno.test("more than 2 named pieces are flagged", () => {
  const m = goodMonth();
  m[1].format = "named";
  m[4].format = "named";
  m[9].format = "named";
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("named")));
});

Deno.test("slot coverage: missing, doubled, and orphan slots are flagged; off-bucket duration warns", () => {
  const m = goodMonth();
  const slots: MetconSlot[] = m.map((p) => ({
    week_num: p.week_num,
    day_num: p.day_num,
    time_domain: "medium",
    intensity: "build",
    focus: "aerobic_capacity",
    day_context: {},
  }));
  const clean = auditMetconVariety({ metcons: m }, { slots });
  assertEquals(clean.passed, true);

  const broken = m.slice(1); // drop W1D1
  broken.push({ ...m[1], week_num: 4, day_num: 7 }); // orphan slot
  const r = auditMetconVariety({ metcons: broken }, { slots });
  assert(r.violations.some((v) => v.includes("no composed metcon")));
  assert(r.violations.some((v) => v.includes("doesn't exist")));

  const slow = m.map((p, i) => (i === 0 ? { ...p, stated_duration_minutes: 25 } : p));
  const warned = auditMetconVariety({ metcons: slow }, { slots });
  assert(warned.warnings.some((w) => w.includes('"medium"')));
});
