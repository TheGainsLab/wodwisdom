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
 * COVERAGE — this is a PARTIAL migration. Do not assume setting the env var
 * fixes everything.
 *   Covered: call-claude.ts (and therefore every function that calls it —
 *   the parse-* intake functions, etc.), plus the generation _shared modules
 *   (coaching-intake, generate-coach-state, safety-review, metcon-workcalc,
 *   surgical-block-fix) and generate-program-v3.
 *   NOT covered — these call the Anthropic API directly with literal model ids
 *   and must be migrated onto MODELS.* to complete fleet coverage:
 *     chat, generate-program (v1), generate-program-v2, nutrition-analysis,
 *     nutrition-image-recognition, nutrition-image-complete, chat-nudge-classify,
 *     analyze-workout, adjust-workout, summarize, training-analysis,
 *     incorporate-movements, _shared/extract-movements-ai, _shared/generate-notices-ai.
 *   Grep before trusting a retirement fix:
 *     grep -rn 'claude-sonnet-4-6\|claude-haiku-4-5' supabase/functions
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
