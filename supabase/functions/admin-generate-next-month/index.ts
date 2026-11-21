/**
 * admin-generate-next-month — the founder's "generate this athlete's next
 * month now" (2026-11-18).
 *
 * Next-month delivery is tied to BILLING on purpose: a renewal invoice is the
 * only signal an athlete cannot fake, so nobody can log a month of made-up
 * results, collect month after month, and cancel. That rule stays. This is
 * the human override for the cases it does not fit — a complimentary account
 * with no renewal coming, an athlete with a cancellation scheduled, a test
 * user — and it is the admin's decision each time, one month per click.
 *
 * It does exactly what the payment webhook does: calls generate-next-month
 * as a service caller for the athlete's latest generated program, with no
 * month named, so the target is generated_months + 1. Nothing is deleted.
 * (To REDO the current month, use admin-rebuild-month.)
 *
 * generate-next-month runs the month's evaluation before it starts the
 * program job and can take longer than this function should wait, so a
 * timeout here is reported as "started", not as a failure; every real
 * refusal (no program, month already generated, evaluation failed) comes
 * back quickly and is passed through.
 *
 * Auth: caller must be an admin (profiles.role). Body: { user_id } or
 * { email }.
 *
 * Deploy: supabase functions deploy admin-generate-next-month
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WAIT_MS = 25_000;
const IN_FLIGHT_WINDOW_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !userData?.user) return json({ error: "Invalid token" }, 401);
    const { data: callerProfile } = await supa
      .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (callerProfile?.role !== "admin") return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    let targetUserId = typeof body.user_id === "string" ? body.user_id : null;
    if (!targetUserId && typeof body.email === "string") {
      const { data: target } = await supa
        .from("profiles").select("id").eq("email", body.email.trim().toLowerCase()).maybeSingle();
      targetUserId = target?.id ?? null;
    }
    if (!targetUserId) return json({ error: "user_id or email required (no matching user)" }, 400);

    const { data: programs } = await supa
      .from("programs")
      .select("id, generated_months, program_version")
      .eq("user_id", targetUserId)
      .eq("source", "generated")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const program = programs?.[0];
    if (!program) {
      // Archived programs are view only (2026-11-21): no new months.
      const { count: archivedCount } = await supa
        .from("programs").select("id", { count: "exact", head: true })
        .eq("user_id", targetUserId).eq("source", "generated").not("archived_at", "is", null);
      if ((archivedCount ?? 0) > 0) {
        return json({ error: "This user's program is archived — an archived program gets no new months. Restore it first, or let the athlete build a new one." }, 409);
      }
      return json({ error: "No generated program for this user — there is no month to follow" }, 404);
    }
    const targetMonth = (program.generated_months || 1) + 1;

    // One generation at a time per athlete: a second click while a job is
    // running would otherwise queue the month after the one being built.
    const { data: active } = await supa
      .from("program_jobs").select("id")
      .eq("user_id", targetUserId).in("status", ["pending", "processing"])
      .gte("updated_at", new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString())
      .limit(1).maybeSingle();
    if (active) return json({ error: "A generation is already running for this user. Wait for it to finish, then refresh." }, 409);

    console.log(`[admin-generate-next-month] admin=${userData.user.id} user=${targetUserId} program=${program.id} target_month=${targetMonth}`);

    let resp: Response;
    try {
      resp = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/generate-next-month`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "x-webhook-user-id": targetUserId,
        },
        // No month_number: generate-next-month targets generated_months + 1.
        body: JSON.stringify({ program_id: program.id }),
      }, WAIT_MS);
    } catch (e) {
      const msg = (e as Error).message || "";
      // Still working (the evaluation runs first): started, not failed.
      if (msg.includes("timed out")) {
        return json({ ok: true, program_id: program.id, target_month: targetMonth, status: "started" });
      }
      return json({ error: `Could not reach the generator: ${msg}` }, 502);
    }

    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return json({ error: out?.error || `Generator refused (HTTP ${resp.status})`, target_month: targetMonth }, resp.status === 429 ? 409 : 502);
    }
    return json({ ok: true, program_id: program.id, target_month: targetMonth, status: "started", job_id: out?.job_id ?? null });
  } catch (e) {
    console.error("[admin-generate-next-month] error:", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
