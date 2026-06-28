/**
 * persist-training-summary.ts
 *
 * Persistence + versioning for the Training Summary (Step 4 evidence layer).
 * Same immutable, append-only-on-change pattern as persist-athlete-model /
 * persist-coach-state. The content hash covers the MEANINGFUL evidence
 * (per-lift est-1RM/sessions/sets/RPE + movement volume + sessions logged) and
 * EXCLUDES volatile dates (as_of, best_set.date, last_performed) so a rolling
 * window alone doesn't mint a new version — only a real change in the training
 * picture does. Soft contract: callers treat a throw as non-fatal.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TrainingSummary } from "./training-summary.ts";

const OMIT = new Set(["as_of", "best_set", "last_performed"]);

function stableStringify(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (OMIT.has(k)) continue;
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PersistTrainingSummaryResult {
  version: number;
  persisted: boolean;
}

interface LatestRow {
  version: number;
  content_hash: string;
}

export async function persistTrainingSummary(
  supa: SupabaseClient,
  userId: string,
  summary: TrainingSummary,
): Promise<PersistTrainingSummaryResult> {
  const contentHash = await sha256Hex(stableStringify(summary));

  const { data: latest, error: readErr } = await supa
    .from("training_summaries")
    .select("version, content_hash")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<LatestRow>();
  if (readErr) throw new Error(`[persist-training-summary] read failed for ${userId}: ${readErr.message}`);

  if (latest && latest.content_hash === contentHash) {
    return { version: latest.version, persisted: false };
  }

  const version = latest ? latest.version + 1 : 1;
  const { error: insErr } = await supa.from("training_summaries").insert({
    user_id: userId,
    version,
    content_hash: contentHash,
    summary,
    training_summary_version: summary.training_summary_version,
  });
  if (insErr) throw new Error(`[persist-training-summary] insert failed for ${userId}: ${insErr.message}`);

  return { version, persisted: true };
}
