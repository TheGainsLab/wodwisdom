import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describeEffect, type EffectFacts } from "./profile-effect.ts";

const base: EffectFacts = { hasProgramming: true, hasEngine: false, program: { weekly: true, outlineWeeksLeft: 2 }, engineProgramChosen: false, engineSequencing: false };
const all = (c: Parameters<typeof describeEffect>[0], f: EffectFacts) => describeEffect(c, f).join(" ");

Deno.test("weekly program with weeks still to write: the rest of THIS month is re-planned, not 'next month'", () => {
  const t = all({ days: true }, base);
  assert(t.includes("re-planned from it when your next week is written"));
  assert(!t.toLowerCase().includes("next month"));
  assert(!t.toLowerCase().includes("human"));
});

Deno.test("all weeks written, or an older monthly program: it is next month, and written days are changed by asking", () => {
  for (const program of [{ weekly: true, outlineWeeksLeft: 0 }, { weekly: false, outlineWeeksLeft: 0 }]) {
    const t = all({ goal: true }, { ...base, program });
    assert(t.includes("applies from your next month") && t.includes("open it and ask me there"));
  }
});

Deno.test("no program yet: it will be built from it", () => {
  assertEquals(describeEffect({ goal: true }, { ...base, program: null }), ["Your program will be built from it."]);
});

Deno.test("an injury change: every week from now on is checked against it", () => {
  assert(all({ injuries: true }, base).includes("Every week written from now on is checked against it"));
});

Deno.test("Engine-only: a days change is said plainly to change nothing on the Engine", () => {
  const eng: EffectFacts = { hasProgramming: false, hasEngine: true, program: null, engineProgramChosen: true, engineSequencing: false };
  const t = all({ days: true }, eng);
  assert(t.includes("doesn't change your Engine week") && t.includes("Switch Program"));
  assert(all({ goal: true }, eng).includes("unless you turn on AI Sequencing"));
  assert(all({ goal: true }, { ...eng, engineSequencing: true }).includes("next time it chooses your sessions"));
});

Deno.test("All Access: both products are answered for", () => {
  const t = describeEffect({ goal: true, days: true }, { ...base, hasEngine: true, engineSequencing: true });
  assertEquals(t.length, 3);
});

Deno.test("no product: still a true sentence, never empty", () => {
  assertEquals(describeEffect({ goal: true }, { ...base, hasProgramming: false, program: null }), ["Saved to your profile. It's used when you start a program."]);
});

// ── Session length and equipment (2026-11-23) ──────────────────────────────

Deno.test("session length behaves like days and goal for Programming: the unwritten weeks are re-planned", () => {
  assertEquals(describeEffect({ session: true }, base), describeEffect({ days: true }, base));
  assert(all({ session: true }, { ...base, program: { weekly: true, outlineWeeksLeft: 0 } }).includes("applies from your next month"));
  assertEquals(describeEffect({ session: true }, { ...base, program: null }), ["Your program will be built from it."]);
});

Deno.test("session length, Engine-only: said plainly to change nothing on the Engine", () => {
  const eng: EffectFacts = { hasProgramming: false, hasEngine: true, program: null, engineProgramChosen: true, engineSequencing: true };
  const t = describeEffect({ session: true }, eng);
  assertEquals(t.length, 1);
  assert(t[0].includes("doesn't change your Engine sessions"));
  assert(!t[0].includes("Saved to your profile"));
});

Deno.test("equipment, Programming: new weeks are written without it; written days change by asking", () => {
  const t = all({ equipment: true }, base);
  assert(t.includes("New weeks are written without the equipment you don't have"));
  assert(t.includes("open it and ask me there"));
  assert(!t.toLowerCase().includes("next month") && !t.toLowerCase().includes("human") && !t.includes("re-planned"));
  assertEquals(describeEffect({ equipment: true }, { ...base, program: null }), ["Your program will be built with the equipment you have."]);
});

Deno.test("equipment, Engine-only: the Engine does not read the checklist, and the card says so", () => {
  const eng: EffectFacts = { hasProgramming: false, hasEngine: true, program: null, engineProgramChosen: true, engineSequencing: false };
  assertEquals(describeEffect({ equipment: true }, eng), ["This doesn't change your Engine days: you pick your machine when you open each Engine day."]);
});

Deno.test("All Access: session length and equipment are answered for Programming only (the Engine sentence is for Engine-only)", () => {
  const t = describeEffect({ session: true, equipment: true }, { ...base, hasEngine: true, engineSequencing: true });
  assertEquals(t.length, 2);
  assert(!t.join(" ").includes("Engine"));
});
