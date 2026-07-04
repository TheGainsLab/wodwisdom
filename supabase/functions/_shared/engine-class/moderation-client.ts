/**
 * engine-class/moderation-client.ts — seam 2 of F4_MODERATION_CONTRACT: read the
 * affiliate moderation ledger so the wodwisdom leaderboard/TV can ENFORCE it (drop
 * `hide`, badge `flag`, substitute `adjust`). The affiliate ledger is authoritative;
 * wodwisdom renders its decisions.
 *
 * GRACEFUL DEGRADATION (mirrors the affiliate's own ledger-only fallback): unconfigured
 * or unreachable → returns an EMPTY map + connected=false, and the board renders
 * unmoderated. NEVER fatal — a moderation-service blip must not take down the wall TV.
 *
 * The affiliate exposes this as the `get_active` ACTION on its multi-action
 * `engine-moderation` endpoint (contract seam 2, option B), so the request MUST carry
 * `action: "get_active"` — without it the affiliate routes to its owner|coach Bearer
 * path and this s2s call is rejected (→ silent unmoderated degrade). Shape:
 * POST { action: "get_active", gym_id, class_id? } with X-Service-Key →
 * { moderations: [{ result_ref, decision, adjustment|null }] }.
 */

import { fetchWithTimeout } from "../fetch-with-timeout.ts";
import type { ModerationRow } from "./leaderboard.ts";

const MODERATION_TIMEOUT_MS = 6_000;

export interface ModerationFetch {
  connected: boolean;
  moderations: Map<string, ModerationRow>;
}

const EMPTY: ModerationFetch = { connected: false, moderations: new Map() };

/** Fetch the moderation ledger for a gym (+ optional class). Never throws. */
export async function fetchModerations(gymId: string, classId?: string | null): Promise<ModerationFetch> {
  const url = Deno.env.get("AFFILIATE_MODERATION_URL");
  const key = Deno.env.get("AFFILIATE_MODERATION_KEY");
  if (!url || !key) return EMPTY; // seam not wired yet → ledger-only degrade

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "X-Service-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_active", gym_id: gymId, class_id: classId ?? null }),
    }, MODERATION_TIMEOUT_MS);
    if (!res.ok) {
      console.warn(`[engine-class] moderation ledger read ${res.status}; rendering unmoderated`);
      return EMPTY;
    }
    const body = await res.json().catch(() => ({})) as { moderations?: unknown };
    const rows = Array.isArray(body.moderations) ? body.moderations : [];
    const map = new Map<string, ModerationRow>();
    for (const r of rows) {
      const row = r as Partial<ModerationRow>;
      if (typeof row.result_ref === "string" &&
          (row.decision === "flag" || row.decision === "hide" || row.decision === "adjust")) {
        map.set(row.result_ref, {
          result_ref: row.result_ref,
          decision: row.decision,
          adjustment: row.adjustment ?? null,
        });
      }
    }
    return { connected: true, moderations: map };
  } catch (e) {
    console.warn("[engine-class] moderation ledger unreachable; rendering unmoderated:", (e as Error).message);
    return EMPTY;
  }
}
