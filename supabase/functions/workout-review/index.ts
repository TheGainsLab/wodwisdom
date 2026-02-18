import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const FREE_LIMIT = 3;
const DAILY_LIMIT = 75;

const WORKOUT_REVIEW_SYSTEM_PROMPT = `You are an expert CrossFit coach reviewing workouts. Given workout text and context from CrossFit Journal articles, produce a structured analysis.

Output valid JSON only, no markdown or extra text, with this exact structure:
{
  "time_domain": "Expected duration for most athletes, e.g. 12-18 min. What will limit athletes.",
  "scaling": [
    { "movement": "Movement name", "suggestions": "Scaling options with reasoning" }
  ],
  "warm_up": "5-7 min warm-up suggestions (mobility, movement prep).",
  "cues": [
    { "movement": "Movement name", "cues": ["Cue 1", "Cue 2", "Cue 3"] }
  ],
  "class_prep": "Equipment, setup, what to brief athletes on.",
  "sources": []
}

Rules:
- Be concise and practical. Coach-to-coach voice.
- Ground advice in the provided article context when available.
- Extract movements from the workout and provide scaling/cues for each.
- If the input is not a recognizable workout, set time_domain to "I couldn't parse this as a workout. Try pasting a complete workout (e.g. 4 RFT: 20 wall balls, 10 T2B, 5 power cleans 135/95)."
- Do not include sources in the JSON - we will add them separately. Leave sources as empty array.`;

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

    const { workout_text } = await req.json();
    if (!workout_text || typeof workout_text !== "string") {
      return new Response(JSON.stringify({ error: "Missing workout_text" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const trimmed = workout_text.trim();
    if (trimmed.length < 10) {
      return new Response(JSON.stringify({ error: "Paste a complete workout to analyze" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Check subscription tier
    const { data: profile } = await supa
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single();

    const isFreeTier = !profile || profile.subscription_status !== "active";

    // Usage limits: count chat_messages + workout_reviews
    if (isFreeTier) {
      const [{ count: chatCount }, { count: reviewCount }] = await Promise.all([
        supa.from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supa.from("workout_reviews").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const totalCount = (chatCount || 0) + (reviewCount || 0);
      if (totalCount >= FREE_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Free limit reached", code: "FREE_LIMIT" }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const [{ count: chatToday }, { count: reviewToday }] = await Promise.all([
        supa
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", today),
        supa
          .from("workout_reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", today),
      ]);
      const dailyCount = (chatToday || 0) + (reviewToday || 0);
      if (dailyCount >= DAILY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Daily limit reached" }),
          { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    // Generate embedding
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: trimmed.substring(0, 2000),
      }),
    });
    const embData = await embResp.json();
    const queryEmb = embData.data?.[0]?.embedding;
    if (!queryEmb) {
      return new Response(JSON.stringify({ error: "Embedding failed" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Retrieve matching chunks
    const { data: chunks } = await supa.rpc("match_chunks_filtered", {
      query_embedding: queryEmb,
      match_threshold: 0.25,
      match_count: 6,
      filter_category: "journal",
    });

    const sources: { title: string; author: string; source: string }[] = [];
    let context = "";
    if (chunks && chunks.length > 0) {
      context =
        "\n\nRELEVANT ARTICLES:\n" +
        chunks
          .map((c: any, i: number) => {
            sources.push({ title: c.title, author: c.author || "", source: c.source || "" });
            return (
              "[Source " +
              (i + 1) +
              ": " +
              c.title +
              (c.author ? " by " + c.author : "") +
              "]\n" +
              c.content
            );
          })
          .join("\n\n");
    }

    // Call Claude (non-streaming for structured JSON)
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        stream: false,
        system: WORKOUT_REVIEW_SYSTEM_PROMPT + context,
        messages: [{ role: "user", content: `Analyze this workout:\n\n${trimmed}` }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate review" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResp.json();
    const rawText =
      claudeData.content?.[0]?.text?.trim() ||
      claudeData.content?.[0]?.input?.trim() ||
      "";

    // Parse JSON from response (handle possible markdown code blocks)
    let review: Record<string, unknown>;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
      review = JSON.parse(jsonStr);
    } catch {
      review = {
        time_domain: rawText || "Unable to parse response.",
        scaling: [],
        warm_up: "",
        cues: [],
        class_prep: "",
        sources: [],
      };
    }

    // Attach sources to review
    if (Array.isArray(review.sources)) {
      review.sources = sources;
    } else {
      review.sources = sources;
    }

    // Persist to workout_reviews
    await supa.from("workout_reviews").insert({
      user_id: user.id,
      workout_text: trimmed,
      review,
    });

    return new Response(JSON.stringify({ review }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});