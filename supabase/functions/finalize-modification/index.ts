import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { modification_id } = await req.json();
    if (!modification_id) {
      return new Response(JSON.stringify({ error: "Missing modification_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: mod, error: modErr } = await supa
      .from("program_modifications")
      .select("id, program_id, status")
      .eq("id", modification_id)
      .single();

    if (modErr || !mod) {
      return new Response(JSON.stringify({ error: "Modification not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: prog } = await supa
      .from("programs")
      .select("id")
      .eq("id", mod.program_id)
      .eq("user_id", user.id)
      .single();

    if (!prog) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { error: fnErr } = await supa.rpc("finalize_program_modification", {
      p_modification_id: modification_id,
    });

    if (fnErr) {
      return new Response(JSON.stringify({ error: fnErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-program`;
    const analyzeResp = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ program_id: mod.program_id }),
    });

    if (!analyzeResp.ok) {
      console.error("Re-analysis failed:", await analyzeResp.text());
    }

    return new Response(
      JSON.stringify({ program_id: mod.program_id }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
