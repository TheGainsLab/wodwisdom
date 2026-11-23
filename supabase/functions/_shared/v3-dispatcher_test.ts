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
    "coach_state",
    "skeleton",
    "metcons",
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

// ── A first build cannot be saved as two programs (2026-11-23) ─────────────
import { firstBuildSavePlan, persistCreatedProgramId, type ResumeState } from "./v3-dispatcher.ts";
import { memorySupa } from "./fixtures/memory-supa.ts";

const RS: ResumeState = { continuation: { programId: null, monthNumber: 1 } };

Deno.test("the new program's id is written onto the job as soon as the program exists, without ending the stage", async () => {
  const db = memorySupa({ program_jobs: [{ id: "job", claim_token: "tok", status: "processing", next_stage: "saving", resume_state: RS }] });
  assertEquals(await persistCreatedProgramId(db.supa, "job", "tok", RS, "prog-new"), true);
  const job = db.tables.program_jobs[0];
  assertEquals(job.resume_state.programId, "prog-new");
  assertEquals(job.resume_state.continuation, RS.continuation); // the rest of the state is kept
  assertEquals([job.status, job.next_stage, job.claim_token], ["processing", "saving", "tok"]); // still claimed, still saving
});

Deno.test("a worker that no longer owns the job cannot record a program on it", async () => {
  const db = memorySupa({ program_jobs: [{ id: "job", claim_token: "someone-else", resume_state: RS }] });
  assertEquals(await persistCreatedProgramId(db.supa, "job", "tok", RS, "prog-new"), false);
  assertEquals(db.tables.program_jobs[0].resume_state.programId, undefined);
});

Deno.test("a re-entered saving stage of a first build saves again into the SAME program instead of skipping or making a second one", () => {
  // The earlier attempt created the program, claimed the month, and was lost mid-save.
  assertEquals(firstBuildSavePlan({ markerExists: true, continuationProgramId: null, resumedProgramId: "prog-new" }), "redo");
  // Lost before it claimed the month: an ordinary save into the same program.
  assertEquals(firstBuildSavePlan({ markerExists: false, continuationProgramId: null, resumedProgramId: "prog-new" }), "save");
});

Deno.test("a month already saved on an existing program is still skipped, never cleared", () => {
  assertEquals(firstBuildSavePlan({ markerExists: true, continuationProgramId: "prog-old", resumedProgramId: null }), "skip");
  assertEquals(firstBuildSavePlan({ markerExists: true, continuationProgramId: "prog-old", resumedProgramId: "prog-old" }), "skip");
  assertEquals(firstBuildSavePlan({ markerExists: false, continuationProgramId: "prog-old", resumedProgramId: null }), "save");
  assertEquals(firstBuildSavePlan({ markerExists: false, continuationProgramId: null, resumedProgramId: null }), "save");
});
