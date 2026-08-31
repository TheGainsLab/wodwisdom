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
import { loadClassForMovement } from "./conditioning-definitions.ts";

let dayCounter = 0;
function piece(movements: string[], overrides: Partial<ComposedMetcon> = {}): ComposedMetcon {
  const idx = dayCounter++;
  return {
    week_num: Math.floor(idx / 3) % 4 + 1,
    day_num: (idx % 3) + 1,
    format: "amrap",
    block_scheme: "AMRAP 12",
    stated_duration_minutes: 12,
    // Barbell movements carry typed loads (rule 10) so the base fixture stays legal.
    movements: movements.map((m) =>
      isBarbellMetconMovement(m)
        ? { movement: m, prescription: "10", load_class: loadClassForMovement(m), load_band: "moderate" as const }
        : { movement: m, prescription: "10" }
    ),
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

Deno.test("barbell floor is WARNING tier (letter may overrule it); incapable athletes exempt", () => {
  // Demoted 2026-08-11: Nick's letter (no Olympic lifting, engine-first,
  // loading de-emphasized) legitimately argued against the floor — the
  // composer followed the coach and the old hard rule called it a defect.
  const m = goodMonth().map((p) => ({
    ...p,
    movements: p.movements.filter((mv) => !isBarbellMetconMovement(mv.movement)),
  })).filter((p) => p.movements.length > 0);
  const flagged = auditMetconVariety({ metcons: m }, { barbellCapable: true });
  assertEquals(flagged.violations.filter((v) => v.includes("barbell")), []);
  assert(flagged.warnings.some((w) => w.includes("barbell-capable")));
  const exempt = auditMetconVariety({ metcons: m }, { barbellCapable: false });
  assertEquals(exempt.warnings.filter((w) => w.includes("barbell")), []);
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

// ── Athlete-match rules (2026-08-31) ──

Deno.test("rule 10: barbell movement without typed load band is a violation", () => {
  const m = goodMonth();
  m[2].movements = [{ movement: "Thruster", prescription: "10" }, { movement: "Pull Up", prescription: "10" }];
  const r = auditMetconVariety({ metcons: m });
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("no typed load_class/load_band")));
});

Deno.test("rule 11: skill volume above tier band without justification is a violation; in-band passes; justification exempts; unmapped skills are skipped", () => {
  const skills = { double_unders: "beginner" }; // band 15-30/round
  const over = goodMonth();
  const du = over[11].movements.find((mv) => mv.movement === "Double Under")!;
  du.prescription = "50";
  const r = auditMetconVariety({ metcons: over }, { skills });
  assert(r.violations.some((v) => v.includes("exceeds the beginner band")));

  const inBand = goodMonth();
  inBand[11].movements.find((mv) => mv.movement === "Double Under")!.prescription = "25";
  const ok = auditMetconVariety({ metcons: inBand }, { skills });
  assertEquals(ok.violations.filter((v) => v.includes("exceeds the")), []);

  const justified = goodMonth();
  justified[11].movements.find((mv) => mv.movement === "Double Under")!.prescription = "50";
  justified[11].stimulus_note = "Deliberate double-under density push — big unbroken sets are the stimulus.";
  const j = auditMetconVariety({ metcons: justified }, { skills });
  assertEquals(j.violations.filter((v) => v.includes("exceeds the")), []);

  // Toes To Bar prescribes 10 in the fixture but toes_to_bar has no entry in
  // this skills map — absence is neutral, so no violation for it.
  assertEquals(r.violations.filter((v) => v.includes("Toes To Bar")), []);
});

Deno.test("rule 11: a not-under-fatigue tier skill is a violation regardless of reps", () => {
  const m = goodMonth();
  m[7].movements.push({ movement: "Ring Muscle Up", prescription: "2" });
  const r = auditMetconVariety({ metcons: m }, { skills: { muscle_ups: "none" } });
  assert(r.violations.some((v) => v.includes("not programmed under fatigue")));
});

Deno.test("rule 12: a development axis missing from a non-deload week is a violation; deload weeks exempt", () => {
  const m = goodMonth();
  const slots: MetconSlot[] = m.map((p) => ({
    week_num: p.week_num,
    day_num: p.day_num,
    time_domain: "medium",
    intensity: p.week_num === 4 ? "deload — easy" : "build",
    focus: "aerobic_capacity",
    day_context: {},
  }));
  // gymnastics_pressing appears in W2 (Wall Walk) but not W1/W3.
  const r = auditMetconVariety({ metcons: m }, { slots, developmentAxes: ["gymnastics_pressing"], skills: {} });
  assert(r.violations.some((v) => v.includes('Week 1: development axis "gymnastics_pressing"')));
  assert(!r.violations.some((v) => v.includes("Week 4:")));
});

Deno.test("rule 13: fit floor flags a month that ignores the athlete's tracks", () => {
  dayCounter = 0;
  const generic = Array.from({ length: 12 }, (_, i) =>
    piece([["Run", "Sit Up"], ["Row", "Lunge"], ["Bike", "Air Squat"], ["Run", "Burpee"]][i % 4], {
      format: (["amrap", "rft", "intervals"] as const)[i % 3],
      week_num: Math.floor(i / 3) + 1,
      day_num: (i % 3) + 1,
    }));
  // Distinctness will also flag repeats; check the fit violation specifically.
  const r = auditMetconVariety({ metcons: generic }, { developmentAxes: ["olympic_lifting", "gymnastics_pulling"] });
  assert(r.violations.some((v) => v.includes("floor 60%")));
});

Deno.test("barbell target reads the typed loading_deemphasis flag", () => {
  const m = goodMonth(); // 2 barbell pieces in 12 → below the 4-6 target
  const flagged = auditMetconVariety({ metcons: m }, { barbellCapable: true });
  assert(flagged.warnings.some((w) => w.includes("loading_deemphasis NOT set")));
  const exempt = auditMetconVariety({ metcons: m }, { barbellCapable: true, loadingDeemphasis: true });
  assertEquals(exempt.warnings.filter((w) => w.includes("barbell")), []);
});

Deno.test("allocated_minutes drives the duration warning when present", () => {
  const m = goodMonth();
  const slots: MetconSlot[] = m.map((p) => ({
    week_num: p.week_num,
    day_num: p.day_num,
    time_domain: "long",
    intensity: "build",
    focus: "aerobic_capacity",
    day_context: {},
    allocated_minutes: 24,
  }));
  // Every piece states 12 min against a 24-min allocation → warned.
  const r = auditMetconVariety({ metcons: m }, { slots });
  assert(r.warnings.some((w) => w.includes("vs allocated 24 min")));
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
