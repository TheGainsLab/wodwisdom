/**
 * movement-name-repair_test.ts
 *
 * The annotation-in-name repair (2026-09-01 Ashley failure): labels stuck to
 * legal movement names are trimmed and preserved in notes; everything
 * ambiguous is left alone for the audits.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  splitAnnotatedMovementName,
  trimComposedMovementAnnotations,
  trimWriterMovementAnnotations,
} from "./movement-name-repair.ts";
import type { ComposedMetcon } from "./metcon-composer.ts";

const VOCAB = [
  "Ring Row",
  "Pull Up",
  "Deadlift",
  "Sumo Deadlift",
  "Sumo Deadlift High Pull",
  "Box Jump",
];

Deno.test("splits the production failure string (Ashley, W1D1)", () => {
  const r = splitAnnotatedMovementName("Ring Row (Pull Up scaled) — Pull Up", VOCAB);
  assertEquals(r?.canonical, "Ring Row");
  assertEquals(r?.tail, "(Pull Up scaled) — Pull Up");
});

Deno.test("longest legal prefix wins", () => {
  const r = splitAnnotatedMovementName("Sumo Deadlift High Pull (light)", VOCAB);
  assertEquals(r?.canonical, "Sumo Deadlift High Pull");
  assertEquals(r?.tail, "(light)");
});

Deno.test("dash tails count as annotation; case-insensitive prefix", () => {
  assertEquals(splitAnnotatedMovementName("deadlift — light, unbroken", VOCAB)?.canonical, "Deadlift");
  assertEquals(splitAnnotatedMovementName("Box Jump - 24 inch", VOCAB)?.canonical, "Box Jump");
});

Deno.test("left alone: legal names, word-tails, free names, plurals", () => {
  assertEquals(splitAnnotatedMovementName("Deadlift", VOCAB), null);
  assertEquals(splitAnnotatedMovementName("Weighted Ring Row to Press", VOCAB), null); // no legal prefix
  assertEquals(splitAnnotatedMovementName("Deadlift to Overhead", VOCAB), null); // word tail — plausible compound
  assertEquals(splitAnnotatedMovementName("Deadlifts", VOCAB), null); // plural — not punctuation
  assertEquals(splitAnnotatedMovementName("World's Greatest Stretch", VOCAB), null);
});

Deno.test("composed trim: name fixed, label lands in stimulus_note, repair logged", () => {
  const piece: ComposedMetcon = {
    week_num: 1,
    day_num: 1,
    format: "amrap",
    block_scheme: "AMRAP 12",
    stated_duration_minutes: 12,
    stimulus_note: "Steady pace.",
    monostructural: false,
    movements: [
      { movement: "Ring Row (Pull Up scaled) — Pull Up", prescription: "10" },
      { movement: "Box Jump", prescription: "12" },
    ],
  };
  const repairs = trimComposedMovementAnnotations([piece], VOCAB);
  assertEquals(repairs.length, 1);
  assertEquals(piece.movements[0].movement, "Ring Row");
  assert(piece.stimulus_note.includes("Steady pace."));
  assert(piece.stimulus_note.includes("Pull Up scaled"));
  assertEquals(piece.movements[1].movement, "Box Jump"); // untouched
});

Deno.test("writer trim: all block types, label lands in scaling_note, ban-relevant name restored", () => {
  const output = {
    weeks: [{
      week_num: 2,
      days: [{
        day_num: 3,
        blocks: [{
          block_type: "accessory",
          movements: [
            { movement: "Deadlift (light)", sets: 3, reps: 10 },
            { movement: "Ring Row", sets: 3, reps: 12, scaling_note: "feet elevated" },
          ],
        }],
      }],
    }],
    // deno-lint-ignore no-explicit-any
  } as any;
  const repairs = trimWriterMovementAnnotations(output, VOCAB);
  assertEquals(repairs.length, 1);
  const mv = output.weeks[0].days[0].blocks[0].movements[0];
  assertEquals(mv.movement, "Deadlift");
  assertEquals(mv.scaling_note, "(light)");
  // Pre-existing scaling_note untouched on the unrepaired movement.
  assertEquals(output.weeks[0].days[0].blocks[0].movements[1].scaling_note, "feet elevated");
});
