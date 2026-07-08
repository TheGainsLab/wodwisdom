/**
 * gym-cohort-config — the affiliate portal's door to a gym's cohort program
 * spec (the OWNER BRIEF seam).
 *
 * gym_cohort_configs was designed to be "populated by the affiliate portal via
 * a consumer-keyed endpoint" (its migration header) — this is that endpoint.
 * The portal's brief form (gym overview, month goals, priority sliders,
 * strength/skills split) writes here; the staged generator (gym-cohort-cron →
 * gym-generate) reads the row on its next run.
 *
 * Auth: the WHOLESALE key family (createConsumerAuth — same discipline and the
 * SAME keys as wholesale-grants, so the portal reuses its existing
 * tenant-bound credential; no new secret). gym_id is the tenant (= the gym's
 * affiliate community id); a consumer key may only touch its bound tenant(s).
 *
 * POST { gym_id, action: "get" }             -> the gym's config row (or null)
 * POST { gym_id, action: "upsert", config }  -> partial upsert; returns the row
 *
 * Upsertable fields (whitelist — cadence/backoff bookkeeping is NEVER writable
 * from outside): days_per_week, session_length_minutes, equipment,
 * target_level, do_not_program, units, goal_text, strategy, active.
 * Equipment keys are filtered to the canonical vocabulary (a typo'd key would
 * silently read as "gym doesn't own it" — the 2026-07-07 seed-row lesson).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { buildConfigPatch, type ConfigInput } from "../_shared/gym-cohort-config-validate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-cohort-config",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The row's public shape (everything except claim/backoff bookkeeping).
const SELECT_COLS =
  "gym_id, domain_pack, days_per_week, session_length_minutes, equipment, target_level, do_not_program, units, goal_text, strategy, active, last_generated_at, created_at, updated_at";

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: constant-time, tenant-bound (the wholesale key family) ────────────
  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);

  let body: { gym_id?: unknown; action?: unknown; config?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  if (!auth.authorizes(authResult.authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }
  const action = typeof body.action === "string" ? body.action : "";

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (action === "get") {
    const { data, error } = await supa
      .from("gym_cohort_configs")
      .select(SELECT_COLS)
      .eq("gym_id", gymId)
      .maybeSingle();
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    return json({ config: data ?? null });
  }

  if (action === "upsert") {
    const built = buildConfigPatch((body.config ?? {}) as ConfigInput);
    if (built.error) return json({ error: "invalid_config", detail: built.error }, 400);

    // Partial update when the row exists; insert (DB defaults fill the rest,
    // including domain_pack = the class pack) when it doesn't.
    const { data: existing, error: readErr } = await supa
      .from("gym_cohort_configs")
      .select("gym_id")
      .eq("gym_id", gymId)
      .maybeSingle();
    if (readErr) return json({ error: "read_failed", detail: readErr.message }, 500);

    let created = !existing;
    let data: unknown;
    if (existing) {
      const upd = await supa.from("gym_cohort_configs").update(built.patch!).eq("gym_id", gymId).select(SELECT_COLS).single();
      if (upd.error) return json({ error: "write_failed", detail: upd.error.message }, 500);
      data = upd.data;
    } else {
      const ins = await supa.from("gym_cohort_configs").insert({ gym_id: gymId, ...built.patch! }).select(SELECT_COLS).single();
      if (ins.error) {
        // Concurrent first-brief (double-click/retry): the PK already exists —
        // the loser falls through to an update so the form is idempotent under
        // duplicate submit instead of surfacing a raw 500.
        const isDup = ins.error.code === "23505" || /duplicate key|already exists/i.test(ins.error.message ?? "");
        if (!isDup) return json({ error: "write_failed", detail: ins.error.message }, 500);
        const upd = await supa.from("gym_cohort_configs").update(built.patch!).eq("gym_id", gymId).select(SELECT_COLS).single();
        if (upd.error) return json({ error: "write_failed", detail: upd.error.message }, 500);
        data = upd.data;
        created = false;
      } else {
        data = ins.data;
      }
    }

    console.log(JSON.stringify({
      at: "gym-cohort-config",
      event: "upsert",
      key_fp: authResult.fingerprint,
      gym_id: gymId,
      fields: Object.keys(built.patch!),
      created,
    }));
    return json({ config: data, created });
  }

  return json({ error: "invalid_request", detail: "action must be get|upsert" }, 400);
});
