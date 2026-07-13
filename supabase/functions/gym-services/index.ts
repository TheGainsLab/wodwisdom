/**
 * gym-services — the generation seam (SERVICE_API_CONTRACT v2; Decision 12a).
 *
 * THE GENERATION RULE: wodwisdom GENERATES; everything generated LIVES ON THE
 * PLATFORM; wodwisdom is NEVER in the member's runtime path. This function is
 * invoked by the AFFILIATE BACKEND at block boundaries only. Zero member
 * identity in any request or response; nothing is stored here.
 *
 * Action: engine_generate_block
 *   { gym_id, prefs?, athlete?: { baseline }, history?: [...], memo? }
 *   → { block: { label, days: [ResolvedEngineDay…] }, memo }
 *
 * v1 semantics: the block is the next calendar month of the authored 720-day
 * Engine catalog (program main_5day), each day expanded into its concrete
 * segment timeline with pace FRACTIONS + scoring_params (the member app
 * multiplies by its locally stored baseline — engine_ratio_v1). `memo` v1 is
 * `{ v: 1, program: 'main_5day', next_day: N }`; bootstrap (memo null) starts
 * at day 1, whose opening days establish the time-trial baseline. `athlete` /
 * `history` are ACCEPTED and currently unused (reserved for the adaptive
 * sequencer — the AI self-sequencer runs from explicit inputs in a later rev;
 * the deterministic catalog is the v1 progression, same as retail default).
 *
 * Auth: the tenant-bound wholesale consumer-key family (_shared/consumer-auth.ts).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import {
  resolveEngineDay,
  type CatalogEngineDay,
} from "../_shared/engine-block-resolve.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-services",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROGRAM = "main_5day"; // v1: the authored catalog progression
const CATALOG_MAX_DAY = 720;

interface Memo {
  v: number;
  program: string;
  next_day: number;
}

function parseMemo(raw: unknown): Memo | { error: string } {
  if (raw === null || raw === undefined) return { v: 1, program: PROGRAM, next_day: 1 };
  if (typeof raw !== "object") return { error: "memo must be an object or null" };
  const m = raw as Record<string, unknown>;
  const nextDay = typeof m.next_day === "number" ? m.next_day : NaN;
  if (!Number.isInteger(nextDay) || nextDay < 1) return { error: "memo.next_day invalid" };
  if (nextDay > CATALOG_MAX_DAY) return { error: "progression_complete" };
  // Migrate-forward on receipt (contract §3): unknown fields ignored, version
  // normalized. v1 is the only version.
  return { v: 1, program: PROGRAM, next_day: nextDay };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);
  const { authz } = authResult;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return json({ error: "invalid_json" }, 400); }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  if (!auth.authorizes(authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "engine_generate_block") {
    return json({ error: "invalid_request", detail: "action must be engine_generate_block" }, 400);
  }

  const memo = parseMemo(body.memo);
  if ("error" in memo) {
    if (memo.error === "progression_complete") {
      return json({ error: "progression_complete", detail: "the member has completed the full catalog" }, 409);
    }
    return json({ error: "invalid_request", detail: memo.error }, 400);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // The next catalog slice: everything remaining in the month `next_day` sits in.
  const { data: probe, error: probeErr } = await supa
    .from("engine_workouts")
    .select("month")
    .eq("program_type", PROGRAM)
    .eq("day_number", memo.next_day)
    .maybeSingle();
  if (probeErr) return json({ error: "read_failed", detail: probeErr.message }, 500);
  if (!probe) return json({ error: "progression_complete", detail: "no catalog day at position" }, 409);
  const month = (probe as { month: number | null }).month ?? 1;

  const { data: rows, error: daysErr } = await supa
    .from("engine_workouts")
    .select("day_number, day_type, phase, month, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, total_duration_minutes")
    .eq("program_type", PROGRAM)
    .eq("month", month)
    .gte("day_number", memo.next_day)
    .order("day_number", { ascending: true });
  if (daysErr) return json({ error: "read_failed", detail: daysErr.message }, 500);
  const days = (rows ?? []) as unknown as CatalogEngineDay[];
  if (days.length === 0) return json({ error: "progression_complete", detail: "no days in slice" }, 409);

  // Day-type display metadata (names + coaching intent).
  const { data: typeRows, error: typesErr } = await supa
    .from("engine_day_types")
    .select("id, name, coaching_intent");
  if (typesErr) return json({ error: "read_failed", detail: typesErr.message }, 500);
  const meta = new Map(
    ((typeRows ?? []) as { id: string; name: string; coaching_intent: string | null }[])
      .map((t) => [t.id, { title: t.name, coaching_intent: t.coaching_intent }]),
  );

  const resolved = days.map((d) =>
    resolveEngineDay(d, meta.get(d.day_type) ?? { title: d.day_type, coaching_intent: null }));

  const lastDay = days[days.length - 1].day_number;
  console.log(JSON.stringify({
    at: "gym-services", event: "engine_generate_block", gym_id: gymId,
    month, from: memo.next_day, days: resolved.length,
  }));
  return json({
    block: { label: `Month ${month}`, month, days: resolved },
    memo: { v: 1, program: PROGRAM, next_day: lastDay + 1 },
  });
});
