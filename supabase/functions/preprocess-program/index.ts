/**
 * preprocess-program edge function — freelance program ingestion.
 *
 * Ingests an externally-authored training program (pasted text, or an
 * uploaded Excel / image / PDF), parses it in ONE structured AI call
 * (tool-use → WriterOutput), and persists it to v3 program storage via the
 * shared saveProgramV3 — landing it as a peer of generate-program-v3's
 * output.
 *
 * This is one of two doors into the platform: "bring your own program".
 * The other is generate-program-v3 ("we generate it"). Both converge on
 * WriterOutput + saveProgramV3 + the v3 tables (programs / program_workouts
 * / program_blocks_v2 / program_movements_v2).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MODELS } from "../_shared/model-profiles.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { getCorsHeaders } from "../_shared/cors.ts";
import { INGEST_PROGRAM_PROMPT } from "../_shared/ingest-program-prompt.ts";
import { buildIngestProgramTool, type WriterOutput } from "../_shared/v2-output-schema.ts";
import { saveProgramV3 } from "../_shared/save-program-v3.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;

/**
 * Resolve the calling user.
 * - Service-role bearer token + body user_id → trust it (internal call).
 * - Otherwise validate the JWT and extract the user.
 */
async function resolveUserId(
  supa: ReturnType<typeof createClient>,
  authHeader: string,
  bodyUserId?: string | null,
): Promise<{ userId: string; error?: never } | { userId?: never; error: string }> {
  const token = authHeader.replace("Bearer ", "");
  if (token === SUPABASE_SERVICE_KEY && bodyUserId) {
    return { userId: bodyUserId };
  }
  const { data: { user }, error } = await supa.auth.getUser(token);
  if (error || !user) return { error: "Unauthorized" };
  return { userId: user.id };
}

/** Flatten an Excel workbook to tab-separated text for the AI to parse. */
function xlsxToText(arrayBuffer: ArrayBuffer): string {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as (string | number)[][];
    if (rows.length === 0) continue;
    if (wb.SheetNames.length > 1) lines.push(`--- Sheet: ${sheetName} ---`);
    for (const row of rows) lines.push(row.map((c) => String(c ?? "")).join("\t"));
  }
  return lines.join("\n");
}

/**
 * Compact movement vocabulary, so the parser canonicalizes movement names
 * against our library (clean analytics joins downstream).
 */
async function loadVocabulary(supa: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supa.from("movements").select("display_name, aliases");
  if (!data) return "";
  return (data as { display_name: string; aliases: string[] | null }[])
    .map((m) =>
      Array.isArray(m.aliases) && m.aliases.length > 0
        ? `${m.display_name} (${m.aliases.join(", ")})`
        : m.display_name
    )
    .join("\n");
}

type UserContent = string | Array<Record<string, unknown>>;

/** One structured tool-use call → WriterOutput. Returns null on failure. */
async function ingestCall(userContent: UserContent, apiKey: string): Promise<WriterOutput | null> {
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        stream: false,
        system: INGEST_PROGRAM_PROMPT,
        tools: [buildIngestProgramTool()],
        tool_choice: { type: "tool", name: "emit_ingested_program" },
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    console.error("[preprocess-program] Claude request failed:", e);
    return null;
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[preprocess-program] Claude HTTP ${resp.status}: ${errText.slice(0, 500)}`);
    return null;
  }

  const data = await resp.json();
  const toolUse = (data.content ?? []).find(
    (b: Record<string, unknown>) => b.type === "tool_use" && b.name === "emit_ingested_program",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    console.error(
      `[preprocess-program] missing emit_ingested_program tool_use. stop_reason=${data.stop_reason}`,
    );
    return null;
  }
  return toolUse.input as WriterOutput;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (d: unknown, status = 200) =>
    new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { name, text, file_base64, file_type, source, user_id: bodyUserId, gym_name, is_ongoing, committed } = body;

    const resolved = await resolveUserId(supa, authHeader, bodyUserId);
    if (resolved.error) return json({ error: resolved.error }, 401);
    const userId = resolved.userId;

    if (!ANTHROPIC_API_KEY) return json({ error: "AI service unavailable" }, 503);

    // ── Build the user-message content from whatever input form arrived ──
    const vocabulary = await loadVocabulary(supa);
    let userContent: UserContent;

    if (file_base64 && file_type) {
      const ft = String(file_type).toLowerCase();
      if (ft === "xlsx" || ft === "xls" || ft === "csv" || ft === "txt") {
        const bytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
        const raw = ft === "xlsx" || ft === "xls"
          ? xlsxToText(bytes.buffer)
          : new TextDecoder("utf-8").decode(bytes);
        if (raw.trim().length < 10) return json({ error: "The file has no readable program content." }, 400);
        userContent = `MOVEMENT VOCABULARY:\n${vocabulary}\n\nPROGRAM:\n${raw.trim()}`;
      } else if (["png", "jpg", "jpeg", "webp", "heic"].includes(ft)) {
        const mediaTypes: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic",
        };
        userContent = [
          { type: "image", source: { type: "base64", media_type: mediaTypes[ft], data: file_base64 } },
          { type: "text", text: `MOVEMENT VOCABULARY:\n${vocabulary}\n\nParse the program shown in the image above.` },
        ];
      } else if (ft === "pdf") {
        userContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: file_base64 } },
          { type: "text", text: `MOVEMENT VOCABULARY:\n${vocabulary}\n\nParse the program in the document above.` },
        ];
      } else {
        return json({ error: "Unsupported file type. Use xlsx, xls, csv, txt, pdf, or an image." }, 400);
      }
    } else if (typeof text === "string" && text.trim().length >= 10) {
      userContent = `MOVEMENT VOCABULARY:\n${vocabulary}\n\nPROGRAM:\n${text.trim()}`;
    } else {
      return json({ error: "Provide program text (at least 10 characters) or a file." }, 400);
    }

    // ── Parse → WriterOutput ──
    const writerOutput = await ingestCall(userContent, ANTHROPIC_API_KEY);
    if (!writerOutput || !Array.isArray(writerOutput.weeks) || writerOutput.weeks.length === 0) {
      return json({ error: "Could not parse a program from the input." }, 422);
    }

    // ── Persist via the shared v3 write path ──
    const programId = await saveProgramV3(supa, userId, writerOutput, {
      name: (name && String(name).trim()) || "Imported Program",
      source: source ?? "external",
      gymName: gym_name ?? null,
      isOngoing: is_ongoing === true,
      committed: committed === true,
    });

    const dayCount = writerOutput.weeks.reduce((n, w) => n + (w.days?.length ?? 0), 0);
    return json({ program_id: programId, workout_count: dayCount });
  } catch (e) {
    console.error("preprocess-program error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
