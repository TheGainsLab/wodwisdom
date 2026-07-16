/**
 * classify-chat-questions — nightly AI labeling of chat questions.
 *
 * Reads chat_messages that have no chat_question_insights row yet, classifies
 * them in batches with Haiku against the fixed broad taxonomy (see the
 * 20260718000000 migration), and inserts one insights row per message.
 * Everything downstream (topic trends, feature-request feed, review queue,
 * weekly digest) is plain SQL over the labeled rows.
 *
 * Batching: BATCH_SIZE questions per Claude call (one JSON array in/out),
 * up to max_batches calls per invocation (default 5 → ~100 messages/run,
 * well inside the edge wall-clock). The nightly volume fits one batch;
 * the historical BACKFILL is the same function invoked repeatedly until
 * `remaining` hits 0 (each response reports it).
 *
 * Self-healing: unclassified = "no row yet", so a failed run, a skipped
 * message, or a model misfire is simply retried on the next run. Messages the
 * model doesn't return labels for are left unclassified (not defaulted).
 *
 * Modes:
 *   ?dry_run=true      classify ONE batch, return labels + message ids,
 *                      insert nothing. For eyeballing label quality. Returns
 *                      ids and labels only — no question text — so the
 *                      response leaks no user content to unauthenticated
 *                      callers (see auth note).
 *   ?max_batches=N     cap batches this invocation (1..20, default 5).
 *
 * Auth: none inside the function — verify_jwt=false in config.toml, called by
 * pg_cron (same posture and service-key-drift rationale as the reconcilers).
 * Worst-case abuse is triggering bounded classification spend on messages
 * that needed classifying anyway; responses carry counts/ids/labels, never
 * chat content.
 *
 * Deploy:   supabase functions deploy classify-chat-questions
 * Schedule: nightly via pg_cron, e.g.
 *   SELECT cron.schedule('classify-chat-questions-nightly', '15 3 * * *', $$
 *     SELECT net.http_post(
 *       url := '<project-url>/functions/v1/classify-chat-questions',
 *       headers := '{"Content-Type": "application/json"}'::jsonb,
 *       body := '{}'::jsonb
 *     );
 *   $$);
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MODELS } from "../_shared/model-profiles.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const BATCH_SIZE = 20;
const MAX_Q_CHARS = 800;
const MAX_A_CHARS = 1200;

const TOPICS = new Set(["engine", "training", "body", "performance", "product", "other"]);
const INTENTS = new Set(["question", "feature_request", "complaint", "praise"]);

const SYSTEM = `You classify questions that users asked a fitness coaching AI. For each numbered item (the user's QUESTION and the coach's ANSWER), assign labels.

topic — exactly one of:
- engine: the "Year of the Engine" conditioning program — its training days, pacing targets, intervals, time trials, erg/bike/row sessions, RPMs, energy systems, aerobic/anaerobic conditioning work
- training: all other training — strength, skills, technique, programming, workout strategy, scaling, competition prep
- body: the athlete's body — nutrition, fueling, weight, supplements, injury, pain, soreness, recovery, sleep, mobility
- performance: benchmarks and standing — "how do I compare", scores, percentiles, testing, what's elite, realistic goals for a test
- product: the app or business — features, plans, pricing, billing, account, how the app works
- other: none of the above

intent — exactly one of:
- question: seeking coaching, information, or advice (the default)
- feature_request: asking for a capability the product doesn't obviously have ("can you/the app do X?")
- complaint: frustration or dissatisfaction with the product, program, or answers
- praise: positive feedback

buying_intent — true only if the user shows interest in paid plans, upgrades, or what a subscription includes.

review_worthy — true if a human should review this exchange: the answer looks wrong, evasive, or hedgy; the question is injury/pain/medical territory; or the user is clearly frustrated.

A question comparing Engine outputs to peers is performance, not engine. When torn between engine and training, pick engine only if it's clearly about Engine conditioning work.

Output ONLY a JSON array, no prose, no code fences:
[{"i": 1, "topic": "engine", "intent": "question", "buying_intent": false, "review_worthy": false}, ...]
Include every item number you were given exactly once.`;

interface MsgRow {
  id: string;
  user_id: string;
  question: string;
  answer: string | null;
}

interface Label {
  topic: string;
  intent: string;
  buying_intent: boolean;
  review_worthy: boolean;
}

/** Parse and validate the model's JSON array into per-item labels (1-based i). */
function parseLabels(raw: string, count: number): Map<number, Label> {
  const out = new Map<number, Label>();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return out;
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return out;
    for (const item of arr) {
      const i = Number(item?.i);
      if (!Number.isInteger(i) || i < 1 || i > count || out.has(i)) continue;
      const topic = TOPICS.has(item?.topic) ? item.topic : "other";
      const intent = INTENTS.has(item?.intent) ? item.intent : "question";
      out.set(i, {
        topic,
        intent,
        buying_intent: item?.buying_intent === true,
        review_worthy: item?.review_worthy === true,
      });
    }
  } catch { /* unparseable → empty map → batch retried next run */ }
  return out;
}

async function classifyBatch(rows: MsgRow[]): Promise<Map<number, Label>> {
  const items = rows
    .map((r, idx) => {
      const q = r.question.slice(0, MAX_Q_CHARS);
      const a = (r.answer ?? "").slice(0, MAX_A_CHARS);
      return `### ${idx + 1}\nQUESTION: ${q}\nANSWER: ${a || "(no answer recorded)"}`;
    })
    .join("\n\n");

  const resp = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.haiku,
        max_tokens: 60 * rows.length + 100,
        system: SYSTEM,
        messages: [{ role: "user", content: items }],
      }),
    },
    60_000,
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  return parseLabels(data?.content?.[0]?.text ?? "", rows.length);
}

Deno.serve(async (req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const maxBatches = dryRun
    ? 1
    : Math.min(Math.max(parseInt(url.searchParams.get("max_batches") ?? "5", 10) || 5, 1), 20);

  let processed = 0;
  let inserted = 0;
  let batches = 0;
  const errors: string[] = [];
  // dry-run preview: ids + labels only, never question text.
  const preview: Array<{ message_id: string } & Label> = [];

  try {
    for (let b = 0; b < maxBatches; b++) {
      // Unclassified = no insights row. The !left + is-null embed filter is
      // the PostgREST idiom for an anti-join.
      const { data: rows, error } = await supa
        .from("chat_messages")
        .select("id, user_id, question, answer, chat_question_insights!left(message_id)")
        .is("chat_question_insights", null)
        .not("question", "is", null)
        .neq("question", "")
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);
      if (error) throw new Error(`select failed: ${error.message}`);
      const batch = (rows ?? []) as unknown as MsgRow[];
      if (batch.length === 0) break;

      batches++;
      processed += batch.length;
      const labels = await classifyBatch(batch);

      if (dryRun) {
        for (const [i, l] of labels) preview.push({ message_id: batch[i - 1].id, ...l });
        break;
      }

      const toInsert = [...labels.entries()].map(([i, l]) => ({
        message_id: batch[i - 1].id,
        user_id: batch[i - 1].user_id,
        ...l,
        model: MODELS.haiku,
      }));
      if (toInsert.length > 0) {
        const { error: insErr } = await supa
          .from("chat_question_insights")
          .upsert(toInsert, { onConflict: "message_id", ignoreDuplicates: true });
        if (insErr) throw new Error(`insert failed: ${insErr.message}`);
        inserted += toInsert.length;
      }
      // Items the model skipped stay unclassified and retry next run. If the
      // whole batch yielded nothing, stop rather than spin on the same rows.
      if (toInsert.length === 0) {
        errors.push(`batch ${batches}: model returned no usable labels`);
        break;
      }
    }
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Remaining unclassified (same anti-join, count only).
  const { count: remaining } = await supa
    .from("chat_messages")
    .select("id, chat_question_insights!left(message_id)", { count: "exact", head: true })
    .is("chat_question_insights", null)
    .not("question", "is", null)
    .neq("question", "");

  return new Response(
    JSON.stringify(
      { dry_run: dryRun, batches, processed, inserted, remaining: remaining ?? null, errors, ...(dryRun ? { preview } : {}) },
      null,
      2,
    ),
    { status: errors.length > 0 ? 500 : 200, headers: { "Content-Type": "application/json" } },
  );
});
