// signature-autodraft_test — the generation-time draft hook's contract:
// hash-dedup first (in-program, cross-time, and under the insert race),
// budget cap, coaching-freight-insensitive identity, and never-throw.
//
// Run:
//   deno test supabase/functions/_shared/signature-autodraft_test.ts --allow-env --no-check
//
// The Sonnet call is stubbed via the draftFn seam; the supabase client is a
// minimal fake covering exactly the three query shapes the hook makes.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  autodraftSignaturesForWeeks,
  canonicalMetconStructure,
} from "./signature-autodraft.ts";
import type { SignatureDraft } from "./signature-draft-core.ts";

// ── Fakes ────────────────────────────────────────────────────────────────

interface FakeOpts {
  /** evidence_hashes arrays of pre-existing signature rows. */
  existing?: string[][];
  /** Error every insert returns (e.g. a 23505 race). */
  insertError?: { code?: string; message: string } | null;
  /** Error the dedup lookup returns. */
  lookupError?: { message: string } | null;
}

function fakeSupa(opts: FakeOpts = {}) {
  // deno-lint-ignore no-explicit-any
  const inserted: any[] = [];
  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            overlaps(_col: string, _hashes: string[]) {
              if (opts.lookupError) {
                return Promise.resolve({ data: null, error: opts.lookupError });
              }
              return Promise.resolve({
                data: (opts.existing ?? []).map((h) => ({ evidence_hashes: h })),
                error: null,
              });
            },
          };
        },
        // deno-lint-ignore no-explicit-any
        insert(row: any) {
          return {
            select(_c: string) {
              return {
                single() {
                  if (opts.insertError) {
                    return Promise.resolve({ data: null, error: opts.insertError });
                  }
                  inserted.push(row);
                  return Promise.resolve({ data: { id: `id_${inserted.length}` }, error: null });
                },
              };
            },
          };
        },
        // claimEvidence path
        // deno-lint-ignore no-explicit-any
        update(_v: any) {
          return {
            in(_c: string, _h: string[]) {
              return {
                is(_c2: string, _v2: null) {
                  return {
                    select(_c3: string) {
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, inserted };
}

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

// ── Tests ────────────────────────────────────────────────────────────────

Deno.test("in-program dedup: identical structures draft once", async () => {
  const { client, inserted } = fakeSupa();
  const stats = await autodraftSignaturesForWeeks(
    client,
    weeksOf(metconBlock(), metconBlock(), { block_type: "strength", movements: [] }),
    { draftFn: stubDraft, apiKey: "test" },
  );
  assertEquals(stats.metcons, 2);
  assertEquals(stats.unique_structures, 1);
  assertEquals(stats.drafted, 1);
  assertEquals(stats.failed, 0);
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].source, "generated");
  assertEquals(inserted[0].status, "draft");
  assertEquals(inserted[0].evidence_hashes.length, 1);
});

Deno.test("coaching freight does not split identity", async () => {
  const a = metconBlock({ block_notes: "go hard" }, [
    { movement: "Thruster", rep_scheme: [15, 15, 15], weight: 95, weight_unit: "lbs", scaling_note: "sub DB", target_pct_1rm: 60 },
  ]);
  const b = metconBlock({}, [
    { movement: "Thruster", rep_scheme: [15, 15, 15], weight: 95, weight_unit: "lbs" },
  ]);
  const { client } = fakeSupa();
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(a, b), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  assertEquals(stats.unique_structures, 1);
  assertEquals(stats.drafted, 1);
});

Deno.test("a load change IS a different workout", async () => {
  const a = metconBlock({}, [
    { movement: "Thruster", rep_scheme: [15, 15, 15], weight: 95, weight_unit: "lbs" },
  ]);
  const b = metconBlock({}, [
    { movement: "Thruster", rep_scheme: [15, 15, 15], weight: 115, weight_unit: "lbs" },
  ]);
  const { client } = fakeSupa();
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(a, b), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  assertEquals(stats.unique_structures, 2);
  assertEquals(stats.drafted, 2);
});

Deno.test("cross-time dedup: existing signature's hash is reused, not re-drafted", async () => {
  // First run captures the hash the hook mints for this structure.
  const probe = fakeSupa();
  await autodraftSignaturesForWeeks(probe.client, weeksOf(metconBlock()), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  const wsh = probe.inserted[0].evidence_hashes[0] as string;

  const { client, inserted } = fakeSupa({ existing: [[wsh]] });
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(metconBlock()), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  assertEquals(stats.reused, 1);
  assertEquals(stats.drafted, 0);
  assertEquals(inserted.length, 0);
});

Deno.test("budget cap: novel structures beyond maxDrafts are skipped, not failed", async () => {
  const blocks = [95, 115, 135].map((w) =>
    metconBlock({}, [{ movement: "Thruster", rep_scheme: [21], weight: w, weight_unit: "lbs" }])
  );
  const { client } = fakeSupa();
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(...blocks), {
    draftFn: stubDraft,
    apiKey: "test",
    maxDrafts: 2,
  });
  assertEquals(stats.unique_structures, 3);
  assertEquals(stats.drafted, 2);
  assertEquals(stats.budget_skipped, 1);
  assertEquals(stats.failed, 0);
});

Deno.test("insert race (23505) counts as dedup, not failure", async () => {
  const { client } = fakeSupa({
    insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
  });
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(metconBlock()), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  assertEquals(stats.reused, 1);
  assertEquals(stats.drafted, 0);
  assertEquals(stats.failed, 0);
});

Deno.test("a throwing draft is counted and contained", async () => {
  const { client } = fakeSupa();
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(metconBlock()), {
    draftFn: () => Promise.reject(new Error("model unavailable")),
    apiKey: "test",
  });
  assertEquals(stats.failed, 1);
  assertEquals(stats.drafted, 0);
});

Deno.test("dedup lookup failure bails without drafting (no duplicate risk)", async () => {
  const { client, inserted } = fakeSupa({ lookupError: { message: "connection reset" } });
  const stats = await autodraftSignaturesForWeeks(client, weeksOf(metconBlock()), {
    draftFn: stubDraft,
    apiKey: "test",
  });
  assertEquals(stats.drafted, 0);
  assertEquals(stats.failed, 1);
  assertEquals(inserted.length, 0);
});

Deno.test("canonicalMetconStructure renders the scheme header like save does", () => {
  const clean = canonicalMetconStructure(
    // deno-lint-ignore no-explicit-any
    metconBlock() as any,
  );
  assertEquals(typeof clean?.block_scheme, "string");
  assertEquals((clean?.block_scheme ?? "").length > 0, true);
  // deno-lint-ignore no-explicit-any
  const m = (clean?.movements ?? [])[0] as any;
  assertEquals(m.scaling_note, undefined);
  assertEquals(m.target_pct_1rm, undefined);
});
