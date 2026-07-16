/**
 * gym-coach — the STAFF coach seam: the retail AI Coach's methodology brain,
 * exposed to affiliate gym OWNERS through their portal.
 *
 * Doctrine placement: this is a staff seam (the program-brief / review-desk
 * family), NOT the member generation seam. THE GENERATION RULE protects the
 * MEMBER's runtime path; owners are staff, and staff seams call wodwisdom at
 * runtime today. Zero member identity ever appears here, and nothing is
 * stored on this side — the conversation is the only payload, and the
 * affiliate persists its own transcripts.
 *
 * Request (server-to-server; X-Service-Key = WHOLESALE consumer-key family):
 *   POST { gym_id, question, history?: [{ role: "user"|"assistant", content }] }
 *
 * Response: SSE stream, same event shapes as the retail chat function so
 * clients can share parsing:
 *   data: { type: "sources", sources: [{ title, author, source }] }
 *   data: { type: "delta",   text }
 *   data: { type: "done" }
 *
 * Pipeline (retail chat minus the retail plumbing): one Haiku router call
 * (topic gate + search-query rewrite) → embedding → match_chunks_multi RAG
 * over the full knowledge base → streamed Sonnet answer. No entitlement
 * tiers (tenant key is the entitlement), no athlete profile, no Engine day
 * mode, no product catalog / upsell guidance — the caller is a gym owner,
 * not a retail prospect. Quota (20/day/gym) is enforced affiliate-side.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { MODELS } from "../_shared/model-profiles.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-coach",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The retail COACH_SPINE's persona/grounding rules, re-aimed at the person who
// RUNS the gym. Product catalog + guidance-moment machinery deliberately
// absent: no retail products are ever pitched across this seam.
const GYM_COACH_SYSTEM =
  "You are an expert coach advising the owner or head coach of a CrossFit affiliate. Your influences are CrossFit methodology — Greg Glassman's foundational writings, the CrossFit Level 1 Training Guide, the CrossFit Journal — alongside strength-science literature and exercise physiology.\n\n" +
  "AUDIENCE: A gym owner running classes and coaching coaches. Lean into their problems: programming for a mixed class, scaling one workout across wildly different athletes, movement standards and coaching cues, developing newer coaches, structuring cycles for a whole gym, athlete retention through training quality. When a question could be read as either 'for me as an athlete' or 'for my gym', prefer the gym reading unless they say otherwise.\n\n" +
  "VOICE: Coach-to-coach, direct, practical, no fluff. Conversational paragraphs, not blog posts. Minimal headers and bullets. Keep answers 150-300 words for simple questions, up to 500 for complex ones. Avoid excessive formatting. Avoid opening every answer with the same quote.\n\n" +
  "GROUNDING & ATTRIBUTION:\n" +
  "- When the RELEVANT ARTICLES section below contains material that directly supports your answer, weave it in naturally with attribution to the article and author. Do not list sources at the end — work them into the prose.\n" +
  "- When that section is empty, weak, or doesn't address the question, answer from CrossFit methodology and your coaching expertise. Speak as the coach: \"standard programming is…\", \"the methodology calls for…\", \"in my experience…\". Do NOT name a specific article, journal, author, guide, or publication. Do NOT invent quotations. Do NOT attribute claims to \"the articles,\" \"the journal,\" \"the materials,\" \"the sources,\" or any specific publication unless that exact content appears in the RELEVANT ARTICLES section below.\n" +
  "- Never mention retrieval, your knowledge base, your training, your access to information, your limitations, or what you do or don't have. Never break character. You are a coach answering a coach.\n\n" +
  "META-QUESTIONS: If asked about your background, methodology, what you draw from, or your influences, answer in-character — describe your influences (CrossFit methodology, Glassman's writings, the Level 1 guide, the CrossFit Journal, strength-science literature, exercise physiology). Never describe yourself as an AI. Never reference \"provided context,\" \"retrieved sources,\" or any retrieval mechanism.\n\n" +
  "Never mention pricing, products, subscriptions, or plans of any kind.";

const DECLINE_TEXT =
  "I'm your coaching and methodology resource — programming, movement, scaling, nutrition, running training at your gym. That question is a bit outside my lane. What can I help you with on the coaching side?";

interface ChatTurn { role: "user" | "assistant"; content: string }

/** Emit a complete canned answer in the standard SSE shape. */
function cannedStream(text: string, headers: Record<string, string>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "sources", sources: [] })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

/**
 * One Haiku call doing what retail chat spends two on: gate off-topic
 * questions AND rewrite the query for retrieval. Fails open (allow, raw
 * question) — a router hiccup must never block a paying owner.
 */
async function routeQuestion(
  question: string,
  history: ChatTurn[],
): Promise<{ allow: boolean; searchQuery: string }> {
  const fallback = { allow: true, searchQuery: question.substring(0, 500) };
  if (!ANTHROPIC_API_KEY) return fallback;
  try {
    const recent = history
      .slice(-2)
      .map((m) => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`)
      .join("\n");
    const userBlock = recent
      ? `Recent conversation:\n${recent}\n\nLatest question:\n${question}`
      : `Question:\n${question}`;
    const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 120,
        system:
          "You route questions for an AI coach used by CrossFit gym owners. Output ONLY one JSON object, no prose, no code fences, with two fields:\n\n" +
          '1. "allow" — true if the question relates to fitness, training, programming, coaching, running classes or a gym\'s training product, movement, scaling, nutrition, recovery, physiology, athlete development, or anything else a coach would field. false ONLY for questions completely unrelated to health, fitness, or coaching (homework, code, legal, entertainment, politics, …).\n\n' +
          '2. "search_query" — a clean standalone topical search string for retrieval: keywords and phrases, no filler, folding in topical context from the recent conversation. Preserve proper nouns that ARE the topic (day types, program names, named benchmarks). null when allow is false.\n\n' +
          'Examples:\n{"allow":true,"search_query":"scaling options mixed ability class snatch"}\n{"allow":false,"search_query":null}',
        messages: [{ role: "user", content: userBlock.substring(0, 3000) }],
      }),
    }, 5_000);
    if (!resp.ok) return fallback;
    const data = await resp.json();
    const text = (data.content?.[0]?.text || "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    if (parsed?.allow === false) return { allow: false, searchQuery: "" };
    const q = typeof parsed?.search_query === "string" && parsed.search_query.trim()
      ? parsed.search_query.trim().substring(0, 500)
      : fallback.searchQuery;
    return { allow: true, searchQuery: q };
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return json({ error: "invalid_request", detail: "POST only" }, 405);

  if (!auth.configured()) return json({ error: "internal", detail: "seam not configured" }, 500);
  const presented = req.headers.get("x-service-key") ?? "";
  const authz = presented ? await auth.authorize(presented) : null;
  if (!authz) return json({ error: "forbidden", detail: "invalid service key" }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request", detail: "body must be JSON" }, 400);
  }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a UUID" }, 400);
  if (!auth.authorizes(authz.authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for this gym" }, 403);
  }

  const question = typeof body.question === "string" ? body.question.trim().slice(0, 4_000) : "";
  if (!question) return json({ error: "invalid_request", detail: "question required" }, 400);

  const history: ChatTurn[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter((m): m is ChatTurn => {
          const t = m as { role?: unknown; content?: unknown };
          return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
        })
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4_000) }))
    : [];

  if (!ANTHROPIC_API_KEY) return json({ error: "internal", detail: "model not configured" }, 500);

  try {
    // ── Route: topic gate + retrieval query, one Haiku call ──
    const route = await routeQuestion(question, history);
    if (!route.allow) return cannedStream(DECLINE_TEXT, cors);

    // ── Retrieve: full knowledge base (owners get every category) ──
    let chunks:
      | { title: string; author: string; source: string; content: string; similarity: number }[]
      | null = null;
    if (OPENAI_API_KEY) {
      try {
        const embResp = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + OPENAI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "text-embedding-3-small", input: route.searchQuery }),
        }, 10_000);
        const embData = await embResp.json();
        const queryEmb = embData?.data?.[0]?.embedding;
        if (queryEmb) {
          const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          const { data } = await supa.rpc("match_chunks_multi", {
            query_embedding: queryEmb,
            match_threshold: 0.4,
            match_count: 6,
            filter_categories: ["journal", "science", "strength-science", "engine"],
          });
          chunks = data;
        }
      } catch (err) {
        console.error("[gym-coach] retrieval failed (answering without RAG):", err);
      }
    }

    const sources: { title: string; author: string; source: string }[] = [];
    let articles = "";
    if (chunks && chunks.length > 0) {
      articles =
        "\n\nRELEVANT ARTICLES:\n" +
        chunks
          .map((c, i) => {
            sources.push({ title: c.title, author: c.author, source: c.source });
            return `[Source ${i + 1}: ${c.title}${c.author ? " by " + c.author : ""} | ${(c.similarity * 100).toFixed(0)}% match]\n${c.content}`;
          })
          .join("\n\n");
    }

    // ── Answer: streamed Sonnet, re-emitted in the house SSE shape ──
    const messages = [...history, { role: "user", content: question }];
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.sonnet,
        max_tokens: 1024,
        temperature: 0.3,
        stream: true,
        system: GYM_COACH_SYSTEM + articles,
        messages,
      }),
    });
    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      console.error("[gym-coach] Claude API error:", err);
      return json({ error: "internal", detail: "model call failed" }, 500);
    }

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`));
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
                  controller.enqueue(
                    enc.encode(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`),
                  );
                }
              } catch {
                // skip unparseable upstream lines
              }
            }
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        } catch (err) {
          console.error("[gym-coach] stream error:", err);
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ type: "error", error: "stream interrupted" })}\n\n`),
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
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("[gym-coach] error:", e);
    return json({ error: "internal", detail: (e as Error).message }, 500);
  }
});
