/**
 * label-movements — an AI says, for each distinct movement name that nobody
 * has labelled yet, which of the profile's lifts or skills it counts toward
 * (or "none"), and the answer is stored on every row carrying that name.
 *
 * Why it exists (2026-11-25): from this date the AI that WRITES a movement
 * labels it (counts-toward.ts). Movements written and logged before that have
 * no label. This labels them, once per distinct name. It also picks up any
 * row written without a label afterwards (a movement a member typed by hand),
 * so it is safe to run again at any time: it only ever fills empty labels and
 * never changes one that is there.
 *
 * Auth: service role bearer only.
 * Invoke: POST <fn-url>?dry_run=true&limit=150   (Authorization: Bearer $SERVICE_ROLE)
 *   dry_run=true  ask the AI and return its answers; write nothing.
 *   limit         distinct names this call (default 150, max 600), most used first.
 * Response: { labelled: [{ movement, counts_toward, uses, rows }], failed, remaining }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COUNTS_TOWARD_INSTRUCTION, COUNTS_TOWARD_VALUES, storedCountsToward } from "../_shared/counts-toward.ts";
import { MODELS } from "../_shared/model-profiles.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
const BATCH = 50;

const SYSTEM = `You label movement names from a CrossFit training app. For each numbered name, say which of the athlete's PROFILE entries it counts toward.

${COUNTS_TOWARD_INSTRUCTION}

Some names are not really a movement (a whole workout pasted into the name field, a note, a typo you cannot read). Those are "none". Answer for every number you are given.`;

const TOOL = {
  name: "label_movements",
  description: "Give the counts_toward answer for every numbered movement name.",
  input_schema: {
    type: "object",
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "The number of the name in the list." },
            counts_toward: { type: "string", enum: [...COUNTS_TOWARD_VALUES] },
          },
          required: ["n", "counts_toward"],
          additionalProperties: false,
        },
      },
    },
    required: ["labels"],
    additionalProperties: false,
  },
};

/** Ask for one batch. Returns index → answer; a name the AI skipped or the
 *  call lost is simply absent, and stays unlabelled for the next run. */
async function askBatch(names: string[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ANTHROPIC_API_KEY) return out;
  const list = names.map((n, i) => `${i + 1}. ${n.replace(/\s+/g, " ").slice(0, 120)}`).join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODELS.sonnet,
          max_tokens: 4096,
          stream: false,
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: "tool", name: TOOL.name },
          messages: [{ role: "user", content: `Movement names:\n${list}` }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        console.error(`[label-movements] AI HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
        continue;
      }
      const data = await resp.json();
      const tool = (data.content ?? []).find((b: { type?: string; name?: string }) => b.type === "tool_use" && b.name === TOOL.name);
      const labels = (tool?.input as { labels?: unknown } | undefined)?.labels;
      if (!Array.isArray(labels)) continue;
      for (const l of labels as Array<{ n?: unknown; counts_toward?: unknown }>) {
        const v = storedCountsToward(l?.counts_toward);
        if (Number.isInteger(l?.n) && v && (l.n as number) >= 1 && (l.n as number) <= names.length) out.set((l.n as number) - 1, v);
      }
      return out;
    } catch (e) {
      console.error("[label-movements] AI call failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

/** Service role only. The platform verifies the token's signature before the
 *  function runs (verify_jwt is on for this function), so the role it carries
 *  can be trusted; the stored key is accepted too. */
function isServiceRole(header: string | null): boolean {
  const token = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SUPABASE_SERVICE_KEY) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!isServiceRole(req.headers.get("Authorization"))) return json({ error: "service role only" }, 401);
  if (!ANTHROPIC_API_KEY) return json({ error: "no AI key configured" }, 500);

  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dry_run") === "true";
  const limit = Math.max(1, Math.min(600, parseInt(params.get("limit") ?? "150", 10) || 150));
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: rows, error } = await supa.rpc("unlabelled_movement_names", { p_limit: limit });
  if (error) return json({ error: `could not list names: ${error.message}` }, 500);
  const names = ((rows ?? []) as Array<{ movement: string; uses: number }>).filter((r) => (r.movement ?? "").trim() !== "");

  const labelled: Array<{ movement: string; counts_toward: string; uses: number; rows: number | null }> = [];
  const failed: string[] = [];
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const answers = await askBatch(batch.map((b) => b.movement));
    for (let j = 0; j < batch.length; j++) {
      const v = answers.get(j);
      if (!v) { failed.push(batch[j].movement.slice(0, 80)); continue; }
      let written: number | null = null;
      if (!dryRun) {
        const { data: n, error: wErr } = await supa.rpc("apply_movement_label", { p_movement: batch[j].movement, p_counts_toward: v });
        if (wErr) { failed.push(batch[j].movement.slice(0, 80)); continue; }
        written = typeof n === "number" ? n : null;
      }
      labelled.push({ movement: batch[j].movement.slice(0, 120), counts_toward: v, uses: Number(batch[j].uses), rows: written });
    }
  }

  let remaining: number | null = null;
  if (!dryRun) {
    const { data: left } = await supa.rpc("unlabelled_movement_names", { p_limit: 1000 });
    remaining = Array.isArray(left) ? left.length : null;
  }
  return json({ dry_run: dryRun, asked: names.length, labelled, failed, remaining });
});
