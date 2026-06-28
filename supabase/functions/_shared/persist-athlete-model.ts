/**
 * persist-athlete-model.ts
 *
 * Persistence + versioning for the deterministic Athlete Model (Step 1 of
 * the coaching-state architecture). Kept separate from athlete-model.ts so
 * the builder stays I/O-free + trivially testable.
 *
 * IMMUTABLE, append-only-on-change:
 *   - The model is a pure function of (profile, competition, thresholds,
 *     builder). We content-hash the deterministic model and only INSERT a
 *     new version when the hash differs from the athlete's latest row.
 *   - A re-run with identical inputs is a no-op (returns the existing row).
 *   - version steps +1 on every content change; profile_version steps +1
 *     only when the static profile inputs change (profile_hash differs).
 *
 * Soft contract: callers should treat a thrown error as non-fatal —
 * generation never depends on persistence succeeding (see build-writer-
 * payload, which falls back to an unpersisted version-0 model).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AthleteModel,
  AthleteModelContent,
  AthleteProfileStatic,
} from "./athlete-model.ts";

/** Deterministic JSON: object keys sorted recursively, `as_of` omitted
 *  (informational provenance that must not churn versions). */
function stableStringify(value: unknown, omitKeys: Set<string>): string {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (omitKeys.has(k)) continue;
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface PersistAthleteModelResult {
  model: AthleteModel;
  version: number;
  /** false when the latest snapshot already matched (no new row written). */
  persisted: boolean;
}

interface LatestRow {
  version: number;
  profile_version: number;
  model_hash: string;
  profile_hash: string;
  model: AthleteModel;
}

export async function persistAthleteModel(
  supa: SupabaseClient,
  userId: string,
  content: AthleteModelContent,
  profileSnapshot: AthleteProfileStatic,
): Promise<PersistAthleteModelResult> {
  // Hash the deterministic BELIEF content. Exclude `as_of` (timestamps) and
  // `capability_revisions` (a debugging trace whose evidence dates shift as the
  // training window rolls) — those must not churn versions. A real belief change
  // (capability value / source / confidence, ratios, normatives) still does.
  const modelHash = await sha256Hex(
    stableStringify(content, new Set(["as_of", "capability_revisions"])),
  );
  const profileHash = await sha256Hex(stableStringify(profileSnapshot, new Set()));

  const { data: latest, error: readErr } = await supa
    .from("athlete_models")
    .select("version, profile_version, model_hash, profile_hash, model")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<LatestRow>();

  if (readErr) {
    throw new Error(`[persist-athlete-model] read failed for ${userId}: ${readErr.message}`);
  }

  // No change → no new version.
  if (latest && latest.model_hash === modelHash) {
    return { model: latest.model, version: latest.version, persisted: false };
  }

  const version = latest ? latest.version + 1 : 1;
  const profile_version = latest
    ? (latest.profile_hash === profileHash ? latest.profile_version : latest.profile_version + 1)
    : 1;

  const model: AthleteModel = {
    ...content,
    version,
    profile_version,
    created_at: new Date().toISOString(),
  };

  const { error: insErr } = await supa.from("athlete_models").insert({
    user_id: userId,
    version,
    profile_version,
    model_hash: modelHash,
    profile_hash: profileHash,
    model,
    profile_snapshot: profileSnapshot,
    thresholds_version: content.thresholds_version,
    model_builder_version: content.model_builder_version,
  });

  if (insErr) {
    throw new Error(`[persist-athlete-model] insert failed for ${userId}: ${insErr.message}`);
  }

  return { model, version, persisted: true };
}
