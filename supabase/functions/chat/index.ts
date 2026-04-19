import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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
  "META-QUESTIONS: If asked about your background, methodology, what you draw from, or your influences, answer in-character — describe your influences (CrossFit methodology, Glassman's writings, the Level 1 guide, the CrossFit Journal, strength-science literature, exercise physiology). Never describe yourself as an AI. Never reference \"provided context,\" \"retrieved sources,\" or any retrieval mechanism.\n\n" +
  "PRODUCT CATALOG (for your awareness — use per the rules below):\n" +
  "- AI Coach: the coaching you're providing right now — answers, methodology, programming guidance.\n" +
  "- Year of the Engine: a structured conditioning program with adaptive pace targets that calibrate to the athlete's recent performance.\n" +
  "- AI Programming: a personalized training program built from the athlete's profile and goals — week by week, day by day, tailored to them.\n" +
  "- AI Nutrition: food logging, barcode scanning, meal templates, and nutrition tracking built around the athlete's training.\n" +
  "- All Access: the full bundle — Engine for conditioning, AI Programming for personalized training, AI Nutrition for fueling, plus the AI Coach.\n\n" +
  "GUIDANCE MOMENTS (product mentions & profile nudges):\n" +
  "- Always answer the user's actual question first and fully. Never open with a product mention. Never open with a profile nudge.\n" +
  "- At most ONE guidance moment per response. Either a product mention OR a profile nudge, never both in the same response.\n" +
  "- At most ONE product named per guidance moment. When a question genuinely spans multiple products' territory, name the bundle tier (All Access), not the individual components.\n" +
  "- Name the smallest tier that honestly fits the question. Do not upsell to a larger bundle merely because it includes more features.\n" +
  "- Only mention a product if it appears in the \"Products available to mention\" list in the USER TIER block below. If that list is empty, mention NO products — not a single one, not even in passing.\n" +
  "- Only mention a product when the user's question EXPLICITLY asks for the persistent, structured artifact that product delivers — a plan, a program, a meal-logging system. Coaching, education, and single-session advice that you can fully answer here do NOT qualify. Inferred gaps where you reason that a product \"might also help\" do NOT qualify.\n" +
  "- When in doubt, mention NO product. Default to zero mentions.\n" +
  "- Never mention pricing, plans, discounts, tiers, or comparisons between products.\n" +
  "- Frame any mention as coaching guidance, not a call to action. \"If you want this built for you, AI Programming does exactly that\" — not \"you should sign up for AI Programming.\"\n" +
  "- Profile nudges: if the answer would meaningfully benefit from personalization the user hasn't provided (lifts, benchmarks, goals, bodyweight), you may close with a single natural invitation to fill out a profile. This counts as the one guidance moment — cannot stack with a product mention. Coach voice, not a CTA.";

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

/**
 * Build a rich Engine-coaching context block: today's day type + coaching
 * intent, program location, recent 14-day history, upcoming 3 days, and
 * current time trial baselines. Used when a chat request comes from the
 * Engine review page scoped to a specific day.
 *
 * Returns an empty string if any required record is missing (gracefully
 * degrades to normal chat rather than erroring out).
 */
async function buildEngineCoachingContext(
  supa: SupabaseClient,
  userId: string,
  programVersion: string,
  engineProgramDay: number,
): Promise<string> {
  // Mapping row for the requested day
  const { data: mapping } = await supa
    .from("engine_program_mapping")
    .select("engine_workout_day_number, month, week_number")
    .eq("engine_program_id", programVersion)
    .eq("program_sequence_order", engineProgramDay)
    .maybeSingle();
  if (!mapping) return "";

  // Fetch catalog workout, program metadata, recent sessions, upcoming
  // mapping rows, and time trial baselines in parallel.
  const [
    { data: workout },
    { data: programInfo },
    { data: recentSessions },
    { data: upcomingMappings },
    { data: timeTrials },
  ] = await Promise.all([
    supa
      .from("engine_workouts")
      .select("day_type, phase")
      .eq("day_number", mapping.engine_workout_day_number)
      .maybeSingle(),
    supa
      .from("engine_programs")
      .select("name, total_days, total_months")
      .eq("id", programVersion)
      .maybeSingle(),
    supa
      .from("engine_workout_sessions")
      .select("date, day_type, program_day_number, performance_ratio, perceived_exertion, average_heart_rate")
      .eq("user_id", userId)
      .eq("program_version", programVersion)
      .eq("completed", true)
      .order("date", { ascending: false })
      .limit(14),
    supa
      .from("engine_program_mapping")
      .select("program_sequence_order, engine_workout_day_number, month")
      .eq("engine_program_id", programVersion)
      .gt("program_sequence_order", engineProgramDay)
      .order("program_sequence_order", { ascending: true })
      .limit(3),
    supa
      .from("engine_time_trials")
      .select("modality, total_output, calculated_rpm, units, date")
      .eq("user_id", userId)
      .eq("is_current", true),
  ]);

  if (!workout) return "";

  // Day type + coaching intent for today's session
  const { data: dayTypeRow } = workout.day_type
    ? await supa
        .from("engine_day_types")
        .select("name, coaching_intent")
        .eq("id", workout.day_type)
        .maybeSingle()
    : { data: null };

  // Resolve day-type names for upcoming days
  let upcomingBlock = "";
  if (upcomingMappings && upcomingMappings.length > 0) {
    const upcomingDayNumbers = upcomingMappings.map((m) => m.engine_workout_day_number);
    const { data: upcomingWorkouts } = await supa
      .from("engine_workouts")
      .select("day_number, day_type")
      .in("day_number", upcomingDayNumbers);

    const dayTypeIds = Array.from(
      new Set((upcomingWorkouts || []).map((w: { day_type: string }) => w.day_type).filter(Boolean)),
    );
    const { data: dayTypeRows } = dayTypeIds.length > 0
      ? await supa.from("engine_day_types").select("id, name").in("id", dayTypeIds)
      : { data: [] as { id: string; name: string }[] };

    const nameById = new Map((dayTypeRows || []).map((d) => [d.id, d.name]));
    const typeByDayNum = new Map(
      (upcomingWorkouts || []).map((w: { day_number: number; day_type: string }) => [w.day_number, w.day_type]),
    );

    const lines = upcomingMappings.map((m) => {
      const catalogType = typeByDayNum.get(m.engine_workout_day_number) ?? "";
      const typeName = (nameById.get(catalogType) as string | undefined) ?? "unknown";
      return `- Day ${m.program_sequence_order} (Month ${m.month}): ${typeName}`;
    });
    upcomingBlock = "\nUPCOMING DAYS:\n" + lines.join("\n");
  }

  // Assemble
  const parts: string[] = ["\n\nENGINE PROGRAM CONTEXT:"];
  parts.push(`Program: ${programInfo?.name ?? "Year of the Engine"}`);
  parts.push(`Total: ${programInfo?.total_days ?? 720} days across ${programInfo?.total_months ?? 36} months`);
  parts.push(`Position: Day ${engineProgramDay} (Month ${mapping.month}, Week ${mapping.week_number ?? "?"})`);

  parts.push("\nTODAY'S SESSION:");
  if (dayTypeRow?.name) parts.push(`Day type: ${dayTypeRow.name}`);
  if (dayTypeRow?.coaching_intent) parts.push("", dayTypeRow.coaching_intent);

  if (recentSessions && recentSessions.length > 0) {
    parts.push(`\nRECENT TRAINING (last ${recentSessions.length} sessions, most recent first):`);
    for (const s of recentSessions) {
      const bits: string[] = [s.date];
      if (s.day_type) bits.push((s.day_type as string).replace(/_/g, " "));
      if (s.program_day_number != null) bits.push(`Day ${s.program_day_number}`);
      if (s.performance_ratio != null) bits.push(`pace ratio ${Number(s.performance_ratio).toFixed(2)}`);
      if (s.perceived_exertion != null) bits.push(`RPE ${s.perceived_exertion}`);
      if (s.average_heart_rate != null) bits.push(`HR ${s.average_heart_rate}`);
      parts.push(`- ${bits.join(" | ")}`);
    }
  } else {
    parts.push("\nRECENT TRAINING: no completed sessions in this program yet.");
  }

  if (upcomingBlock) parts.push(upcomingBlock);

  if (timeTrials && timeTrials.length > 0) {
    parts.push("\nCURRENT TIME TRIAL BASELINES:");
    for (const tt of timeTrials) {
      const bits: string[] = [tt.modality as string];
      if (tt.total_output != null) bits.push(`${tt.total_output} ${tt.units ?? ""}`.trim());
      if (tt.calculated_rpm != null) bits.push(`rpm ${Number(tt.calculated_rpm).toFixed(2)}`);
      if (tt.date) bits.push(`(set ${tt.date})`);
      parts.push(`- ${bits.join(" — ")}`);
    }
  }

  parts.push(
    "\nYou are coaching this athlete through today's Engine session. Ground advice in today's day type and coaching intent, the recent training patterns, and the time trial baselines when relevant.",
  );

  return parts.join("\n");
}

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

    const { question, history = [], source_filter, workout_id, engine_program_day } = await req.json();
    console.log(`[chat] tier: ${userTier}, hasProfile: ${!!athleteProfile}, engineDay: ${athleteProfile?.engine_current_day || "n/a"}, engineProgramDay: ${engine_program_day ?? "n/a"}`);

    // Engine coaching mode: the Engine review page scopes the coach to a
    // specific day by passing engine_program_day. When present and the user
    // is an Engine subscriber, we build a rich Engine context block, lock
    // retrieval to the engine + journal categories, and use the workout
    // coaching prompt. Otherwise this is a normal chat call and nothing
    // about the request changes.
    const engineCoachingMode =
      typeof engine_program_day === "number" &&
      engine_program_day > 0 &&
      (userTier === "engine" || userTier === "all_access") &&
      !!athleteProfile?.engine_program_version;

    // Build a short conversational context (last 2 turns) for the query rewriter
    const recentTurnsForRewrite = (history || [])
      .slice(-2)
      .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${(m.content || "").substring(0, 500)}`)
      .join("\n");

    // ── Topic classifier: block off-topic questions before RAG ──
    // Skip classification for workout coaching and engine-day coaching
    // (always relevant — the scoped context is the topic).
    if (!workout_id && !engineCoachingMode) {
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
            system: "Classify the user's question as either 'allow' or 'block'. Reply with ONLY that one word.\n\nallow: fitness, exercise, training, programming, coaching, nutrition, diet, recipes, meal planning, health, wellness, recovery, sleep, stress management, injury prevention, mobility, anatomy, physiology, supplements, body composition, weight management, athletic performance, competition prep, CrossFit, weightlifting, conditioning, endurance, strength, flexibility, mental health as it relates to training, questions about the user's own program or workout plan, questions about the Engine program or any named training program, energy systems, pacing, aerobic or anaerobic training.\n\nblock: anything completely unrelated to health, fitness, or wellness — homework, coding, business, legal, financial, creative writing, travel, entertainment, politics, relationships (non-health), technology (computers/software, not training technology), etc.",
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

    // ── Engine coaching context (scoped to a specific day) ──
    // The old per-user auto-injection that fired on every Engine chat has
    // been removed. Engine context is now only built when the request
    // explicitly scopes to a day via engine_program_day (the Engine review
    // page). General /chat questions from Engine users no longer carry
    // engine context unless they ask from the review page.
    let engineContext = "";
    if (engineCoachingMode && athleteProfile?.engine_program_version) {
      try {
        engineContext = await buildEngineCoachingContext(
          supa,
          user.id,
          athleteProfile.engine_program_version,
          engine_program_day,
        );
      } catch (err) {
        console.error("[chat] Engine coaching context failed:", err);
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

    // ── Rewriter + router (single Haiku call) ──
    // Emits JSON: { type, search_query }. Type drives system prompt
    // selection, RAG retrieval categories, and whether to inject profile.
    // Search query is used for embedding / retrieval. Scoped requests
    // (workout_id, engine_program_day) bypass this entirely.
    let searchQuery = question.substring(0, 2000);
    let questionType: "methodology" | "personal_programming" | "meta" = "personal_programming";
    if (!workout_id && !engineCoachingMode) {
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
            max_tokens: 120,
            system:
              "You are a question classifier and query rewriter for a CrossFit / strength-science / exercise-physiology coaching app. Given the user's latest message (and last 2 conversation turns for context), output JSON with two fields.\n\n" +
              "FIELDS:\n" +
              '1. "type" — one of:\n' +
              '   - "methodology": explains a concept, principle, or mechanism. Personal data does not change the answer. Examples: "what\'s Zone 2", "explain carbohydrate metabolism", "why do we do Fran", "explain a devour day".\n' +
              '   - "personal_programming": asks for guidance specific to themselves — their lifts, their programming, a workout for them, pacing for their session. Examples: "what should I squat tomorrow", "give me a workout", "how should I pace this 5k", "rate my workout yesterday".\n' +
              '   - "meta": about the AI itself, the app, product capabilities, or small talk. Examples: "who are you", "what can you do", "can you build programs", "hey", "where is my history".\n\n' +
              '2. "search_query" — a clean standalone search query string for the topical RAG lookup. For "meta" questions, output null. For others: topical keywords and phrases, no conversational filler. Fold in relevant topical context from recent conversation. Strip irrelevant specifics (exact numbers, names, dates) unless they are the topic itself. Preserve proper nouns that ARE the topic (day type names like "devour", program names like "Year of the Engine", named benchmarks).\n\n' +
              "TIEBREAKER for ambiguous questions: personal_programming > methodology > meta.\n\n" +
              "OUTPUT: ONLY valid JSON, one object, no prose, no code fences. Examples:\n" +
              '{"type":"methodology","search_query":"Zone 2 training aerobic base"}\n' +
              '{"type":"personal_programming","search_query":"back squat programming progression"}\n' +
              '{"type":"meta","search_query":null}',
            messages: [{ role: "user", content: userBlock }],
          }),
        }, 5_000);
        if (rewriteResp.ok) {
          const rewriteData = await rewriteResp.json();
          const text = (rewriteData.content?.[0]?.text || "").trim();
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              const parsed = JSON.parse(match[0]);
              const t = parsed?.type;
              if (t === "methodology" || t === "personal_programming" || t === "meta") {
                questionType = t;
              }
              if (typeof parsed?.search_query === "string" && parsed.search_query.trim() !== "") {
                searchQuery = parsed.search_query.trim().substring(0, 500);
              }
            } catch {
              // JSON parse failed — stick with defaults (personal_programming + raw question)
            }
          }
        }
      } catch {
        // Rewriter/router failed — fall back to defaults. Never block on errors.
      }
    }
    const isMeta = questionType === "meta";
    console.log(`[chat] router: type=${questionType}, query="${isMeta ? "(skipped)" : searchQuery.substring(0, 120)}"`);

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
    // Engine coaching mode locks retrieval to ['engine', 'journal']. The router's
    // questionType drives retrieval otherwise: methodology pulls from all categories
    // (physiology questions benefit from the science chunks); personal_programming
    // stays narrow on coaching-flavored content.
    let chunks: Array<{ title: string; author: string; source: string; content: string; similarity: number }> | null = null;
    if (!isMeta && queryEmb) {
      const filterCategories = engineCoachingMode
        ? ["engine", "journal"]
        : questionType === "methodology"
          ? ["journal", "science", "strength-science", "engine"]
          : ["journal", "engine"];
      const result = await supa.rpc("match_chunks_multi", {
        query_embedding: queryEmb,
        match_threshold: 0.4,
        match_count: 6,
        filter_categories: filterCategories,
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
          (workoutContext || engineCoachingMode
            ? WORKOUT_COACHING_PROMPT
            : questionType === "methodology"
              ? ALL_SYSTEM_PROMPT
              : JOURNAL_SYSTEM_PROMPT
          ) +
          // Tier addendum — tells the coach who they're talking to and which
          // products are allowed to be mentioned per the guidance-moment rules.
          (userTier === "free_trial"
            ? `\n\nUSER TIER: Free trial (question ${totalCount + 1} of ${FREE_LIMIT}). The user is new — this is their first exposure to the coach. Be warm and make this answer land. Warmth does not mean upselling. The first question almost never needs a product mention — answer it well so the user feels what coaching from you is like. No profile on file.\nProducts available to mention (only per the guidance-moment rules): Year of the Engine, AI Programming, AI Nutrition, All Access.`
            : userTier === "coach_standalone"
            ? "\n\nUSER TIER: AI Coach subscriber (no program, no nutrition tracking). Answer as a pure coach.\nProducts available to mention (only per the guidance-moment rules): Year of the Engine, AI Programming, AI Nutrition, All Access."
            : userTier === "engine"
            ? "\n\nUSER TIER: Year of the Engine subscriber. Ground answers in their current framework and programming when relevant. They already have AI Nutrition bundled.\nProducts available to mention (only per the guidance-moment rules): AI Programming, All Access."
            : userTier === "ai_programming"
            ? "\n\nUSER TIER: AI Programming subscriber. Ground answers in their current program structure and training. They already have AI Nutrition bundled.\nProducts available to mention (only per the guidance-moment rules): Year of the Engine, All Access."
            : "\n\nUSER TIER: All Access subscriber. The user has everything — Engine, AI Programming, AI Nutrition, AI Coach.\nProducts available to mention: NONE. Mention no products under any circumstances."
          ) +
          // Athlete profile — injected for everything except pure meta
          // questions, where the profile is noise. Scoped requests
          // (workout_id / engine_program_day) always get profile.
          (questionType === "meta" && !workoutContext && !engineCoachingMode
            ? ""
            : buildAthleteContext(athleteProfile?.lifts, athleteProfile?.skills, athleteProfile?.conditioning, athleteProfile?.bodyweight, athleteProfile?.units, athleteProfile?.gender)
          ) +
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
