/**
 * admin-rebuild-month — the founder's one-click "rebuild this month".
 *
 * Full program delete+regenerate stays HUMAN-GATED by design (founder,
 * 2026-10-23): athletes don't get regeneration autonomy. This makes the
 * human gate cheap to operate — one call does what used to be a SQL
 * session: delete the program's current month (workouts + idempotency
 * marker, generated_months rolled back — same three steps as the
 * admin_delete_program_month RPC) and trigger generate-next-month, so the
 * month regenerates from the athlete's CURRENT profile. Pair with the
 * chat → profile Apply flow: athlete applies the change, founder rebuilds.
 *
 * Auth: caller must be an admin (profiles.role). Body: { email } or
 * { user_id }; optional { month } (defaults to the program's current
 * generated month).
 *
 * Deploy: supabase functions deploy admin-rebuild-month
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      .order("created_at", { ascending: false })
      .limit(1);
    const program = programs?.[0];
    if (!program) return json({ error: "No generated program for this user" }, 404);

    const month = typeof body.month === "number" && body.month >= 1
      ? body.month
      : (program.generated_months || 1);

    // Same three steps as admin_delete_program_month (service-role here;
    // the RPC's own gate is auth.uid-based and this fn verified admin above).
    const { error: delW } = await supa
      .from("program_workouts").delete()
      .eq("program_id", program.id).eq("month_number", month);
    if (delW) return json({ error: `workout delete failed: ${delW.message}` }, 500);
    await supa.from("program_months").delete()
      .eq("program_id", program.id).eq("month_number", month);
    await supa.from("programs")
      .update({ generated_months: Math.max(month - 1, 1) })
      .eq("id", program.id);

    // Regenerate from the CURRENT profile.
    let generation = "triggered";
    try {
      const genResp = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/generate-next-month`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "x-webhook-user-id": targetUserId,
        },
        body: JSON.stringify({ program_id: program.id, user_id: targetUserId }),
      }, 60_000);
      if (!genResp.ok) generation = `trigger failed: HTTP ${genResp.status}`;
    } catch (e) {
      generation = `trigger failed: ${(e as Error).message}`;
    }

    return json({
      ok: true,
      program_id: program.id,
      month_rebuilt: month,
      program_version: program.program_version,
      generation,
    });
  } catch (e) {
    console.error("[admin-rebuild-month] error:", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
