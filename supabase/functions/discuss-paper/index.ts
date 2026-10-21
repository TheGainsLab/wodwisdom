/**
 * discuss-paper — "Discuss this paper with the AI Coach", and "Ask the
 * library" when the request carries no slug.
 *
 * Paper mode (slug present): the member is reading one published research
 * entry; the conversation is grounded in that entry's verified JSON. Three-
 * tier honesty: the paper first, explicitly fenced general knowledge second,
 * pointers to other library entries third. The entry travels whole in the
 * system prompt (entries are small by design).
 *
 * Library mode (no slug): a routing pass — a small model reading the WHOLE
 * catalog of published titles/topics — picks the 0–MAX_ROUTED_PAPERS entries
 * that bear on the question, and those full verified records travel whole
 * into the answer context. No embeddings, no chunks: the answering model
 * only ever sees complete entries with their caveats attached. Every number
 * cited must name its paper; disagreements between papers are presented as
 * disagreement, never blended.
 *
 * PURE RESEARCH (founder's call, 2026-10-21): no athlete profile is
 * injected in either mode. The product is access to the research — the
 * same answer for every reader, like the paper itself. Application to a
 * specific athlete is the programming product's job, not the library's.
 * (A per-question opt-in toggle may come later; the injection helper
 * lived here through 2026-10-20 — see git history if it returns.)
 *
 * Find mode (action "find"): the ROUTER ALONE — Haiku reads the catalog,
 * returns matching slugs, no answer, nothing persisted. Free for any
 * signed-in account (a tenth of a cent per call): semantic paper-finding,
 * the step between word-search and the paid coached answer.
 *
 * Access (founder's matrix, 2026-10-21): any signed-in account may find.
 * ANSWERS are free for FREE_LIMIT questions lifetime PER SURFACE — two
 * separate pools: FREE_LIMIT in-paper Discuss questions (summed across
 * every paper thread) and FREE_LIMIT library questions (the _library
 * thread) — so each hook gets its own taste. Then 402 FREE_LIMIT.
 * PAID (the AI Research sub's research_chat entitlement, or All Access =
 * programming + engine together): DAILY_LIMIT questions per surface per
 * UTC day (fair use — generous for any human), then 429 DAILY_LIMIT.
 * Admin: unlimited — no limit ever applies to an admin, anywhere.
 *
 * Conversations persist server-side: one thread per (user, slug); library-
 * mode threads persist under the reserved slug "_library" (paper slugs are
 * [a-z0-9][a-z0-9-]*, so it can never collide with a real entry).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MODELS } from "../_shared/model-profiles.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

export const FUNCTION_VERSION = "2026-10-21.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const FREE_LIMIT = 3;
const DAILY_LIMIT = 20;
const MAX_TOKENS = 1024;
const MAX_HISTORY_TURNS = 10;
const MAX_QUESTION_CHARS = 2000;
// Library mode: how many papers the router may hand the answering model.
// The router is told to over-include borderline papers up to this cap —
// an irrelevant entry in context costs pennies; a wrongly excluded one
// costs the answer. Revisit upward as the library grows.
const MAX_ROUTED_PAPERS = 3;
// Reserved thread slug for library-mode conversations. Paper slugs match
// /^[a-z0-9][a-z0-9-]*$/, so the leading underscore can never collide.
const LIBRARY_SLUG = "_library";

// deno-lint-ignore no-explicit-any
type Json = any;

type CatalogRow = { slug: string; title: string; topics: string[] };

/**
 * Library-mode routing pass: a small model reads the ENTIRE catalog (titles
 * and topics — a page of text) with the question and names the papers that
 * bear on it. Not embedding retrieval: nothing is invisible to the router,
 * it can only misjudge, so it is instructed to over-include borderline
 * papers. Any failure degrades to [] — the answer then runs fenced, with
 * index pointers only.
 */
async function routeLibraryQuestion(question: string, catalog: CatalogRow[]): Promise<string[]> {
  const catalogText = catalog.map((r) => `- ${r.slug} — ${r.title} — topics: ${r.topics.join(", ")}`).join("\n");
  try {
    const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 300,
        temperature: 0,
        system:
          "You route a member's question to the papers in a research library for strength & conditioning athletes. " +
          "The full catalog is given (slug — title — topics). Name every paper that plausibly bears on the question, " +
          `up to ${MAX_ROUTED_PAPERS}, most relevant first. Include borderline papers: wrongly excluding one is worse ` +
          "than including one that turns out not to help. If nothing in the catalog plausibly relates, return none. " +
          'Return ONLY JSON, no prose: {"slugs": ["slug-a", "slug-b"]}',
        messages: [{ role: "user", content: `CATALOG:\n${catalogText}\n\nQUESTION: ${question}` }],
      }),
    }, 20_000);
    if (!resp.ok) {
      console.warn("[discuss-paper] router HTTP", resp.status);
      return [];
    }
    const data = await resp.json();
    const text = (data.content ?? []).filter((b: Json) => b.type === "text").map((b: Json) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    const known = new Set(catalog.map((r) => r.slug));
    return (Array.isArray(parsed.slugs) ? parsed.slugs : [])
      .filter((s: Json) => typeof s === "string" && known.has(s))
      .slice(0, MAX_ROUTED_PAPERS);
  } catch (e) {
    console.warn("[discuss-paper] router failed, answering without papers:", e);
    return [];
  }
}

function buildSystemPrompt(
  papers: Array<{ slug: string; title: string; entry: Json }>,
  index: CatalogRow[],
  libraryMode: boolean,
): string {
  const indexLines = index
    .map((r) => `- ${r.title} — /knowledge/${r.slug} — topics: ${r.topics.join(", ")}`)
    .join("\n");
  const fence = libraryMode ? "Beyond the library:" : "Beyond this paper:";
  const intro = libraryMode
    ? "You are The Gains Lab's AI Coach in research-discussion mode. The member is asking the research library as a " +
      "whole (from its front page, not inside one paper). A routing step picked the published papers most likely to " +
      "bear on their question; each is reproduced below as a verified structured record. There may be none."
    : "You are The Gains Lab's AI Coach in research-discussion mode. The member is reading ONE specific paper " +
      "from the research library, reproduced below as a verified structured record, and your job is to discuss that paper.";
  const tier1 = libraryMode
    ? "   - Lead with what the papers below say that bears on the question. Use only numbers that appear in their " +
      "records, exactly as printed — and EVERY number or finding you cite must name which paper it comes from. " +
      "If no papers are reproduced below, say plainly that the library doesn't cover this directly.\n"
    : "   - Lead with what THIS paper says that bears on the question — including partial bearings the member may have " +
      "missed. Use only numbers that appear in the record, exactly as it prints them.\n";
  const multiPaperRule = libraryMode
    ? "6. MULTI-PAPER HONESTY. Never blend findings from several papers into a conclusion no single paper drew. " +
      "When the papers disagree, present the disagreement and name each side — the library deliberately holds both " +
      "sides of live debates. Link each paper you draw on: [Paper title](/knowledge/slug).\n"
    : "";
  // PURE RESEARCH: no athlete profile, no personalized application. The
  // answer is the same for every reader. Practical COACHING interpretation
  // of the findings (what this argues for in programming terms, generally)
  // is welcome — personal prescription is the programming product's job.
  const papersBlock = papers.length > 0
    ? (libraryMode ? "THE PAPERS (verified structured records — your primary sources):\n" : "THE PAPER (verified structured record — your primary source):\n") +
      papers.map((p) => `=== ${p.title} (/knowledge/${p.slug}) ===\n${JSON.stringify(p.entry)}`).join("\n\n")
    : "THE PAPERS: none were routed to this question — answer behind the \"" + fence + "\" fence and point to index entries only if genuinely adjacent.";
  return (
    intro + "\n\n" +
    "THE LIBRARY'S HONESTY LAWS — these bind every sentence you write:\n" +
    "1. THREE TIERS, ALWAYS LABELED.\n" +
    tier1 +
    "   - Where the question genuinely runs past the paper" + (libraryMode ? "s" : "") + ", you may add general exercise-science background, but ONLY " +
    `behind an explicit fence that opens with "${fence}" — the member must always know whose claim is whose. ` +
    "Never attribute a beyond-the-" + (libraryMode ? "library" : "paper") + " claim to a study.\n" +
    "   - When another library paper (index below) covers the question more directly, point to it by its title with its " +
    "link path. Only point to papers in the index; the index is the whole library.\n" +
    "2. THE RECORDS' CAVEATS BIND YOU. What an entry's 'what_it_doesnt_mean' rules out, you may not claim. " +
    "'No significant difference' is never 'proven equal'. Do not extend findings to populations or conditions a paper " +
    "didn't study without saying you are doing so.\n" +
    "3. NEVER INVENT. No fabricated numbers, citations, study details, or quotations — from these papers or any other. " +
    "If a paper doesn't say, say that it doesn't say.\n" +
    "4. COACH VOICE, COMPACT FORMAT. Plain, direct, member-facing; explain jargon in passing. Usually under 200 words. " +
    "Your answer renders in a small chat panel: NO markdown headings (#, ##) and NO horizontal rules (---). Open with " +
    "the answer itself, never a title line. Short paragraphs; simple dash lists when they genuinely help; bold sparingly. " +
    "When you point to a library paper, write a markdown link: [Paper title](/knowledge/slug).\n" +
    "5. SCOPE. You cannot change programs, logs, or accounts, and you never discuss pricing or plans. If the member " +
    "asks for personal programming beyond what the research supports, suggest asking their AI Coach in the main " +
    "chat, which knows their full training.\n" +
    multiPaperRule +
    "\n" +
    papersBlock +
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
      const { error: apErr } = await supa
        .from("athlete_profiles").select("user_id", { count: "exact", head: true });
      checks.push({ name: "athlete_profiles readable", ok: !apErr, detail: apErr?.message });
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

    // No slug = library mode ("Ask the library" on the list page).
    const slug = typeof body.slug === "string" ? body.slug : "";
    const libraryMode = !slug;
    const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!question) return json({ error: "question is required" }, 400);

    // ── Find: the router alone — free for any signed-in account ─────────
    // Returns matching slugs, no coached answer, nothing persisted, not
    // metered. Semantic paper-finding for a tenth of a cent.
    if (body.action === "find") {
      const { data: findRows } = await supa
        .from("knowledge_entries").select("slug, entry").eq("status", "published");
      const catalog = ((findRows ?? []) as Array<{ slug: string; entry: Json }>).map((r) => ({
        slug: r.slug,
        title: (r.entry?.header?.citation?.title || r.entry?.header?.title_plain || r.slug) as string,
        topics: Array.isArray(r.entry?.header?.topics) ? r.entry.header.topics as string[] : [],
      }));
      const slugs = await routeLibraryQuestion(question, catalog);
      await supa.from("knowledge_events").insert({
        event_type: "library_find", slug: null, user_id: user.id, meta: { chars: question.length, found: slugs },
      }).then(() => {}, () => {});
      return json({ slugs });
    }

    // ── Access: entitlement, or the lifetime free meter ─────────────────
    const nowIso = new Date().toISOString();
    const [{ data: profile }, { data: entitlements }] = await Promise.all([
      supa.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supa.from("user_entitlements").select("feature")
        .eq("user_id", user.id)
        .in("feature", ["research_chat", "programming", "engine"])
        .or("expires_at.is.null,expires_at.gt." + nowIso),
    ]);
    const isAdmin = profile?.role === "admin";
    // Paid research access: the AI Research sub (research_chat), or All
    // Access — checked at runtime as programming + engine together, so
    // existing All Access subscribers need no entitlement backfill.
    const features = new Set((entitlements ?? []).map((e: { feature: string }) => e.feature));
    const entitled = isAdmin || features.has("research_chat") ||
      (features.has("programming") && features.has("engine"));
    // Free accounts: FREE_LIMIT lifetime per SURFACE — the library thread
    // meters library mode, the paper threads (summed) meter paper mode.
    // Each hook keeps its own taste. INVARIANT: no limit ever applies to
    // an admin (entitled covers it — admins are always entitled).
    let totalQuestions = 0;
    let dailyQuestions = 0;
    if (!entitled) {
      const { data: rows } = await supa
        .from("knowledge_conversations").select("slug, question_count").eq("user_id", user.id);
      totalQuestions = (rows ?? [])
        .filter((r: { slug: string }) => libraryMode ? r.slug === LIBRARY_SLUG : r.slug !== LIBRARY_SLUG)
        .reduce((a: number, r: { question_count: number }) => a + (r.question_count || 0), 0);
      if (totalQuestions >= FREE_LIMIT) {
        return json(
          { error: "Free limit reached", code: "FREE_LIMIT", usage: { tier: "free", total_questions: totalQuestions, free_limit: FREE_LIMIT } },
          402,
        );
      }
    } else if (!isAdmin) {
      // Paid fair use: DAILY_LIMIT per surface per UTC day, counted from
      // discuss_question events (user_id set explicitly — service-role
      // inserts don't get auth.uid()). meta.library marks the surface.
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { data: todays } = await supa
        .from("knowledge_events")
        .select("meta")
        .eq("event_type", "discuss_question")
        .eq("user_id", user.id)
        .gte("created_at", dayStart.toISOString());
      dailyQuestions = (todays ?? [])
        .filter((e: { meta: Json }) => libraryMode ? e.meta?.library === true : e.meta?.library !== true)
        .length;
      if (dailyQuestions >= DAILY_LIMIT) {
        return json(
          { error: "Daily limit reached — resets at midnight UTC", code: "DAILY_LIMIT", usage: { tier: "paid", daily_questions: dailyQuestions, daily_limit: DAILY_LIMIT } },
          429,
        );
      }
    }

    // ── The paper(s) and the library index ──────────────────────────────
    const { data: indexRows } = await supa
      .from("knowledge_entries").select("slug, entry").eq("status", "published");
    const published = (indexRows ?? []) as Array<{ slug: string; entry: Json }>;
    const titleOf = (r: { slug: string; entry: Json }) =>
      (r.entry?.header?.citation?.title || r.entry?.header?.title_plain || r.slug) as string;
    const catalogOf = (rows: Array<{ slug: string; entry: Json }>): CatalogRow[] =>
      rows.map((r) => ({
        slug: r.slug,
        title: titleOf(r),
        topics: Array.isArray(r.entry?.header?.topics) ? r.entry.header.topics as string[] : [],
      }));

    let papers: Array<{ slug: string; title: string; entry: Json }>;
    let routedSlugs: string[] = [];
    if (libraryMode) {
      routedSlugs = await routeLibraryQuestion(question, catalogOf(published));
      papers = published
        .filter((r) => routedSlugs.includes(r.slug))
        .map((r) => ({ slug: r.slug, title: titleOf(r), entry: r.entry }));
    } else {
      const entryRow = published.find((r) => r.slug === slug);
      if (!entryRow) return json({ error: "Paper not found or not published" }, 404);
      papers = [{ slug, title: titleOf(entryRow), entry: entryRow.entry }];
    }
    // The index the model may point to: everything published except what's
    // already reproduced whole above.
    const inPapers = new Set(papers.map((p) => p.slug));
    const index = catalogOf(published.filter((r) => !inPapers.has(r.slug)));

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
        system: buildSystemPrompt(papers, index, libraryMode),
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
      ? { tier: "paid", daily_questions: dailyQuestions + 1, daily_limit: DAILY_LIMIT, unlimited: isAdmin }
      : { tier: "free", total_questions: totalQuestions + 1, free_limit: FREE_LIMIT };

    const threadSlug = libraryMode ? LIBRARY_SLUG : slug;
    const persist = async () => {
      try {
        const at = new Date().toISOString();
        const { data: existing } = await supa
          .from("knowledge_conversations").select("id, messages, question_count")
          .eq("user_id", user.id).eq("slug", threadSlug).maybeSingle();
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
            user_id: user.id, slug: threadSlug, messages: turn, question_count: 1,
          });
        }
        await supa.from("knowledge_events").insert({
          event_type: "discuss_question",
          slug: libraryMode ? null : slug,
          // Explicit: service-role inserts don't get auth.uid(), and the
          // paid daily meter counts these rows by user.
          user_id: user.id,
          meta: { chars: question.length, entitled, ...(libraryMode ? { library: true, routed: routedSlugs } : {}) },
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
