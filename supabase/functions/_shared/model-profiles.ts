/**
 * model-profiles.ts — central model registry + named profiles.
 *
 * Replaces the Claude model ids hardcoded across ~30 edge functions. Two goals:
 *
 *   1. Model retirement becomes a CONFIG change, not a fleet redeploy. A retired
 *      snapshot 404s every hardcoded call site at once ("Claude API call
 *      failed"). Env overrides (Supabase function secrets) win over the pinned
 *      defaults, so a swap is: set MODEL_SONNET=<new id> and the whole fleet
 *      follows on next cold start.
 *
 *   2. Engine extraction (docs/portfolio/ENGINE_EXTRACTION.md): the extracted
 *      Engine resolves a request/tenant `model_profile` (cost vs. quality)
 *      without touching call sites. This is the local seed of that indirection —
 *      adopt `MODELS.sonnet` / `resolveModelProfile()` instead of string
 *      literals, and the profile becomes a request parameter later.
 *
 * Phase 1 adopts this in the generation core (call-claude + the generation
 * _shared modules + generate-program-v3). Peripheral functions (nutrition,
 * chat, analyze-workout, etc.) still hold string literals and migrate
 * incrementally onto MODELS.* — see the model-pinning note.
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
