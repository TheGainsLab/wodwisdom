/**
 * discuss-paper — "Discuss this paper with the AI Coach".
 *
 * The member is reading one published research entry; this function runs a
 * conversation grounded in that entry's verified JSON. Three-tier honesty:
 * the paper first, explicitly fenced general knowledge second, pointers to
 * other library entries third. The entry travels whole in the system prompt
 * (entries are small by design) — no retrieval infrastructure.
 *
 * Access: signed-in required. The `research_chat` entitlement (or admin)
 * is unlimited; everyone else gets a lifetime total of FREE_LIMIT questions
 * across the whole library, metered by summing question_count over the
 * member's knowledge_conversations rows. Mirrors the main coach's meter
 * contract (402 + code FREE_LIMIT) so the client handling is identical.
 *
 * Conversations persist server-side: one thread per (user, slug), appended
 * on every answered question — saved history is a day-one property, not a
 * paid feature toggle.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MODELS } from "../_shared/model-profiles.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

export const FUNCTION_VERSION = "2026-10-16.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const FREE_LIMIT = 3;
const MAX_TOKENS = 1024;
const MAX_HISTORY_TURNS = 10;
const MAX_QUESTION_CHARS = 2000;

// deno-lint-ignore no-explicit-any
type Json = any;

function buildSystemPrompt(entry: Json, index: Array<{ slug: string; title: string; topics: string[] }>): string {
  const indexLines = index
    .map((r) => `- ${r.title} — /knowledge/${r.slug} — topics: ${r.topics.join(", ")}`)
    .join("\n");
  return (
    "You are The Gains Lab's AI Coach in research-discussion mode. The member is reading ONE specific paper " +
    "from the research library, reproduced below as a verified structured record, and your job is to discuss that paper.\n\n" +
    "THE LIBRARY'S HONESTY LAWS — these bind every sentence you write:\n" +
    "1. THREE TIERS, ALWAYS LABELED.\n" +
    "   - Lead with what THIS paper says that bears on the question — including partial bearings the member may have " +
    "missed. Use only numbers that appear in the record, exactly as it prints them.\n" +
    "   - Where the question genuinely runs past the paper, you may add general exercise-science background, but ONLY " +
    "behind an explicit fence that opens with \"Beyond this paper:\" — the member must always know whose claim is whose. " +
    "Never attribute a beyond-the-paper claim to this study.\n" +
    "   - When another library paper (index below) covers the question more directly, point to it by its title with its " +
    "link path. Only point to papers in the index; the index is the whole library.\n" +
    "2. THE RECORD'S CAVEATS BIND YOU. What the entry's 'what_it_doesnt_mean' rules out, you may not claim. " +
    "'No significant difference' is never 'proven equal'. Do not extend findings to populations or conditions the paper " +
    "didn't study without saying you are doing so.\n" +
    "3. NEVER INVENT. No fabricated numbers, citations, study details, or quotations — from this paper or any other. " +
    "If the paper doesn't say, say that it doesn't say.\n" +
    "4. COACH VOICE. Plain, direct, member-facing; explain jargon in passing. Usually under 200 words. Warm, never " +
    "academic for its own sake. You may use short lists when they genuinely help.\n" +
    "5. SCOPE. You cannot change programs, logs, or accounts, and you never discuss pricing or plans. If the member " +
    "asks for personal programming, answer what the research supports and suggest asking their AI Coach in the main " +
    "chat, which knows their training.\n\n" +
    "THE PAPER (verified structured record — your primary source):\n" +
    JSON.stringify(entry) +
    "\n\nTHE LIBRARY INDEX (the only other papers you may reference or link):\n" +
    indexLines
  );
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: Json, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // ── Selftest: lets Run System Check prove this function end to end ──
    if (body.action === "selftest") {
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
      checks.push({ name: "env: ANTHROPIC_API_KEY", ok: !!ANTHROPIC_API_KEY });
      const { count, error: entErr } = await supa
        .from("knowledge_entries").select("slug", { count: "exact", head: true }).eq("status", "published");
      checks.push({ name: "published entries readable", ok: !entErr && (count ?? 0) >= 0, detail: entErr?.message ?? `${count} published` });
      const { error: convErr } = await supa
        .from("knowledge_conversations").select("id", { count: "exact", head: true });
      checks.push({ name: "conversations table", ok: !convErr, detail: convErr?.message });
      try {
        const ping = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: MODELS.haiku, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        }, 20_000);
        checks.push({ name: "model ping", ok: ping.ok, detail: ping.ok ? MODELS.haiku : `HTTP ${ping.status}` });
      } catch (e) {
        checks.push({ name: "model ping", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
      return json({ version: FUNCTION_VERSION, checks, ok: checks.every((c) => c.ok) });
    }

    const slug = typeof body.slug === "string" ? body.slug : "";
    const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!slug || !question) return json({ error: "slug and question are required" }, 400);

    // ── Access: entitlement or lifetime free meter ──────────────────────
    const nowIso = new Date().toISOString();
    const [{ data: profile }, { data: entitlements }] = await Promise.all([
      supa.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supa.from("user_entitlements").select("feature")
        .eq("user_id", user.id)
        .eq("feature", "research_chat")
        .or("expires_at.is.null,expires_at.gt." + nowIso),
    ]);
    const entitled = profile?.role === "admin" || (entitlements ?? []).length > 0;

    let totalQuestions = 0;
    if (!entitled) {
      const { data: rows } = await supa
        .from("knowledge_conversations").select("question_count").eq("user_id", user.id);
      totalQuestions = (rows ?? []).reduce((a: number, r: { question_count: number }) => a + (r.question_count || 0), 0);
      if (totalQuestions >= FREE_LIMIT) {
        return json(
          { error: "Free limit reached", code: "FREE_LIMIT", usage: { tier: "free", total_questions: totalQuestions, free_limit: FREE_LIMIT } },
          402,
        );
      }
    }

    // ── The paper and the library index ─────────────────────────────────
    const [{ data: entryRow, error: entryErr }, { data: indexRows }] = await Promise.all([
      supa.from("knowledge_entries").select("entry").eq("slug", slug).eq("status", "published").maybeSingle(),
      supa.from("knowledge_entries").select("slug, entry").eq("status", "published"),
    ]);
    if (entryErr || !entryRow) return json({ error: "Paper not found or not published" }, 404);

    const index = (indexRows ?? [])
      .filter((r: Json) => r.slug !== slug)
      .map((r: Json) => ({
        slug: r.slug as string,
        title: (r.entry?.header?.citation?.title || r.entry?.header?.title_plain || r.slug) as string,
        topics: Array.isArray(r.entry?.header?.topics) ? r.entry.header.topics as string[] : [],
      }));

    // History is client-supplied display state; the server-stored thread is
    // canonical for persistence, but the model sees what the member sees.
    const history = Array.isArray(body.history)
      ? body.history
          .filter((m: Json) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_HISTORY_TURNS)
          .map((m: Json) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      : [];

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELS.sonnet,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        stream: true,
        system: buildSystemPrompt(entryRow.entry, index),
        messages: [...history, { role: "user", content: question }],
      }),
    });
    if (!claudeResp.ok) {
      const err = await claudeResp.text().catch(() => "");
      console.error("[discuss-paper] model error:", claudeResp.status, err.slice(0, 300));
      return json({ error: "Failed to generate response" }, 500);
    }

    // Relay the model stream in the house SSE contract (delta/done/error),
    // accumulate the answer, persist the thread after the stream closes.
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let fullAnswer = "";
    const usagePayload = entitled
      ? { tier: "paid" }
      : { tier: "free", total_questions: totalQuestions + 1, free_limit: FREE_LIMIT };

    const persist = async () => {
      try {
        const at = new Date().toISOString();
        const { data: existing } = await supa
          .from("knowledge_conversations").select("id, messages, question_count")
          .eq("user_id", user.id).eq("slug", slug).maybeSingle();
        const turn = [
          { role: "user", content: question, at },
          { role: "assistant", content: fullAnswer, at },
        ];
        if (existing) {
          await supa.from("knowledge_conversations").update({
            messages: [...(existing.messages ?? []), ...turn],
            question_count: (existing.question_count || 0) + 1,
            updated_at: at,
          }).eq("id", existing.id);
        } else {
          await supa.from("knowledge_conversations").insert({
            user_id: user.id, slug, messages: turn, question_count: 1,
          });
        }
        await supa.from("knowledge_events").insert({
          event_type: "discuss_question", slug, meta: { chars: question.length, entitled },
        });
      } catch (e) {
        console.error("[discuss-paper] persist failed:", e);
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        const send = (ev: Json) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        try {
          const reader = claudeResp.body!.getReader();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (!raw || raw === "[DONE]") continue;
              try {
                const ev = JSON.parse(raw);
                if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                  fullAnswer += ev.delta.text;
                  send({ type: "delta", text: ev.delta.text });
                }
              } catch { /* keep streaming past unparseable lines */ }
            }
          }
          await persist();
          send({ type: "done", usage: usagePayload });
        } catch (e) {
          console.error("[discuss-paper] stream error:", e);
          send({ type: "error", error: "Stream interrupted" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("[discuss-paper]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
