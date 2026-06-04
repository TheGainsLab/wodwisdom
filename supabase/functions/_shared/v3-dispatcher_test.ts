/**
 * v3-dispatcher_test.ts — pure-function guards for the dispatcher wiring.
 *
 * These do NOT exercise the DB lease (that needs real Postgres — proven instead
 * by the post-deploy 6-day run). They catch wiring mistakes: a mis-ordered stage
 * list, a stage misclassified writer/non-writer (which would change the
 * reaper's resume behavior and could re-roll a writer stage).
 *
 * Run: deno test supabase/functions/_shared/v3-dispatcher_test.ts --no-check
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FIRST_STAGE,
  isWriterStage,
  nextLinearStage,
  type Stage,
} from "./v3-dispatcher.ts";

Deno.test("kickoff starts at payload_building", () => {
  assertEquals(FIRST_STAGE, "payload_building");
});

Deno.test("linear stage order is the full pipeline with no skips", () => {
  // Walk the chain from the first stage; surgical is the only self-re-entering
  // stage (handled inside its stage fn), so the linear walk passes through it
  // exactly once. The walk must hit every stage in order and end at complete.
  const walked: Stage[] = [];
  let s: Stage | "complete" = FIRST_STAGE;
  while (s !== "complete") {
    walked.push(s);
    s = nextLinearStage(s);
  }
  assertEquals(walked, [
    "payload_building",
    "skeleton",
    "fill_week_1",
    "fill_week_2",
    "fill_week_3",
    "fill_week_4",
    "benchmark_audit",
    "surgical",
    "safety_review",
    "saving",
  ]);
});

Deno.test("saving is terminal (advances to complete)", () => {
  assertEquals(nextLinearStage("saving"), "complete");
});

Deno.test("writer stages are exactly skeleton + the four fills + surgical", () => {
  const writer: Stage[] = [
    "skeleton",
    "fill_week_1",
    "fill_week_2",
    "fill_week_3",
    "fill_week_4",
    "surgical",
  ];
  for (const s of writer) {
    assertEquals(isWriterStage(s), true, `${s} should be a writer stage`);
  }
});

Deno.test("non-writer stages are not reaper-retried on throw", () => {
  // These do their own transient retries internally; a throw fails the job.
  // (The classification matters because writer-throws must NOT be re-rolled.)
  const nonWriter: Stage[] = [
    "payload_building",
    "benchmark_audit",
    "safety_review",
    "saving",
  ];
  for (const s of nonWriter) {
    assertEquals(isWriterStage(s), false, `${s} should NOT be a writer stage`);
  }
});
