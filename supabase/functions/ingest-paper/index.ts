/**
 * ingest-paper — the research-library ingestion pipeline (admin only).
 *
 * Input: { storage_path } for a PDF already in the knowledge-pdfs bucket, or
 * { pdf_base64, filename } to upload-and-ingest in one call. The function
 * sends the PDF to the model with the ingestion prompt (generated from
 * src/data/knowledge/ingestion-prompt.md), validates the drafted entry
 * (knowledge-validate.ts, the build.py port), gives the model one repair
 * round on validator errors, and stores the result as a draft row in
 * knowledge_entries with its validator_report. Publishing is a separate,
 * human act in the admin review screen — this function never publishes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { resolveModelProfile } from "../_shared/model-profiles.ts";
import { validateKnowledgeEntry } from "../_shared/knowledge-validate.ts";
import { KNOWLEDGE_INGESTION_PROMPT } from "../_shared/knowledge-ingestion-prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

// Bumped with every change to this function. The admin System Check compares
// it against the version the app expects, so "did the deploy happen?" is a
// question the system answers about itself.
export const FUNCTION_VERSION = "2026-10-16.4";

// The hardest extraction + judgment in the app: quality profile (Opus
// primary, Sonnet fallback). One attempt each — a PDF pass is slow, and the
// edge wall clock is ~400s.
const PROFILE = resolveModelProfile("quality");
// Background wall clock is ~400s: primary + fallback must leave room for a
// repair round, which is skipped when the first pass ran long.
const ATTEMPT_TIMEOUT_MS = 150_000;
const MAX_TOKENS = 24_000;

const SYSTEM = KNOWLEDGE_INGESTION_PROMPT +
  "\n\nReturn ONLY the JSON object for this document — no prose, no markdown fences.";

async function draftFromPdf(
  pdfBase64: string,
  feedback: string | null,
  opts?: { timeoutMs?: number; primaryOnly?: boolean },
): Promise<{ text: string; model: string }> {
  const content: unknown[] = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
    {
      type: "text",
      text: feedback
        ? `Your previous output failed these validator checks:\n${feedback}\n\nReturn the corrected, complete JSON object.`
        : "Produce the knowledge entry JSON for this document.",
    },
  ];
  const models = opts?.primaryOnly
    ? [PROFILE.primary]
    : [PROFILE.primary, ...(PROFILE.fallback ? [PROFILE.fallback] : [])];
  const timeoutMs = opts?.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  let lastErr = "";
  for (const model of models) {
    try {
      const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          messages: [{ role: "user", content }],
        }),
      }, timeoutMs);
      if (resp.ok) {
        const data = await resp.json();
        if (data.stop_reason === "max_tokens") {
          // A truncated entry can't be parsed; name the real cause.
          throw new Error("output truncated at the token limit — paper too dense for one pass");
        }
        const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text).join("").trim();
        if (text) return { text, model };
        lastErr = "empty response";
      } else {
        const err = await resp.json().catch(() => ({}));
        lastErr = `${resp.status}: ${JSON.stringify(err).slice(0, 300)}`;
        console.warn(`ingest-paper: ${model} failed — ${lastErr}`);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`ingest-paper: ${model} threw — ${lastErr}`);
    }
  }
  throw new Error(`model drafting failed: ${lastErr}`);
}

/** Pull the first balanced JSON object out of the model's text. */
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model output");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON in model output");
}

/** first-author surname + year, deduped against existing slugs. */
function deriveSlug(entry: Record<string, unknown>, taken: Set<string>): string {
  const header = entry.header as Record<string, unknown> | undefined;
  const cite = header?.citation as Record<string, string> | undefined;
  const surname = (cite?.authors ?? "paper").split(/[,\s]+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "paper";
  const year = /^\d{4}$/.test(cite?.year ?? "") ? cite!.year : "";
  const base = year ? `${surname}-${year}` : surname;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    // Authenticate + require admin (same gate as admin-data).
    const authHeader = req.headers.get("Authorization");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader?.replace("Bearer ", "") ?? "";
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await supa.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return json({ error: "Forbidden" }, 403);

    const body = await req.json();

    // ── System check: verify every link in the pipeline, server side ──────
    if (body.action === "selftest") {
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

      add("function: env ANTHROPIC_API_KEY", !!ANTHROPIC_API_KEY);
      add("function: env service role", !!SUPABASE_SERVICE_KEY && !!SUPABASE_URL);

      // Storage round trip (the client uploaded a tiny probe first).
      if (body.probe_path) {
        const { data: blob, error: dlErr } = await supa.storage.from("knowledge-pdfs").download(body.probe_path);
        add("storage: function can read uploads", !!blob && !dlErr, dlErr?.message ?? "");
        const { error: rmErr } = await supa.storage.from("knowledge-pdfs").remove([body.probe_path]);
        add("storage: function can delete", !rmErr, rmErr?.message ?? "");
      } else {
        add("storage: probe missing", false, "client did not upload a probe");
      }

      // DB: drafting/failed statuses allowed (the status migration), row lifecycle.
      const probeSlug = `selftest-${Date.now()}`;
      const { error: insErr } = await supa.from("knowledge_entries").insert({
        slug: probeSlug, status: "drafting", entry: { header: { title_plain: "selftest" } },
      });
      add("db: knowledge_entries insert + drafting status", !insErr, insErr?.message ?? "");
      if (!insErr) {
        const { error: updErr } = await supa.from("knowledge_entries").update({ status: "failed" }).eq("slug", probeSlug);
        add("db: failed status allowed", !updErr, updErr?.message ?? "");
        const { error: delErr } = await supa.from("knowledge_entries").delete().eq("slug", probeSlug);
        add("db: delete", !delErr, delErr?.message ?? "");
      }
      const { error: glosErr } = await supa.from("knowledge_glossary").select("term_key").limit(1);
      add("db: knowledge_glossary exists", !glosErr, glosErr?.message ?? "");
      const { error: evErr } = await supa.from("knowledge_events").insert({ event_type: "selftest" });
      add("db: knowledge_events insert", !evErr, evErr?.message ?? "");

      // Model reachable with the configured key (1-token ping, pennies).
      try {
        const ping = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: PROFILE.fallback ?? PROFILE.primary, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        }, 20_000);
        const pj = await ping.json().catch(() => ({}));
        add("model: API key + model reachable", ping.ok, ping.ok ? "" : JSON.stringify(pj).slice(0, 200));
      } catch (e) {
        add("model: API key + model reachable", false, e instanceof Error ? e.message : String(e));
      }

      return json({ version: FUNCTION_VERSION, checks, ok: checks.every((c) => c.ok) });
    }
    let storagePath: string = body.storage_path ?? "";
    let pdfBase64: string;

    if (body.pdf_base64) {
      // Upload-and-ingest in one call.
      const filename = String(body.filename ?? "paper.pdf").replace(/[^A-Za-z0-9._-]/g, "_");
      storagePath = `${Date.now()}-${filename}`;
      const bytes = Uint8Array.from(atob(body.pdf_base64), (c) => c.charCodeAt(0));
      const { error: upErr } = await supa.storage
        .from("knowledge-pdfs")
        .upload(storagePath, bytes, { contentType: "application/pdf" });
      if (upErr) return json({ error: `PDF upload failed: ${upErr.message}` }, 500);
      pdfBase64 = body.pdf_base64;
    } else if (storagePath) {
      const { data: file, error: dlErr } = await supa.storage.from("knowledge-pdfs").download(storagePath);
      if (dlErr || !file) return json({ error: `PDF download failed: ${dlErr?.message}` }, 404);
      pdfBase64 = b64encode(await file.arrayBuffer());
    } else {
      return json({ error: "Provide storage_path or pdf_base64" }, 400);
    }

    // The drafting pass outlives the gateway's request window, so it runs as
    // a background task: insert a 'drafting' placeholder row, respond 202
    // immediately, and let the queue poll the row's status.
    const stubSlug = `ingest-${Date.now()}`;
    const filenameLabel = storagePath.replace(/^\d+-/, "");
    const { error: stubErr } = await supa.from("knowledge_entries").insert({
      slug: stubSlug,
      status: "drafting",
      entry: { header: { title_plain: `Drafting from ${filenameLabel}…`, citation: {}, topics: [] } },
      source_pdf_path: storagePath,
    });
    if (stubErr) return json({ error: `Could not start draft: ${stubErr.message}` }, 500);

    const work = (async () => {
      const t0 = Date.now();
      try {
        let { text, model } = await draftFromPdf(pdfBase64, null);
        let entry = extractJson(text);
        let report = validateKnowledgeEntry(entry);
        let repaired = false;
        if (report.errors.length > 0 && Date.now() - t0 < 180_000) {
          try {
            // Capped so worst-case total stays inside the background wall clock.
            const retry = await draftFromPdf(pdfBase64, report.errors.join("\n"), { timeoutMs: 120_000, primaryOnly: true });
            const retryEntry = extractJson(retry.text);
            const retryReport = validateKnowledgeEntry(retryEntry);
            if (retryReport.errors.length < report.errors.length) {
              entry = retryEntry;
              report = retryReport;
              model = retry.model;
              repaired = true;
            }
          } catch (e) {
            console.warn("ingest-paper: repair round failed, keeping first draft:", e);
          }
        }

        // Slug: derive from citation, honor the model's own if it's free.
        const { data: existing } = await supa.from("knowledge_entries").select("slug");
        const taken = new Set(
          (existing ?? []).map((r: { slug: string }) => r.slug).filter((s: string) => s !== stubSlug),
        );
        const slug = typeof entry.slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(entry.slug as string) && !taken.has(entry.slug as string)
          ? entry.slug as string
          : deriveSlug(entry, taken);
        entry.slug = slug;
        entry.id = slug;
        report = validateKnowledgeEntry(entry);

        // A concurrent ingest (or the dedup read missing rows) can collide on
        // the slug primary key: retry with a numeric suffix rather than
        // failing a successfully drafted entry.
        let saved = false;
        let lastSaveErr = "";
        for (let n = 0; n < 5 && !saved; n++) {
          const candidate = n === 0 ? slug : `${slug}-${n + 1}`;
          entry.slug = candidate;
          entry.id = candidate;
          const { error: upErr2 } = await supa.from("knowledge_entries").update({
            slug: candidate,
            status: "draft",
            entry,
            validator_report: { ...report, model, repaired },
            updated_at: new Date().toISOString(),
          }).eq("slug", stubSlug);
          if (!upErr2) {
            saved = true;
            console.log(`ingest-paper: drafted ${candidate} (${model}${repaired ? ", repaired" : ""}, ${report.errors.length} errors)`);
          } else if (upErr2.code === "23505") {
            lastSaveErr = upErr2.message;
          } else {
            throw new Error(`draft save failed: ${upErr2.message}`);
          }
        }
        if (!saved) throw new Error(`draft save failed after slug retries: ${lastSaveErr}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("ingest-paper background failure:", msg);
        await supa.from("knowledge_entries").update({
          status: "failed",
          validator_report: { errors: [msg], warnings: [] },
          updated_at: new Date().toISOString(),
        }).eq("slug", stubSlug);
      }
    })();

    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else work.catch(() => {});

    return json({ slug: stubSlug, status: "drafting" }, 202);
  } catch (e) {
    console.error("ingest-paper error:", e);
    return json({ error: e instanceof Error ? e.message : "Ingestion failed" }, 500);
  }
});
