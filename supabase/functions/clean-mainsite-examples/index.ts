/**
 * clean-mainsite-examples — fills mainsite_examples from the library, once.
 *
 * Reads every main site entry (chunks, category 'mainsite'), cleans each
 * metcon to the workout itself (_shared/mainsite-clean.ts) and stores the
 * cleaned text in mainsite_examples. The originals are never changed.
 *
 * Service role only.
 *   POST ?dry_run=true (default)  cleans and reports counts plus a sample; stores nothing.
 *   POST ?dry_run=false           stores the cleaned text (replacing any earlier run).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanMainsiteWorkout } from "../_shared/mainsite-clean.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  const dryRun = new URL(req.url).searchParams.get("dry_run") !== "false";
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const rows: Array<{ chunk_id: string; workout_date: string | null; kind: string; name: string | null; text: string }> = [];
  let read = 0, notMetcon = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa.from("chunks").select("id, content").eq("category", "mainsite").order("id").range(from, from + 999);
    if (error) return json({ error: `read failed: ${error.message}` }, 500);
    for (const r of (data ?? []) as Array<{ id: string; content: string }>) {
      read++;
      const c = cleanMainsiteWorkout(r.content);
      if (!c) { notMetcon++; continue; }
      rows.push({ chunk_id: r.id, workout_date: c.date, kind: c.kind, name: c.name, text: c.text });
    }
    if ((data ?? []).length < 1000) break;
  }

  if (dryRun) {
    return json({ dry_run: true, stored: 0, read, cleaned: rows.length, not_a_metcon_or_empty: notMetcon, sample: rows.slice(0, 5) });
  }

  let stored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ ...r, cleaned_at: new Date().toISOString() }));
    const { error } = await supa.from("mainsite_examples").upsert(batch, { onConflict: "chunk_id" });
    if (error) return json({ error: `store failed after ${stored}: ${error.message}` }, 500);
    stored += batch.length;
  }
  return json({ dry_run: false, stored, read, cleaned: rows.length, not_a_metcon_or_empty: notMetcon });
});
