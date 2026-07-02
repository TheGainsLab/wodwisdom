/**
 * model-profiles.ts — central model registry + named profiles.
 *
 * Replaces the Claude model ids hardcoded across ~30 edge functions. Two goals:
 *
 *   1. Model retirement becomes a CONFIG change for adopted call sites, not a
 *      code edit. A retired snapshot 404s every HARDCODED call site at once
 *      ("Claude API call failed"). For code that reads MODELS.* / call-claude,
 *      an env override (MODEL_SONNET / MODEL_HAIKU / MODEL_OPUS function
 *      secret) fixes it on next cold start.
 *
 *   2. Engine extraction (docs/portfolio/ENGINE_EXTRACTION.md): the extracted
 *      Engine resolves a request/tenant `model_profile` (cost vs. quality)
 *      without touching call sites. This is the local seed of that indirection.
 *
 * COVERAGE — COMPLETE. Every Claude call site across supabase/functions now reads
 * MODELS.* / resolveModelProfile() (call-claude and its callers, the generation
 * _shared modules, and the ~16 functions that called the Anthropic API directly:
 * chat, generate-program(-v2), nutrition-*, chat-nudge-classify, analyze-workout,
 * adjust-workout, summarize, training-analysis, incorporate-movements,
 * preprocess-program, parse-injuries-constraints, _shared/extract-movements-ai,
 * _shared/generate-notices-ai). A model retirement is a config change: set the
 * MODEL_SONNET / MODEL_HAIKU / MODEL_OPUS secret and redeploy. Verify no literals
 * ever creep back in:
 *     grep -rn 'claude-sonnet-4-6\|claude-haiku-4-5' supabase/functions   # → only this file
 */

/** Concrete model ids, env-overridable. Change a snapshot here or via secret. */
export const MODELS = {
  sonnet: Deno.env.get("MODEL_SONNET") ?? "claude-sonnet-4-6",
  haiku: Deno.env.get("MODEL_HAIKU") ?? "claude-haiku-4-5-20251001",
  opus: Deno.env.get("MODEL_OPUS") ?? "claude-opus-4-8",
} as const;

export type ModelProfile = "default" | "fast" | "quality";

export interface ResolvedProfile {
  /** Primary model to try first. */
  primary: string;
  /** Model to fall back to on overload/429, or null for no fallback. */
  fallback: string | null;
}

const PROFILES: Record<ModelProfile, ResolvedProfile> = {
  // Today's behavior: Sonnet primary, Haiku fallback (mirrors call-claude).
  default: { primary: MODELS.sonnet, fallback: MODELS.haiku },
  // Cheap/fast path for mechanical extraction + classification.
  fast: { primary: MODELS.haiku, fallback: null },
  // Highest quality for the hardest generation/judgment.
  quality: { primary: MODELS.opus, fallback: MODELS.sonnet },
};

/** Resolve a named profile to concrete primary/fallback model ids. */
export function resolveModelProfile(profile: ModelProfile = "default"): ResolvedProfile {
  return PROFILES[profile] ?? PROFILES.default;
}
