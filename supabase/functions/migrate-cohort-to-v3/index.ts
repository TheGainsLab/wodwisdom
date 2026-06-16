/**
 * migrate-cohort-to-v3 — ONE-SHOT admin migration.
 *
 * Existing users were all generated under v1 (program_version='v1') and are
 * stuck at month 1 (continuation never worked: dead cron + the server-to-server
 * eval-auth bug). First-gen is now v3, so v1 is a closed, finite set.
 *
 * This drives the migration for the users who are DUE NOW:
 *   - latest generated program is non-v3 AND older than `overdue_days` → migrate
 *     (generate-next-month routes v1 → a NEW v3 program at month N+1; old program
 *     stays as history).
 *   - no generated program at all → first-gen v3 month 1.
 * Not-yet-due v1 users (program younger than overdue_days) are LEFT — the
 * now-version-aware cron/webhook migrate them when they actually come due, so no
 * one gets an early month. Only ACTIVE programming subscribers are touched.
 *
 * Body: { dry_run?: boolean, overdue_days?: number (default 28), limit?: number (default 20) }
 * Auth: admin user JWT, or the service-role key.
 *
 * Idempotent-ish: a user already on v3 is skipped (their latest program is v3).
 * Don't re-run while a batch is still generating (those users are still v1 until
 * their job completes, so a re-run could double-fire them).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" });
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");

    // Auth: service key, or an admin user JWT.
    if (token !== SUPABASE_SERVICE_KEY) {
      const { data: { user }, error } = await supa.auth.getUser(token);
      if (error || !user) return json(401, { error: "Unauthorized" });
      const { data: profile } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role !== "admin") return json(403, { error: "Forbidden", message: "admin only" });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const overdueDays = typeof body?.overdue_days === "number" ? body.overdue_days : 28;
    const limit = typeof body?.limit === "number" ? body.limit : 20;

    const nowMs = Date.now();
    const cutoffIso = new Date(nowMs - overdueDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Active programming subscribers.
    const { data: ents } = await supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", "programming")
      .or("expires_at.is.null,expires_at.gt." + new Date(nowMs).toISOString());
    const activeUsers = Array.from(new Set((ents ?? []).map((e) => e.user_id as string)));

    // 2. Classify each: their latest generated program decides eligibility.
    const eligible: { userId: string; mode: string; programId: string | null }[] = [];
    const skipped: { userId: string; reason: string }[] = [];
    for (const userId of activeUsers) {
      const { data: progs } = await supa
        .from("programs")
        .select("id, program_version, created_at, generated_months")
        .eq("user_id", userId)
        .eq("source", "generated")
        .order("created_at", { ascending: false })
        .limit(1);
      const latest = progs?.[0];
      if (!latest) {
        eligible.push({ userId, mode: "firstgen", programId: null });
      } else if (latest.program_version === "v3") {
        skipped.push({ userId, reason: "already v3" });
      } else if ((latest.created_at as string) < cutoffIso) {
        eligible.push({ userId, mode: "migrate", programId: latest.id as string });
      } else {
        skipped.push({ userId, reason: "not due yet (program younger than overdue window)" });
      }
    }

    const toRun = eligible.slice(0, limit);
    const deferred = eligible.slice(limit);

    if (dryRun) {
      return json(200, {
        dry_run: true,
        overdue_days: overdueDays,
        active_users: activeUsers.length,
        would_migrate: toRun,
        over_cap_deferred: deferred.length,
        skipped,
      });
    }

    // 3. Fire generate-next-month per user (parallel, short timeout — it keeps
    //    running server-side after we stop waiting, same as the cron). No
    //    program_id: generate-next-month finds the latest program and routes by
    //    version (v1 → migrate at N+1, none → first-gen month 1).
    const fired = await Promise.allSettled(
      toRun.map((u) =>
        fetchWithTimeout(`${SUPABASE_URL}/functions/v1/generate-next-month`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
            "x-webhook-user-id": u.userId,
          },
          body: JSON.stringify({ user_id: u.userId }),
        }, 30_000).then(() => ({ userId: u.userId, mode: u.mode, ok: true }))
      )
    );
    const results = fired.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { userId: toRun[i].userId, mode: toRun[i].mode, ok: true, note: "fired (response not awaited)" }
    );

    return json(200, {
      overdue_days: overdueDays,
      active_users: activeUsers.length,
      fired: results,
      over_cap_deferred: deferred.length,
      skipped,
    });
  } catch (e) {
    console.error("migrate-cohort-to-v3 error:", e);
    return json(500, { error: (e as Error).message });
  }
});
