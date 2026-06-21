/**
 * engine-resequence (HTTP) — admin dry-run preview / on-demand entry point for
 * the Engine self-sequencer. Thin wrapper over the shared runResequence() core
 * (also used by engine-resequence-cron for automatic live generation).
 *
 * - Authenticated user, runs for themselves by default.
 * - Admin preview: an admin may pass { target_user_id } to inspect ANOTHER user;
 *   that path FORCES dry_run (never writes).
 * - Safe by default: only writes when explicitly { dry_run: false } for the
 *   caller's own data.
 *
 * See docs/engine_self_sequencing_plan.md.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { runResequence } from "../_shared/run-resequence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    // Safe by default: only writes when explicitly told { dry_run: false }.
    let dryRun = body?.dry_run !== false;
    const debug = body?.debug === true;
    let userId = user.id;

    // Admin preview: an admin can inspect ANOTHER user; this path never writes.
    if (body?.target_user_id && body.target_user_id !== user.id) {
      const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "Forbidden" }, 403);
      userId = body.target_user_id as string;
      dryRun = true;
    }

    const result = await runResequence(supa, userId, { dryRun, debug });

    const httpStatus = result.status === "error" ? 500 : result.status === "unparseable" ? 502 : 200;
    return json(result, httpStatus);
  } catch (e) {
    console.error("[engine-resequence] error:", e);
    return json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
