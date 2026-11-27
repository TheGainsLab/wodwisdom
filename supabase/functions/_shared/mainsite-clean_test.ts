// The main site workouts are cleaned ONCE to the workout itself, so the composer
// can be shown them as examples of well-written workouts (founder, 2026-11-27).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanMainsiteWorkout } from "./mainsite-clean.ts";

const entry = (kind: string, wod: string) => `Date: 2014-03-01 | Day: Saturday | Year: 2014\nCategory: ${kind}\nMovements: pull-up, thruster\nWOD: ${wod}`;

Deno.test("the workout and its name are kept; comment prompts and links to old dates are cut", () => {
  const c = cleanMainsiteWorkout(entry("For Time", "**Fran** \n21-15-9 reps for time of: \n95-lb. thrusters \nPull-ups \nPost time to comments. \nCompare to [131112](http://www.crossfit.com/mt-archive2/009032.html)."))!;
  assertEquals(c.name, "Fran");
  assertEquals(c.text, "Fran\n21-15-9 reps for time of:\n95-lb. thrusters\nPull-ups");
  assertEquals([c.date, c.kind], ["2014-03-01", "For Time"]);
});

Deno.test("links become plain text; loads for women and men stay", () => {
  const c = cleanMainsiteWorkout(entry("For Time", "3 rounds for time: \n15 [hang power snatches](https://www.crossfit.com/essentials/x?utm=1) \n15 [pull-ups](https://www.crossfit.com/y)\n♀ 65 lb \n♂ 95 lb\nPost time to [comments](https://www.crossfit.com/240108).\n**Scaling:** \nToday's workout is short."))!;
  assertEquals(c.text, "3 rounds for time:\n15 hang power snatches\n15 pull-ups\n♀ 65 lb\n♂ 95 lb");
  assertEquals(c.name, null);
});

Deno.test("scaling is cut, wherever and however it is written", () => {
  for (const tail of [
    "If you cannot do the muscle-ups do 120 pull-ups and 120 dips.",
    "**Scaling:**\nReduce the load.",
    "**Beginner option:**\n3 rounds",
    "**Intermediate option:**\n3 rounds",
    "Scroll for scaling options.",
    "Scale as needed.",
  ]) {
    const c = cleanMainsiteWorkout(entry("For Time", `30 Muscle-ups for time\n${tail}`))!;
    assertEquals(c.text, "30 Muscle-ups for time", tail);
  }
});

Deno.test("a tribute is cut and the hero workout stays; a dedication above the workout is cut too", () => {
  const hero = cleanMainsiteWorkout(entry("For Time", "**Operation Red Wings**\nFor time:\n3/4-mile run\n47 goblet squats\n_On June 28, 2005, an MH-47 Chinook helicopter carrying a Quick Reaction Force of eight Navy SEALs and eight Army Night Stalkers were killed in action._\nPost time to comments."))!;
  assertEquals(hero.text, "Operation Red Wings\nFor time:\n3/4-mile run\n47 goblet squats");
  const honor = cleanMainsiteWorkout(entry("For Time", 'In honor of **["Jeremy"](http://x.com/a.html)** \nThree rounds, 21-15- and 9 reps, for time of: \n95 pound Overhead squats \nBurpees'))!;
  assertEquals(honor.text, "Three rounds, 21-15- and 9 reps, for time of:\n95 pound Overhead squats\nBurpees");
});

Deno.test("notes, other people's results, coaching and page furniture are cut", () => {
  for (const tail of [
    "**Stimulus and Strategy:**\nPlan for it to take time.",
    "**Coaching cues:**\nKeep the bar close.",
    "---\nRelated: \n• Tips With Rory",
    "Pat Barber 17:31, Rob Orlando 19:34, Laurie Galassi 22:12",
    "Can you beat Matt Mast's time at 3:34?",
    "Submit time for all 5 rounds to comments.",
    "**Featured photo:** somebody",
  ]) {
    const c = cleanMainsiteWorkout(entry("AMRAP", `Complete as many rounds as possible in 20 minutes of:\n5 Pull-ups\n10 Push-ups\n15 Squats\n${tail}`))!;
    assertEquals(c.text, "Complete as many rounds as possible in 20 minutes of:\n5 Pull-ups\n10 Push-ups\n15 Squats", tail);
  }
});

Deno.test("rest inside a workout is part of the workout and stays", () => {
  const c = cleanMainsiteWorkout(entry("For Time", "3 rounds, each for time, of:\nRow 500 meters\nRest 3 minutes\nPost times to comments."))!;
  assertEquals(c.text, "3 rounds, each for time, of:\nRow 500 meters\nRest 3 minutes");
});

Deno.test("strength days, other entries, and entries with nothing left are not examples", () => {
  assertEquals(cleanMainsiteWorkout(entry("Strength", "Back squat 5-5-5-5-5")), null);
  assertEquals(cleanMainsiteWorkout(entry("Other", "Rest Day")), null);
  assertEquals(cleanMainsiteWorkout(entry("For Time", "Post time to comments.")), null);
  assertEquals(cleanMainsiteWorkout(entry("For Time", "**Fran**\nPost time to comments.")), null);
  assert(cleanMainsiteWorkout("no header at all") === null);
});

Deno.test("the one-time fill never changes an original, stores nothing on a dry run, and is service role only", () => {
  const fn = Deno.readTextFileSync(new URL("../clean-mainsite-examples/index.ts", import.meta.url));
  // The library (chunks) is only read.
  assert(fn.includes('.from("chunks").select("id, content").eq("category", "mainsite")'));
  for (const write of ['.from("chunks").update', '.from("chunks").delete', '.from("chunks").insert', '.from("chunks").upsert']) assert(!fn.includes(write), write);
  assertEquals(fn.split(".upsert(").length - 1, 1);
  assert(fn.includes('.from("mainsite_examples").upsert('));
  assert(fn.includes('searchParams.get("dry_run") !== "false"'));
  assert(fn.indexOf("if (dryRun) {") < fn.indexOf('.from("mainsite_examples").upsert('));
  assert(fn.includes('return json({ error: "service role only" }, 401)'));
});
