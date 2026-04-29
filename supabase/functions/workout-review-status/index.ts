/**
 * workout-review-status — lightweight poller for the async
 * workout-review job.
 *
 * Input:  { review_id: string }
 * Output: { status, review?, review_id, error?, created_at, ready_at }
 *
 * The client polls this after kicking off workout-review. Each poll is
 * a small, fast request iOS Safari is happy to complete even when the
 * device locks or the tab backgrounds. The heavy work happens in the
 * background inside workout-review's EdgeRuntime.waitUntil task and
 * updates the row when done.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const reviewId = body?.review_id;

    if (!reviewId || typeof reviewId !== "string") {
      return new Response(
        JSON.stringify({ error: "review_id is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Scope to the requesting user's own reviews. If the id belongs to
    // someone else, return 404 rather than leaking existence.
    const { data: row, error } = await supa
      .from("workout_reviews")
      .select("id, status, review, error, created_at, ready_at")
      .eq("id", reviewId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !row) {
      return new Response(
        JSON.stringify({ error: "Review not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        review_id: row.id,
        status: row.status,
        review: row.review ?? null,
        error: row.error ?? null,
        created_at: row.created_at,
        ready_at: row.ready_at,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
