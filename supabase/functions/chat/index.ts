import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { fetchAndFormatProgramContext } from "../_shared/training-program.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const FREE_LIMIT = 3;
const DAILY_LIMIT = 20;

function buildAthleteContext(
  lifts: Record<string, number> | null | undefined,
  skills: Record<string, string> | null | undefined,
  conditioning: Record<string, string | number> | null | undefined,
  bodyweight: number | null | undefined,
  units: string | null | undefined,
  gender: string | null | undefined
): string {
  const hasLifts = lifts && Object.keys(lifts).length > 0;
  const hasSkills = skills && Object.keys(skills).length > 0;
  const hasConditioning = conditioning && Object.keys(conditioning).length > 0 && Object.values(conditioning).some((v) => v !== "" && v != null);
  const hasBodyweight = bodyweight != null && bodyweight > 0;
  if (!hasLifts && !hasSkills && !hasConditioning && !hasBodyweight && !gender) return "";

  const parts: string[] = ["\n\nATHLETE PROFILE:"];
  const u = units === "kg" ? "kg" : "lbs";

  if (gender) parts.push(`Gender: ${gender}`);

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

  if (hasConditioning) {
    const condLine = Object.entries(conditioning)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (condLine) parts.push("Conditioning — " + condLine);
  }

  parts.push(
    "Personalize advice when relevant: suggest appropriate weights, scaling options, and progressions based on their current abilities."
  );

  return parts.join("\n");
}

// Shared spine for all coaching personas. Mode-specific addenda are appended below.
const COACH_SPINE =
  "You are an expert coach. Your influences are CrossFit methodology — Greg Glassman's foundational writings, the CrossFit Level 1 Training Guide, the CrossFit Journal — alongside strength-science literature and exercise physiology.\n\n" +
  "VOICE: Coach-to-coach, direct, practical, no fluff. Conversational paragraphs, not blog posts. Minimal headers and bullets. Keep answers 150-300 words for simple questions, up to 500 for complex ones. Avoid excessive formatting. Avoid opening every answer with the same quote.\n\n" +
  "GROUNDING & ATTRIBUTION:\n" +
  "- When the RELEVANT ARTICLES section below contains material that directly supports your answer, weave it in naturally with attribution to the article and author. Do not list sources at the end — work them into the prose.\n" +
  "- When that section is empty, weak, or doesn't address the question, answer from CrossFit methodology and your coaching expertise. Speak as the coach: \"standard programming is…\", \"the methodology calls for…\", \"in my experience…\". Do NOT name a specific article, journal, author, guide, or publication. Do NOT invent quotations. Do NOT attribute claims to \"the articles,\" \"the journal,\" \"the materials,\" \"the sources,\" or any specific publication unless that exact content appears in the RELEVANT ARTICLES section below.\n" +
  "- Never mention retrieval, your knowledge base, your training, your access to information, your limitations, or what you do or don't have. Never break character. You are a coach answering a coach.\n\n" +
  "META-QUESTIONS: If asked about your background, methodology, what you draw from, or your influences, answer in-character — describe your influences (CrossFit methodology, Glassman's writings, the Level 1 guide, the CrossFit Journal, strength-science literature, exercise physiology). Never describe yourself as an AI. Never reference \"provided context,\" \"retrieved sources,\" or any retrieval mechanism.";

const JOURNAL_SYSTEM_PROMPT =
  COACH_SPINE +
  "\n\nFOCUS: Emphasize points of performance for movement questions. For nutrition, reference the CrossFit prescription when relevant.";

const SCIENCE_SYSTEM_PROMPT =
  COACH_SPINE +
  "\n\nFOCUS: Lean into accurate physiological terminology and clinical examples when explaining mechanisms. When questions touch medical physiology (Guyton & Hall territory), be precise but keep the coach voice.";

const STRENGTH_SYSTEM_PROMPT =
  COACH_SPINE +
  "\n\nFOCUS: Strength and conditioning — programming, periodization, biomechanics, and the physiology of strength. Emphasize application to training: how to program, progress, and avoid common errors.";

const ALL_SYSTEM_PROMPT =
  COACH_SPINE +
  "\n\nFOCUS: Integrate CrossFit methodology, strength-science, and exercise physiology fluidly. When referencing physiological mechanisms, be accurate but accessible — explain the science in terms an experienced coach would understand.";

const WORKOUT_COACHING_PROMPT =
  COACH_SPINE +
  "\n\nFOCUS: You are coaching an athlete through a specific training session described below. Be specific to the movements, loads, and time domains in the session. Answer questions about today's workout using the context provided.";

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
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

    // Determine subscription tier via entitlements
    const [{ data: profile }, { data: entitlements }] = await Promise.all([
      supa.from("profiles").select("role").eq("id", user.id).single(),
      supa.from("user_entitlements").select("feature")
        .eq("user_id", user.id)
        .in("feature", ["ai_chat", "engine", "programming"])
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
    ]);

    const features = new Set((entitlements || []).map((e: { feature: string }) => e.feature));
    const isAdmin = profile?.role === "admin";
    const isFreeTier = !isAdmin && !features.has("ai_chat");
    type UserTier = "free_trial" | "coach_standalone" | "engine" | "ai_programming" | "all_access";
    const userTier: UserTier =
      isAdmin ? "all_access" :
      features.has("engine") && features.has("programming") ? "all_access" :
      features.has("engine") ? "engine" :
      features.has("programming") ? "ai_programming" :
      features.has("ai_chat") ? "coach_standalone" :
      "free_trial";

    // Fetch athlete profile for prompt personalization (including Engine state)
    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, bodyweight, units, gender, engine_program_version, engine_current_day, engine_months_unlocked")
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
      // Paid tier: 20 questions per day (admins unlimited)
      const isAdmin = profile?.role === "admin";
      if (!isAdmin) {
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
    }

    const { question, history = [], source_filter, workout_id } = await req.json();
    console.log(`[chat] tier: ${userTier}, hasProfile: ${!!athleteProfile}, engineDay: ${athleteProfile?.engine_current_day || "n/a"}`);

    // Build a short conversational context (last 2 turns) for the query rewriter
    const recentTurnsForRewrite = (history || [])
      .slice(-2)
      .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${(m.content || "").substring(0, 500)}`)
      .join("\n");

    // ── Topic classifier: block off-topic questions before RAG ──
    // Skip classification for workout coaching (always relevant)
    if (!workout_id) {
      try {
        const classifyResp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 10,
            system: "Classify the user's question as either 'allow' or 'block'. Reply with ONLY that one word.\n\nallow: fitness, exercise, training, programming, coaching, nutrition, diet, recipes, meal planning, health, wellness, recovery, sleep, stress management, injury prevention, mobility, anatomy, physiology, supplements, body composition, weight management, athletic performance, competition prep, CrossFit, weightlifting, conditioning, endurance, strength, flexibility, mental health as it relates to training.\n\nblock: anything completely unrelated to health, fitness, or wellness — homework, coding, business, legal, financial, creative writing, travel, entertainment, politics, relationships (non-health), technology, etc.",
            messages: [{ role: "user", content: question.substring(0, 500) }],
          }),
        }, 5_000);

        if (classifyResp.ok) {
          const classifyData = await classifyResp.json();
          const classification = classifyData.content?.[0]?.text?.trim()?.toLowerCase();
          if (classification === "block") {
            // Return a polite decline as a streaming SSE response for consistency
            const decline = "I'm your fitness and wellness coach — I'm best at helping with training, nutrition, recovery, and everything related to being a healthier, fitter human. That question is a bit outside my lane. What can I help you with on the fitness side?";
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "sources", sources: [] })}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: decline })}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: "done",
                  summary: "",
                  usage: isFreeTier
                    ? { tier: "free", total_questions: totalCount, free_limit: FREE_LIMIT }
                    : { tier: "paid", daily_questions: dailyCount, daily_limit: DAILY_LIMIT },
                })}\n\n`));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
            });
          }
        }
      } catch {
        // If classifier fails, allow the question through — don't block users due to classifier errors
      }
    }

    // Fetch workout context if this is a coaching conversation
    let workoutContext = "";
    let contextType: string | null = null;
    let contextId: string | null = null;
    if (workout_id) {
      const { data: workout } = await supa
        .from("program_workouts")
        .select("id, week_num, day_num, workout_text, program_id")
        .eq("id", workout_id)
        .single();
      if (workout) {
        contextType = "workout";
        contextId = workout.id;
        workoutContext = `\n\nTODAY'S TRAINING (Week ${workout.week_num}, Day ${workout.day_num}):\n${workout.workout_text}`;
      }
    }

    // ── Engine context: look up the user's current position + framework ──
    let engineContext = "";
    if ((userTier === "engine" || userTier === "all_access") && athleteProfile?.engine_current_day && athleteProfile?.engine_program_version) {
      try {
        const { data: mapping } = await supa
          .from("engine_program_mapping")
          .select("engine_workout_day_number, week_number")
          .eq("engine_program_id", athleteProfile.engine_program_version)
          .eq("program_sequence_order", athleteProfile.engine_current_day)
          .maybeSingle();

        if (mapping) {
          const [{ data: catalogDay }, { data: programInfo }] = await Promise.all([
            supa.from("engine_workouts")
              .select("day_type, month, phase")
              .eq("program_type", "main_5day")
              .eq("day_number", mapping.engine_workout_day_number)
              .maybeSingle(),
            supa.from("engine_programs")
              .select("name, total_days")
              .eq("id", athleteProfile.engine_program_version)
              .maybeSingle(),
          ]);

          if (catalogDay) {
            const dayTypeRow = catalogDay.day_type
              ? (await supa.from("engine_day_types").select("name, coaching_intent").eq("id", catalogDay.day_type).maybeSingle()).data
              : null;

            const parts: string[] = [];
            parts.push(`Program: ${programInfo?.name || "Year of the Engine"}`);
            parts.push(`Progress: Day ${athleteProfile.engine_current_day} of ${programInfo?.total_days || 720} (Month ${catalogDay.month}, Week ${mapping.week_number || "?"})`);
            parts.push(`Months unlocked: ${athleteProfile.engine_months_unlocked}`);
            if (dayTypeRow?.name) parts.push(`Current day type: ${dayTypeRow.name}`);
            if (dayTypeRow?.coaching_intent) parts.push(dayTypeRow.coaching_intent);
            engineContext = "\n\nENGINE PROGRAM:\n" + parts.join("\n");
          }
        }
      } catch (err) {
        console.error("[chat] Engine context lookup failed:", err);
      }
    }

    // ── AI Program context: derive position from workout logs ──
    let aiProgramContext = "";
    if ((userTier === "ai_programming" || userTier === "all_access") && !workout_id) {
      try {
        const { data: program } = await supa
          .from("programs")
          .select("id, name")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (program) {
          const { data: programWorkouts } = await supa
            .from("program_workouts")
            .select("id, week_num, day_num, sort_order")
            .eq("program_id", program.id)
            .order("sort_order");

          if (programWorkouts && programWorkouts.length > 0) {
            const workoutIds = programWorkouts.map((w: { id: string }) => w.id);
            const { data: completedLogs } = await supa
              .from("workout_logs")
              .select("source_id")
              .eq("user_id", user.id)
              .eq("source_type", "program")
              .in("source_id", workoutIds);

            const completedIds = new Set((completedLogs || []).map((l: { source_id: string }) => l.source_id));
            const totalDays = programWorkouts.length;
            const completedDays = completedIds.size;
            const currentWorkout = programWorkouts.find((w: { id: string }) => !completedIds.has(w.id));

            const parts: string[] = [];
            parts.push(`Program: "${program.name}"`);
            parts.push(`Progress: ${completedDays} of ${totalDays} days completed`);
            if (currentWorkout) {
              parts.push(`Current: Week ${currentWorkout.week_num}, Day ${currentWorkout.day_num}`);
            }
            aiProgramContext = "\n\nAI PROGRAM:\n" + parts.join("\n");
          }
        }
      } catch (err) {
        console.error("[chat] AI Program context lookup failed:", err);
      }
    }

    // ── Query rewriting: turn the raw user message + last 2 turns into a clean,
    // standalone search query. Returns "META" for meta-questions / small talk so
    // we can skip retrieval entirely and answer in-character. Skipped for
    // workout coaching (the workout itself is the context).
    let searchQuery = question.substring(0, 2000);
    let isMeta = false;
    if (!workout_id) {
      try {
        const userBlock = recentTurnsForRewrite
          ? `Recent conversation:\n${recentTurnsForRewrite}\n\nLatest user message:\n${question}`
          : `User message:\n${question}`;
        const rewriteResp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 80,
            system:
              "You rewrite user messages into clean standalone search queries for a CrossFit / strength-science / exercise-physiology knowledge base.\n\n" +
              "Rules:\n" +
              "- Output ONE search query as a single line — topical keywords and phrases, no conversational filler.\n" +
              "- If the latest message is a follow-up, fold in the relevant topical context from the recent conversation so the query stands alone.\n" +
              "- Strip irrelevant specifics (exact numbers, names, dates) unless they are the topic itself.\n" +
              "- If the user is asking a meta-question about you, your background, your sources, your training, your methodology, what you can do, or how you work — output exactly the single token META and nothing else.\n" +
              "- If the message is small talk, a greeting, or has no clear topical question — output exactly the single token META and nothing else.\n" +
              "- Do not answer the question. Do not explain. Output only the search query OR the token META.",
            messages: [{ role: "user", content: userBlock }],
          }),
        }, 5_000);
        if (rewriteResp.ok) {
          const rewriteData = await rewriteResp.json();
          const text = (rewriteData.content?.[0]?.text || "").trim();
          if (text.toUpperCase() === "META") {
            isMeta = true;
          } else if (text) {
            searchQuery = text.substring(0, 500);
          }
        }
      } catch {
        // Rewriter failed — fall back to the raw question. Never block on rewrite errors.
      }
    }
    console.log(`[chat] rewrite: "${question.substring(0, 80)}" -> ${isMeta ? "META" : `"${searchQuery.substring(0, 120)}"`}`);

    // Generate embedding (skipped for META) + recent training + program context in parallel.
    // Context is auto-included for any user with data — no toggle gate.
    const shouldFetchHistory = !isFreeTier;
    const shouldFetchProgram = userTier === "ai_programming" || userTier === "all_access" || userTier === "coach_standalone";
    const [embData, recentTraining, programContext] = await Promise.all([
      isMeta
        ? Promise.resolve(null)
        : fetchWithTimeout("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + OPENAI_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "text-embedding-3-small",
              input: searchQuery,
            }),
          }, 10_000).then((r) => r.json()),
      shouldFetchHistory ? fetchAndFormatRecentHistory(supa, user.id) : Promise.resolve(""),
      shouldFetchProgram ? fetchAndFormatProgramContext(supa, user.id) : Promise.resolve(""),
    ]);
    const queryEmb = embData?.data?.[0]?.embedding;

    // Retrieve matching chunks from vector store, filtered by category. Skipped for META.
    let chunks: Array<{ title: string; author: string; source: string; content: string; similarity: number }> | null = null;
    if (!isMeta && queryEmb) {
      const result = source_filter === "all"
        ? await supa.rpc("match_chunks_multi", {
            query_embedding: queryEmb,
            match_threshold: 0.4,
            match_count: 6,
            filter_categories: ["journal", "science", "strength-science"],
          })
        : await supa.rpc("match_chunks_filtered", {
            query_embedding: queryEmb,
            match_threshold: 0.4,
            match_count: 6,
            filter_category: source_filter || "journal",
          });
      chunks = result.data;
    }

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
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        temperature: 0.3,
        stream: true,
        system:
          // Base prompt (persona + mode focus)
          (workoutContext
            ? WORKOUT_COACHING_PROMPT
            : (source_filter === "all" ? ALL_SYSTEM_PROMPT : source_filter === "science" ? SCIENCE_SYSTEM_PROMPT : source_filter === "strength-science" ? STRENGTH_SYSTEM_PROMPT : JOURNAL_SYSTEM_PROMPT)
          ) +
          // Tier addendum — tells the coach who they're talking to
          (userTier === "free_trial"
            ? `\n\nUSER TIER: Free trial (question ${totalCount + 1} of ${FREE_LIMIT}). The user is new — be warm and make this answer land. No profile on file.`
            : userTier === "coach_standalone"
            ? "\n\nUSER TIER: AI Coach subscriber (no program). Answer as a pure coach."
            : userTier === "engine"
            ? "\n\nUSER TIER: Year of the Engine subscriber. Ground answers in their current framework and programming when relevant."
            : userTier === "ai_programming"
            ? "\n\nUSER TIER: AI Programming subscriber. Ground answers in their current program structure and training."
            : "\n\nUSER TIER: All Access subscriber. The user has both the Engine conditioning program and AI Programming."
          ) +
          // Athlete profile (auto-included if data exists)
          buildAthleteContext(athleteProfile?.lifts, athleteProfile?.skills, athleteProfile?.conditioning, athleteProfile?.bodyweight, athleteProfile?.units, athleteProfile?.gender) +
          // Engine program context (if applicable)
          engineContext +
          // AI Program context (if applicable)
          aiProgramContext +
          // Recent training history
          (recentTraining ? "\n\n" + recentTraining : "") +
          // User program workouts (non-Engine)
          (programContext ? "\n\n" + programContext : "") +
          // Workout coaching context (specific day)
          workoutContext +
          // RAG-retrieved articles
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
              context_type: contextType,
              context_id: contextId,
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
