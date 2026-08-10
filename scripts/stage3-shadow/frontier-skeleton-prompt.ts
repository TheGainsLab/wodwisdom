/**
 * frontier-skeleton-prompt.ts — RETIRED as a separate prompt (2026-08-10).
 *
 * The full-document channel was adopted into production: the addendum
 * (document rules, session budget, maintain primaries, deload labeling) now
 * lives inside V3_SKELETON_SYSTEM_PROMPT itself, and the document block
 * builder lives in _shared/coach-state.ts. This module re-exports both so the
 * harness always tests EXACTLY what production runs — no drift possible.
 */

import { V3_SKELETON_SYSTEM_PROMPT } from "../../supabase/functions/_shared/v3-skeleton-prompt.ts";
export { buildCoachStateDocumentBlock } from "../../supabase/functions/_shared/coach-state.ts";

/** Identity now — the live prompt IS the full-document prompt. */
export function buildFrontierSkeletonSystemPrompt(): string {
  return V3_SKELETON_SYSTEM_PROMPT;
}
