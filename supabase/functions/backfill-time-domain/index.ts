/**
 * Backfill time_domain for existing metcon blocks that don't have one.
 * Reads block_text and calls inferTimeDomain() on each.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inferTimeDomain } from "../_shared/time-domain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Fetch metcon blocks missing time_domain
    const { data: blocks, error: fetchErr } = await supa
      .from("workout_log_blocks")
      .select("id, block_text")
      .eq("block_type", "metcon")
      .is("time_domain", null)
      .limit(1000);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!blocks || blocks.length === 0) {
      return new Response(JSON.stringify({ updated: 0, message: "Nothing to backfill" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    for (const block of blocks) {
      if (!block.block_text) continue;
      const td = inferTimeDomain(block.block_text);
      const { error: upErr } = await supa
        .from("workout_log_blocks")
        .update({ time_domain: td })
        .eq("id", block.id);
      if (!upErr) updated++;
    }

    return new Response(
      JSON.stringify({ updated, total: blocks.length }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
