// signature-draft-queue_test — the queue's contract: enqueue dedup (in
// program, against the library, against the queue itself), identity rules
// (coaching freight never splits, a load change always does, generated and
// admin-entered structures hash together), and the worker's batch
// processing (claim-time re-check, retry accounting, race = dedup).
//
// Run:
//   deno test supabase/functions/_shared/signature-draft-queue_test.ts --allow-env --no-check
//
// Sonnet calls are stubbed via the draftFn/parseFn seams; the supabase
// client is a generic chainable fake driven by per-(table, op) handlers.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalMetconStructure,
  enqueueSignatureDraftForLoggedText,
  enqueueSignatureDraftsForWeeks,
  processClaimedJobs,
  type QueueJob,
} from "./signature-draft-queue.ts";
import { evidenceHashesFor, type SignatureDraft } from "./signature-draft-core.ts";
import type { BlockPrescription } from "./v2-output-schema.ts";

// ── Generic chainable supabase fake ──────────────────────────────────────

interface Captured {
  table: string;
  op: string;
  // deno-lint-ignore no-explicit-any
  row: any;
  // deno-lint-ignore no-explicit-any
  args: Record<string, any>;
}

// deno-lint-ignore no-explicit-any
type Handler = (q: Captured) => { data?: any; error?: any; count?: number };

function fakeSupa(handlers: Record<string, Handler>) {
  const captured: Captured[] = [];
  const makeQuery = (table: string) => {
    const q: Captured = { table, op: "select", row: null, args: {} };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      // deno-lint-ignore no-explicit-any
      then(res: any, rej: any) {
        captured.push(q);
        const h = handlers[`${table}.${q.op}`] ?? (() => ({ data: [], error: null }));
        return Promise.resolve(h(q)).then(res, rej);
      },
    };
    for (
      const m of [
        "select", "overlaps", "eq", "in", "is", "order", "limit", "single",
        "maybeSingle", "like", "not", "delete", "head",
      ]
    ) {
      // deno-lint-ignore no-explicit-any
      chain[m] = (...a: any[]) => {
        if (m === "delete") q.op = "delete";
        q.args[m] = a;
        return chain;
      };
    }
    // deno-lint-ignore no-explicit-any
    chain.insert = (row: any) => {
      q.op = "insert";
      q.row = row;
      return chain;
    };
    // deno-lint-ignore no-explicit-any
    chain.update = (row: any) => {
      q.op = "update";
      q.row = row;
      return chain;
    };
    return chain;
  };
  return {
    client: { from: (table: string) => makeQuery(table) },
    captured,
  };
}

const ok: Handler = () => ({ data: [], error: null });

const STUB_SIG: SignatureDraft = {
  demand: { aerobic_capacity: 60, squat_cycling: 40 },
  discrimination: { aerobic_capacity: 70, squat_cycling: 30 },
  stimulus: { aerobic_capacity: 60, squat_cycling: 40 },
  gates: [],
  time_domain: "medium",
  format: "for_time",
  archetype: "couplet sprint",
  rationale: "stub",
};
const stubDraft = () => Promise.resolve(STUB_SIG);

// deno-lint-ignore no-explicit-any
function metconBlock(extra: Record<string, unknown> = {}, movements?: any[]) {
  return {
    block_type: "metcon",
    scheme_format: { format: "rft", rounds: 3 },
    movements: movements ?? [
      { movement: "Thruster", rep_scheme: [15, 15, 15], weight: 95, weight_unit: "lbs" },
      { movement: "Pull-Up", rep_scheme: [10, 10, 10] },
    ],
    expected_benchmark: null,
    ...extra,
  };
}

// deno-lint-ignore no-explicit-any
function weeksOf(...blocks: any[]) {
  return [{ week_num: 1, days: [{ day_num: 1, blocks }] }];
}

async function structureHashOf(block: ReturnType<typeof metconBlock>): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const clean = canonicalMetconStructure(block as any)!;
  return (await evidenceHashesFor(clean))[0];
}

// ── Enqueue tests ────────────────────────────────────────────────────────

Deno.test("enqueue: in-program duplicates enqueue once; non-metcons skipped", async () => {
  const { client, captured } = fakeSupa({
    "workout_signatures.select": ok,
    "signature_draft_queue.insert": () => ({ error: null }),
  });
  const stats = await enqueueSignatureDraftsForWeeks(
    client,
    weeksOf(metconBlock(), metconBlock(), { block_type: "strength", movements: [] }),
    "test",
  );
  assertEquals(stats.metcons, 2);
  assertEquals(stats.unique_structures, 1);
  assertEquals(stats.enqueued, 1);
  const inserts = captured.filter((c) => c.table === "signature_draft_queue" && c.op === "insert");
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].row.kind, "structure");
  assertEquals(inserts[0].row.priority, 0);
});

Deno.test("enqueue: already-signed structures are skipped", async () => {
  const wsh = await structureHashOf(metconBlock());
  const { client, captured } = fakeSupa({
    "workout_signatures.select": () => ({ data: [{ evidence_hashes: [wsh] }], error: null }),
  });
  const stats = await enqueueSignatureDraftsForWeeks(client, weeksOf(metconBlock()), "test");
  assertEquals(stats.already_signed, 1);
  assertEquals(stats.enqueued, 0);
  assertEquals(captured.filter((c) => c.op === "insert").length, 0);
});

Deno.test("enqueue: queue's own unique index dedups (23505 = already_queued)", async () => {
  const { client } = fakeSupa({
    "workout_signatures.select": ok,
    "signature_draft_queue.insert": () => ({
      error: { code: "23505", message: "duplicate key value" },
    }),
  });
  const stats = await enqueueSignatureDraftsForWeeks(client, weeksOf(metconBlock()), "test");
  assertEquals(stats.already_queued, 1);
  assertEquals(stats.enqueued, 0);
  assertEquals(stats.failed, 0);
});

Deno.test("identity: coaching freight never splits a structure", async () => {
  const a = metconBlock({ block_notes: "go hard" }, [
    { movement: "Thruster", rep_scheme: [21], weight: 95, weight_unit: "lbs", scaling_note: "sub DB", target_pct_1rm: 60 },
  ]);
  const b = metconBlock({}, [
    { movement: "Thruster", rep_scheme: [21], weight: 95, weight_unit: "lbs" },
  ]);
  assertEquals(await structureHashOf(a), await structureHashOf(b));
});

Deno.test("identity: a load change IS a different workout", async () => {
  const a = metconBlock({}, [{ movement: "Thruster", rep_scheme: [21], weight: 95, weight_unit: "lbs" }]);
  const b = metconBlock({}, [{ movement: "Thruster", rep_scheme: [21], weight: 115, weight_unit: "lbs" }]);
  assertEquals((await structureHashOf(a)) === (await structureHashOf(b)), false);
});

Deno.test("identity: generated and admin-entered versions hash together", async () => {
  // Generated: typed scheme_format, header rendered by composeBlockScheme.
  const generated = metconBlock({
    scheme_format: { format: "for_time", rounds_pattern: [21, 15, 9] },
  }, [
    { movement: "Thruster", rep_scheme: [21, 15, 9], weight: 95, weight_unit: "lbs" },
    { movement: "Pull-Up", rep_scheme: [21, 15, 9] },
  ]);
  // Admin: parse-shaped workout with a free-text header (as the admin tool
  // saves it). canonicalScheme collapses both headers onto one enum.
  const admin: BlockPrescription = {
    block_type: "metcon",
    block_scheme: "21-15-9 for time",
    movements: [
      { movement: "Thruster", rep_scheme: [21, 15, 9], weight: 95, weight_unit: "lbs" },
      { movement: "Pull-Up", rep_scheme: [21, 15, 9] },
    ],
  // deno-lint-ignore no-explicit-any
  } as any;
  const genHash = await structureHashOf(generated);
  const adminHash = (await evidenceHashesFor(admin))[0];
  assertEquals(genHash, adminHash);
});

Deno.test("enqueue logged text: priority 1, text-hash key", async () => {
  const { client, captured } = fakeSupa({
    "workout_signatures.select": ok,
    "signature_draft_queue.insert": () => ({ error: null }),
  });
  const stats = await enqueueSignatureDraftForLoggedText(
    client, "21-15-9 thrusters 95 and pull ups", "for time", null, "log-workout",
  );
  assertEquals(stats.enqueued, 1);
  const ins = captured.find((c) => c.op === "insert")!;
  assertEquals(ins.row.kind, "text");
  assertEquals(ins.row.priority, 1);
  assertEquals(String(ins.row.workout_hash).startsWith("wsh1_"), true);
});

// ── Worker tests ─────────────────────────────────────────────────────────

function structureJob(block = metconBlock(), attempts = 1): Promise<QueueJob> {
  return (async () => ({
    id: "job1",
    kind: "structure" as const,
    workout_hash: await structureHashOf(block),
    // deno-lint-ignore no-explicit-any
    payload: { workout: canonicalMetconStructure(block as any), measured: null },
    attempts,
  }))();
}

const measuredStub = () =>
  Promise.resolve({
    median_score: "12:30",
    median_seconds: 750,
    excellent_score: null,
    excellent_seconds: null,
    median_watts: 180,
    excellent_watts: null,
    joules: 140000,
    time_domain: "medium" as const,
    basis: "stub",
    cohort_anchors: [],
    compute_status: "computed" as const,
    calc_version: "20261104T211807Z",
  });

Deno.test("worker: drafts, inserts at draft weight, marks done, stamps engine_version", async () => {
  // deno-lint-ignore no-explicit-any
  const inserted: any[] = [];
  const { client, captured } = fakeSupa({
    "workout_signatures.select": ok, // claim-time re-check: nothing signed
    "workout_signatures.insert": (q) => {
      inserted.push(q.row);
      return { data: { id: "sig1" }, error: null };
    },
    "signature_evidence.update": ok,
    "signature_draft_queue.update": ok,
    "signature_duration_curve.select": ok,
  });
  const job = await structureJob();
  const stats = await processClaimedJobs(client, [job], {
    draftFn: stubDraft,
    measureFn: measuredStub,
    apiKey: "test",
  });
  assertEquals(stats.done, 1);
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].status, "draft");
  assertEquals(inserted[0].source, "generated");
  assertEquals(inserted[0].evidence_hashes.includes(job.workout_hash), true);
  assertEquals(typeof inserted[0].measured.engine_version, "string");
  const mark = captured.filter((c) => c.table === "signature_draft_queue" && c.op === "update");
  assertEquals(mark.length, 1);
  assertEquals(mark[0].row.status, "done");
});

Deno.test("worker: signed since enqueue → already_signed, no draft call", async () => {
  const job = await structureJob();
  let drafted = 0;
  const { client } = fakeSupa({
    "workout_signatures.select": () => ({
      data: [{ id: "sig0", evidence_hashes: [job.workout_hash] }],
      error: null,
    }),
    "workout_signatures.update": ok,
    "signature_evidence.update": ok,
    "signature_draft_queue.update": ok,
  });
  const stats = await processClaimedJobs(client, [job], {
    draftFn: () => {
      drafted++;
      return stubDraft();
    },
    measureFn: measuredStub,
    apiKey: "test",
  });
  assertEquals(stats.already_signed, 1);
  assertEquals(drafted, 0);
});

Deno.test("worker: text job claims the text hash on the signature row", async () => {
  // deno-lint-ignore no-explicit-any
  const inserted: any[] = [];
  const { client } = fakeSupa({
    "workout_signatures.select": ok,
    "workout_signatures.insert": (q) => {
      inserted.push(q.row);
      return { data: { id: "sig1" }, error: null };
    },
    "signature_evidence.update": ok,
    "signature_draft_queue.update": ok,
    "signature_duration_curve.select": ok,
  });
  const job: QueueJob = {
    id: "job2",
    kind: "text",
    workout_hash: "wsh1_texthash0000000000000000000000",
    payload: { text: "21-15-9 thrusters and pull ups", block_scheme: "for time", time_cap_seconds: null },
    attempts: 1,
  };
  const stats = await processClaimedJobs(client, [job], {
    draftFn: stubDraft,
    measureFn: measuredStub,
    // deno-lint-ignore no-explicit-any
    parseFn: () => Promise.resolve(metconBlock() as any),
    apiKey: "test",
  });
  assertEquals(stats.done, 1);
  // The signature claims BOTH the structure hash and the enqueued text hash,
  // so the waiting evidence row joins.
  assertEquals(inserted[0].evidence_hashes.includes(job.workout_hash), true);
  assertEquals(inserted[0].evidence_hashes.some((h: string) => h !== job.workout_hash), true);
});

Deno.test("worker: failure requeues below the cap, fails final at it", async () => {
  const mkClient = () =>
    fakeSupa({
      "workout_signatures.select": ok,
      "signature_draft_queue.update": ok,
      "signature_duration_curve.select": ok,
    });
  const failing = {
    draftFn: () => Promise.reject(new Error("model unavailable")),
    measureFn: measuredStub,
    apiKey: "test",
  };

  const a = mkClient();
  const s1 = await processClaimedJobs(a.client, [await structureJob(metconBlock(), 1)], failing);
  assertEquals(s1.failed_retry, 1);
  const m1 = a.captured.find((c) => c.table === "signature_draft_queue" && c.op === "update")!;
  assertEquals(m1.row.status, "queued");

  const b = mkClient();
  const s2 = await processClaimedJobs(b.client, [await structureJob(metconBlock(), 3)], failing);
  assertEquals(s2.failed_final, 1);
  const m2 = b.captured.find((c) => c.table === "signature_draft_queue" && c.op === "update")!;
  assertEquals(m2.row.status, "failed");
});

Deno.test("worker: insert race (23505) counts as already_signed", async () => {
  const { client } = fakeSupa({
    "workout_signatures.select": ok,
    "workout_signatures.insert": () => ({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    }),
    "signature_draft_queue.update": ok,
    "signature_duration_curve.select": ok,
  });
  const stats = await processClaimedJobs(client, [await structureJob()], {
    draftFn: stubDraft,
    measureFn: measuredStub,
    apiKey: "test",
  });
  assertEquals(stats.already_signed, 1);
  assertEquals(stats.failed_retry, 0);
});
