import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeWorkouts, type WorkoutInput } from "../_shared/analyzer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const INCORPORATE_SYSTEM_PROMPT = `You are a CrossFit programming consultant reviewing a training program.
You have deep knowledge of CrossFit methodology, programming principles, and periodization from the CrossFit Journal, Level 1-4 seminar materials, and advanced strength training literature.

Your task is to modify an existing program to incorporate specific movements the coach has selected. You must:

1. Place movements intelligently based on programming principles from the source material
2. Preserve the intent of existing workouts where possible
3. Consider recovery between similar movement patterns
4. Progress loading appropriately across the training cycle
5. Maintain or improve the program's modal balance, time domain spread, and structural variety

Return your response as a JSON array. Do not include any text outside the JSON. Each element represents one modified workout:

[
  {
    "week_num": 1,
    "day_num": 1,
    "original_text": "the original workout text exactly as provided",
    "modified_text": "the new workout text",
    "change_summary": "short description of what changed, e.g. Pushups → HSPU",
    "rationale": "1-2 sentences explaining why this change was made, referencing programming principles"
  }
]

Only include workouts that changed. Do not include unmodified workouts.
If a movement cannot be reasonably incorporated without compromising the program, explain why in the rationale and omit that modification.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ClaudeModification {
  week_num: number;
  day_num: number;
  original_text: string;
  modified_text: string;
  change_summary: string;
  rationale: string;
}

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

    const { program_id, selected_movements } = await req.json();
    if (!program_id || !Array.isArray(selected_movements) || selected_movements.length === 0) {
      return new Response(JSON.stringify({ error: "Missing program_id or selected_movements array" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: prog, error: progErr } = await supa
      .from("programs")
      .select("id")
      .eq("id", program_id)
      .eq("user_id", user.id)
      .single();

    if (progErr || !prog) {
      return new Response(JSON.stringify({ error: "Program not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: workouts, error: wkErr } = await supa
      .from("program_workouts")
      .select("id, week_num, day_num, workout_text, sort_order")
      .eq("program_id", program_id)
      .order("sort_order");

    if (wkErr || !workouts || workouts.length === 0) {
      return new Response(JSON.stringify({ error: "No workouts in program" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const programText = workouts
      .map(
        (w: { week_num: number; day_num: number; workout_text: string }) =>
          `Week ${w.week_num} Day ${w.day_num}: ${w.workout_text}`
      )
      .join("\n\n");

    const movementsStr = selected_movements.join(", ");

    const ragQuery = `CrossFit programming principles: how to place and incorporate ${movementsStr}, periodization, movement substitution, strength before metcon, recovery between similar movements, time domain distribution`;
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: ragQuery.substring(0, 2000) }),
    });
    const embData = await embResp.json();
    const queryEmb = embData.data?.[0]?.embedding;

    let context = "";
    if (queryEmb) {
      const { data: chunks } = await supa.rpc("match_chunks_filtered", {
        query_embedding: queryEmb,
        match_threshold: 0.2,
        match_count: 8,
        filter_category: "journal",
      });
      if (chunks && chunks.length > 0) {
        context =
          "\n\nRELEVANT METHODOLOGY:\n" +
          chunks
            .map(
              (c: { title: string; author?: string; content: string }) =>
                `[${c.title}${c.author ? " by " + c.author : ""}]\n${c.content}`
            )
            .join("\n\n");
      }
    }

    const userPrompt = `Here is a ${workouts.length}-workout program:

${programText}

The coach wants to incorporate these movements: ${movementsStr}

Using CrossFit programming principles, generate modifications to incorporate these movements. Return JSON only.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        stream: false,
        system: INCORPORATE_SYSTEM_PROMPT + context,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(JSON.stringify({ error: "Failed to generate modifications" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResp.json();
    const rawText =
      claudeData.content?.[0]?.text?.trim() ||
      claudeData.content?.[0]?.input?.trim() ||
      "";

    let mods: ClaudeModification[];
    try {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
      mods = JSON.parse(jsonStr);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON. Please try again." }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const workoutByKey = new Map<string, { id: string; week_num: number; day_num: number; workout_text: string }>();
    for (const w of workouts as { id: string; week_num: number; day_num: number; workout_text: string }[]) {
      workoutByKey.set(`${w.week_num}-${w.day_num}`, w);
    }

    const { data: modRecord, error: modErr } = await supa
      .from("program_modifications")
      .insert({
        program_id,
        selected_movements: selected_movements,
        status: "reviewing",
      })
      .select("id")
      .single();

    if (modErr || !modRecord) {
      return new Response(JSON.stringify({ error: "Failed to create modification record" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const modifiedWorkouts: WorkoutInput[] = workouts.map((w: { week_num: number; day_num: number; workout_text: string }) => ({
      week_num: w.week_num,
      day_num: w.day_num,
      workout_text: w.workout_text,
    }));

    for (const m of mods) {
      const orig = workoutByKey.get(`${m.week_num}-${m.day_num}`);
      if (!orig) continue;

      await supa.from("modified_workouts").insert({
        modification_id: modRecord.id,
        original_workout_id: orig.id,
        modified_text: m.modified_text,
        change_summary: m.change_summary,
        rationale: m.rationale,
        status: "pending",
      });

      const idx = modifiedWorkouts.findIndex((w) => w.week_num === m.week_num && w.day_num === m.day_num);
      if (idx >= 0) {
        modifiedWorkouts[idx] = { ...modifiedWorkouts[idx], workout_text: m.modified_text };
      }
    }

    const modifiedAnalysis = analyzeWorkouts(modifiedWorkouts);

    await supa
      .from("program_modifications")
      .update({ modified_analysis: modifiedAnalysis })
      .eq("id", modRecord.id);

    return new Response(
      JSON.stringify({
        modification_id: modRecord.id,
        modified_count: mods.length,
      }),
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
