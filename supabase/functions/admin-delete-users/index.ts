// admin-delete-users — hard-delete a list of user accounts, gated to admins and
// fenced by server-side safety rails so only genuinely-empty ghost/spam
// accounts can ever be removed. Built for cleaning up automated signup-form
// abuse (e.g. hundreds of accounts sharing one bot-filled display name).
//
// An account is DELETABLE only if ALL of these hold (re-checked here regardless
// of what the caller sent):
//   - not role = 'admin'
//   - not a paid subscriber (no active non-manual entitlement)
//   - zero activity: no chat_messages / food_entries / engine_workout_sessions
//     / workout_logs / programs
// Anything that fails a rail is reported in `skipped`, never deleted. Deleting
// auth.users cascades to the app tables (all reference auth.users ON DELETE
// CASCADE).
//
// Request:  { ids: string[] }  (cap MAX_IDS per call; the UI batches)
// Response: { deleted: string[], skipped: {id,reason}[], failed: {id,error}[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MAX_IDS = 200;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !caller) return json({ error: "Unauthorized" }, 401);

    // Admin gate
    const { data: callerProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (callerProfile?.role !== "admin") return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => null);
    const rawIds: unknown = body?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return json({ error: "ids must be a non-empty array" }, 400);
    }
    const ids = Array.from(new Set(rawIds.filter((x): x is string => typeof x === "string")));
    if (ids.length === 0) return json({ error: "no valid ids" }, 400);
    if (ids.length > MAX_IDS) return json({ error: `too many ids (max ${MAX_IDS} per call)` }, 400);

    // ---- Build the protected-id set with a handful of bounded queries ----
    const protectedReason = new Map<string, string>();
    const markAll = (rows: { user_id?: string; id?: string }[] | null, reason: string) => {
      for (const r of rows ?? []) {
        const uid = r.user_id ?? r.id;
        if (uid && !protectedReason.has(uid)) protectedReason.set(uid, reason);
      }
    };

    // admins
    const { data: admins } = await supa
      .from("profiles").select("id").in("id", ids).eq("role", "admin");
    markAll(admins, "admin account");

    // paid subscribers (active, non-manual entitlement). Evaluate in JS rather
    // than via PostgREST or/not filters so a filter quirk can't silently drop
    // the rail — a failed query just yields no rows, which would UNDER-protect.
    const { data: ents } = await supa
      .from("user_entitlements").select("user_id, source, source_kind, expires_at")
      .in("user_id", ids);
    const now = Date.now();
    for (const e of ents ?? []) {
      const active = e.expires_at == null || new Date(e.expires_at).getTime() > now;
      // gym_grant rows are wholesale seats, not retail subscribers — a gym member
      // must not read as a paying subscriber here (would mis-protect + skew counts).
      const paid = active && e.source !== "manual" && e.source !== "admin" && e.source_kind !== "gym_grant";
      if (paid && e.user_id && !protectedReason.has(e.user_id)) {
        protectedReason.set(e.user_id, "paid subscriber");
      }
    }

    // any activity
    const activityTables = [
      "chat_messages",
      "food_entries",
      "engine_workout_sessions",
      "workout_logs",
      "programs",
    ];
    for (const table of activityTables) {
      const { data: rows } = await supa.from(table).select("user_id").in("user_id", ids);
      markAll(rows, "has activity");
    }

    const skipped: { id: string; reason: string }[] = [];
    const deletable: string[] = [];
    for (const id of ids) {
      const reason = protectedReason.get(id);
      if (reason) skipped.push({ id, reason });
      else deletable.push(id);
    }

    // ---- Delete (auth.users delete cascades to app tables) ----
    const deleted: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of deletable) {
      const { error } = await supa.auth.admin.deleteUser(id);
      if (error) failed.push({ id, error: error.message });
      else deleted.push(id);
    }

    return json({ deleted, skipped, failed });
  } catch (err) {
    console.error("[admin-delete-users] Error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
