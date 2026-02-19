import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const FREE_LIMIT = 3;
const DAILY_LIMIT = 75;

function buildAthleteContext(
  lifts: Record<string, number> | null | undefined,
  skills: Record<string, string> | null | undefined,
  bodyweight: number | null | undefined,
  units: string | null | undefined
): string {
  const hasLifts = lifts && Object.keys(lifts).length > 0;
  const hasSkills = skills && Object.keys(skills).length > 0;
  const hasBodyweight = bodyweight != null && bodyweight > 0;
  if (!hasLifts && !hasSkills && !hasBodyweight) return "";

  const parts: string[] = ["\n\nATHLETE PROFILE:"];
  const u = units === "kg" ? "kg" : "lbs";

  if (hasBodyweight) {
    parts.push(`Bodyweight: ${bodyweight} ${u}`);
  }

  if (hasLifts) {
    const liftLine = Object.entries(lifts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v} ${u}`)
      .join(", ");
    if (liftLine) parts.push("1RM Lifts — " + liftLine);
  }

  if (hasSkills) {
    const skillLine = Object.entries(skills)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (skillLine) parts.push("Skills — " + skillLine);
  }

  parts.push(
    "Personalize advice when relevant: suggest appropriate weights, scaling options, and progressions based on their current abilities."
  );

  return parts.join("\n");
}

const JOURNAL_SYSTEM_PROMPT =
  "You are an expert CrossFit coach and knowledge base assistant built on hundreds of CrossFit Journal articles and foundational documents by Greg Glassman and other subject-matter experts. VOICE: Coach-to-coach, direct, practical, no fluff. Conversational paragraphs, not blog posts. Minimal headers and bullets. Keep answers 150-300 words for simple questions, up to 500 for complex ones. Ground answers in the provided article context when available. Cite sources naturally. Emphasize points of performance for movement questions. For nutrition, reference the CrossFit prescription when relevant. If context does not cover the question, supplement with general knowledge but be transparent. Avoid opening every answer with the same quote. Avoid excessive formatting. Do not list sources at the end, weave them in naturally.";

const SCIENCE_SYSTEM_PROMPT =
  "You are a medical physiology expert grounded in the Textbook of Medical Physiology (Guyton & Hall). Explain concepts clearly using accurate physiological terminology. Keep answers 150-300 words for simple questions, up to 500 for complex ones. Ground answers in the provided article context when available. Cite sources naturally. Use clinical examples when helpful to illustrate concepts. If context does not cover the question, say so transparently rather than guessing. Avoid excessive formatting. Do not list sources at the end, weave them in naturally.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader!.replace("Bearer ", "");
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

    const { data: hasAccess } = await supa.rpc("check_user_access", {
      check_user_id: user.id,
    });

    // Determine subscription tier
    const { data: profile } = await supa
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single();

    const isFreeTier = !profile || profile.subscription_status !== "active";

    // Fetch athlete profile for prompt personalization
    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, bodyweight, units")
      .eq("user_id", user.id)
      .maybeSingle();

    let dailyCount = 0;
    let totalCount = 0;

    if (isFreeTier) {
      // Free tier: 3 lifetime questions
      const { count } = await supa
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      totalCount = count || 0;

      if (totalCount >= FREE_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Free limit reached", code: "FREE_LIMIT" }),
          { status: 402, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Paid tier: 75 questions per day
      const { data: dc } = await supa.rpc("get_daily_usage", {
        check_user_id: user.id,
      });
      dailyCount = dc || 0;

      if (dailyCount >= DAILY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Daily limit reached" }),
          { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    const { question, history = [], source_filter } = await req.json();

    // Generate embedding via OpenAI
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: question.substring(0, 2000),
      }),
    });
    const embData = await embResp.json();
    const queryEmb = embData.data[0].embedding;

    // Retrieve matching chunks from vector store, always filtered by category
    const { data: chunks } = await supa.rpc("match_chunks_filtered", {
      query_embedding: queryEmb,
      match_threshold: 0.25,
      match_count: 6,
      filter_category: source_filter || "journal",
    });

    const sources: { title: string; author: string; source: string; similarity: number }[] = [];
    let context = "";

    if (chunks && chunks.length > 0) {
      context =
        "\n\nRELEVANT ARTICLES:\n" +
        chunks
          .map((c: any, i: number) => {
            sources.push({
              title: c.title,
              author: c.author,
              source: c.source,
              similarity: c.similarity,
            });
            return (
              "[Source " +
              (i + 1) +
              ": " +
              c.title +
              (c.author ? " by " + c.author : "") +
              " | " +
              (c.similarity * 100).toFixed(0) +
              "% match]\n" +
              c.content
            );
          })
          .join("\n\n");
    }

    // Build conversation messages
    const messages: { role: string; content: string }[] = [];
    for (const m of (history || []).slice(-10)) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: "user", content: question });

    // Call Claude with streaming
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
        stream: true,
        system:
          (source_filter === "science" ? SCIENCE_SYSTEM_PROMPT : JOURNAL_SYSTEM_PROMPT) +
          buildAthleteContext(athleteProfile?.lifts, athleteProfile?.skills, athleteProfile?.bodyweight, athleteProfile?.units) +
          context,
        messages,
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json();
      console.error("Claude API error:", err);
      return new Response(JSON.stringify({ error: "Failed to generate response" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Prepare sources for the initial SSE event
    const clientSources = sources.map((s) => ({
      title: s.title,
      author: s.author,
      source: s.source,
    }));

    const userId = user.id;

    // Stream SSE back to the client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send sources as the first event so the frontend has them ready
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "sources", sources: clientSources })}\n\n`)
        );

        let fullAnswer = "";
        let inputTokens = 0;
        let outputTokens = 0;

        const reader = claudeResp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);

                if (event.type === "content_block_delta" && event.delta?.text) {
                  fullAnswer += event.delta.text;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`)
                  );
                }

                if (event.type === "message_delta" && event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }

                if (event.type === "message_start" && event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens || 0;
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }

          // Persist message to database
          const { data: msgRow } = await supa
            .from("chat_messages")
            .insert({
              user_id: userId,
              question,
              answer: fullAnswer,
              sources: clientSources,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            })
            .select("id")
            .single();

          await supa.rpc("increment_usage", {
            p_user_id: userId,
            p_input_tokens: inputTokens,
            p_output_tokens: outputTokens,
          });

          // Send final event with message_id and usage
          const usagePayload = isFreeTier
            ? { tier: "free", total_questions: totalCount + 1, free_limit: FREE_LIMIT }
            : { tier: "paid", daily_questions: dailyCount + 1, daily_limit: DAILY_LIMIT };

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                message_id: msgRow?.id,
                usage: {
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  ...usagePayload,
                },
              })}\n\n`
            )
          );
        } catch (err) {
          console.error("Stream processing error:", err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: "Stream interrupted" })}\n\n`)
          );
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
