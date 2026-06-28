/**
 * persist-coach-state.ts
 *
 * Persistence + versioning for CoachState (Step 2). Same immutable, append-
 * only-on-change pattern as persist-athlete-model.ts: content-hash the
 * decision snapshot and only INSERT a new version when it differs from the
 * athlete's latest row. A re-run with identical decisions is a no-op.
 *
 * The row pins the athlete_model_version it was built on (provenance lineage)
 * and the builder version (the transform). Soft contract: callers treat a
 * thrown error as non-fatal.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CoachState, CoachStateContent } from "./coach-state.ts";

function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
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

export interface PersistCoachStateResult {
  coach_state: CoachState;
  version: number;
  persisted: boolean;
}

interface LatestRow {
  version: number;
  content_hash: string;
  coach_state: CoachState;
}

export async function persistCoachState(
  supa: SupabaseClient,
  userId: string,
  content: CoachStateContent,
  athleteModelVersion: number,
  cyclePointer: { month: number } | null = null,
): Promise<PersistCoachStateResult> {
  // Hash the decision content + the input/transform pins, so a model-version
  // change (new facts) or a builder bump also produces a new CoachState version.
  const contentHash = await sha256Hex(
    stableStringify({ content, athleteModelVersion, cyclePointer }),
  );

  const { data: latest, error: readErr } = await supa
    .from("coach_states")
    .select("version, content_hash, coach_state")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<LatestRow>();

  if (readErr) {
    throw new Error(`[persist-coach-state] read failed for ${userId}: ${readErr.message}`);
  }

  if (latest && latest.content_hash === contentHash) {
    return { coach_state: latest.coach_state, version: latest.version, persisted: false };
  }

  const version = latest ? latest.version + 1 : 1;
  const coach_state: CoachState = {
    ...content,
    version,
    athlete_id: userId,
    athlete_model_version: athleteModelVersion,
    cycle_pointer: cyclePointer,
    created_at: new Date().toISOString(),
  };

  const { error: insErr } = await supa.from("coach_states").insert({
    user_id: userId,
    version,
    athlete_model_version: athleteModelVersion,
    coach_state_builder_version: content.coach_state_builder_version,
    content_hash: contentHash,
    coach_state,
  });

  if (insErr) {
    throw new Error(`[persist-coach-state] insert failed for ${userId}: ${insErr.message}`);
  }

  return { coach_state, version, persisted: true };
}
