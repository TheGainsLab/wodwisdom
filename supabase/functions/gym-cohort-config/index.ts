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
import { ALL_EQUIPMENT_KEYS } from "../_shared/tier-status.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-cohort-config",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_EQUIPMENT = new Set<string>(ALL_EQUIPMENT_KEYS);
const TARGET_LEVELS = new Set(["beginner", "intermediate", "advanced"]);
const UNITS = new Set(["lbs", "kg"]);
// The row's public shape (everything except claim/backoff bookkeeping).
const SELECT_COLS =
  "gym_id, domain_pack, days_per_week, session_length_minutes, equipment, target_level, do_not_program, units, goal_text, strategy, active, last_generated_at, created_at, updated_at";

interface ConfigInput {
  days_per_week?: unknown;
  session_length_minutes?: unknown;
  equipment?: unknown;
  target_level?: unknown;
  do_not_program?: unknown;
  units?: unknown;
  goal_text?: unknown;
  strategy?: unknown;
  active?: unknown;
}

/** Validate + whitelist the writable fields. Returns { patch } or { error }.
 *  Only provided keys are written (partial update). */
function buildPatch(config: ConfigInput): { patch?: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};

  if (config.days_per_week !== undefined) {
    const d = config.days_per_week;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 3 || d > 6) {
      return { error: "days_per_week must be an integer 3-6" };
    }
    patch.days_per_week = d;
  }
  if (config.session_length_minutes !== undefined) {
    const s = config.session_length_minutes;
    if (s !== null && (typeof s !== "number" || !Number.isFinite(s) || s < 20 || s > 180)) {
      return { error: "session_length_minutes must be null or 20-180" };
    }
    patch.session_length_minutes = s;
  }
  if (config.equipment !== undefined) {
    if (!Array.isArray(config.equipment) || config.equipment.some((e) => typeof e !== "string")) {
      return { error: "equipment must be a string array" };
    }
    const keys = (config.equipment as string[]).map((e) => e.trim());
    const unknown = keys.filter((k) => !CANONICAL_EQUIPMENT.has(k));
    if (unknown.length > 0) {
      // Reject rather than silently drop — a typo'd key reads as "not owned"
      // and quietly hobbles every generation for the gym.
      return { error: `unknown equipment key(s): ${unknown.join(", ")}. Canonical: ${ALL_EQUIPMENT_KEYS.join(", ")}` };
    }
    patch.equipment = keys;
  }
  if (config.target_level !== undefined) {
    if (typeof config.target_level !== "string" || !TARGET_LEVELS.has(config.target_level)) {
      return { error: "target_level must be beginner|intermediate|advanced" };
    }
    patch.target_level = config.target_level;
  }
  if (config.do_not_program !== undefined) {
    if (!Array.isArray(config.do_not_program) || config.do_not_program.some((e) => typeof e !== "string")) {
      return { error: "do_not_program must be a string array" };
    }
    patch.do_not_program = (config.do_not_program as string[]).map((s) => s.trim()).filter(Boolean);
  }
  if (config.units !== undefined) {
    if (typeof config.units !== "string" || !UNITS.has(config.units)) {
      return { error: "units must be lbs|kg" };
    }
    patch.units = config.units;
  }
  if (config.goal_text !== undefined) {
    if (config.goal_text !== null && typeof config.goal_text !== "string") {
      return { error: "goal_text must be a string or null" };
    }
    patch.goal_text = config.goal_text === null ? null : (config.goal_text as string).slice(0, 4000);
  }
  if (config.strategy !== undefined) {
    // Shape-checked lightly here; the envelope builder is the semantic reader
    // (clamps slider values, resolves the split). Reject non-objects so a
    // stringified-JSON mistake can't be stored as a jsonb string.
    if (config.strategy !== null && (typeof config.strategy !== "object" || Array.isArray(config.strategy))) {
      return { error: "strategy must be an object or null" };
    }
    patch.strategy = config.strategy;
  }
  if (config.active !== undefined) {
    if (typeof config.active !== "boolean") return { error: "active must be a boolean" };
    patch.active = config.active;
  }

  if (Object.keys(patch).length === 0) return { error: "config has no writable fields" };
  return { patch };
}

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
    const built = buildPatch((body.config ?? {}) as ConfigInput);
    if (built.error) return json({ error: "invalid_config", detail: built.error }, 400);

    // Partial update when the row exists; insert (DB defaults fill the rest,
    // including domain_pack = the class pack) when it doesn't.
    const { data: existing, error: readErr } = await supa
      .from("gym_cohort_configs")
      .select("gym_id")
      .eq("gym_id", gymId)
      .maybeSingle();
    if (readErr) return json({ error: "read_failed", detail: readErr.message }, 500);

    const write = existing
      ? supa.from("gym_cohort_configs").update(built.patch!).eq("gym_id", gymId).select(SELECT_COLS).single()
      : supa.from("gym_cohort_configs").insert({ gym_id: gymId, ...built.patch! }).select(SELECT_COLS).single();
    const { data, error } = await write;
    if (error) return json({ error: "write_failed", detail: error.message }, 500);

    console.log(JSON.stringify({
      at: "gym-cohort-config",
      event: "upsert",
      key_fp: authResult.fingerprint,
      gym_id: gymId,
      fields: Object.keys(built.patch!),
      created: !existing,
    }));
    return json({ config: data, created: !existing });
  }

  return json({ error: "invalid_request", detail: "action must be get|upsert" }, 400);
});
