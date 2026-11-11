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
 * adjust-workout, summarize, incorporate-movements,
 * preprocess-program, parse-injuries-constraints, _shared/extract-movements-ai,
 * _shared/generate-notices-ai). A model retirement is a config change: set the
 * MODEL_SONNET / MODEL_HAIKU / MODEL_OPUS secret and redeploy. Verify no literals
 * ever creep back in:
 *     grep -rn 'claude-sonnet-4-6\|claude-haiku-4-5' supabase/functions   # → only this file
 *
 * CAVEAT (2026-11): "config change" holds within a model generation. The 5.x
 * models (Sonnet 5.5, Haiku 5.5, Fable 5.1+) return 400 on forced
 * `tool_choice: { type: "tool" }` and on non-default `temperature`, which the
 * forced-tool seats (pipeline week-fill, adjust-workout, safety-review, ...)
 * and the streaming chat seats still send. Do not point MODEL_SONNET /
 * MODEL_HAIKU / MODEL_FABLE at a 5.x id without migrating those seats first.
 * Also: those models think by default and return a `thinking` block BEFORE
 * the text, so `content[0].text` reads as empty — read text blocks by type
 * (call-claude's textOf). The ~12 direct call sites still index [0].
 */

/** Concrete model ids, env-overridable. Change a snapshot here or via secret. */
export const MODELS = {
  sonnet: Deno.env.get("MODEL_SONNET") ?? "claude-sonnet-4-6",
  haiku: Deno.env.get("MODEL_HAIKU") ?? "claude-haiku-4-5-20251001",
  opus: Deno.env.get("MODEL_OPUS") ?? "claude-opus-4-8",
  // Current-generation Sonnet. Opt-in per seat, like fable: Sonnet 5.5 rejects
  // forced tool_choice and non-default temperature, which ~13 MODELS.sonnet
  // seats still send — so this is NOT a drop-in for `sonnet`. Adopted first by
  // the Engine sequencer (2026-11-11), a plain system+messages seat.
  sonnet5: Deno.env.get("MODEL_SONNET5") ?? "claude-sonnet-5-5",
  // Frontier tier — adopted for the free eval (CoachState) after the 2026-08
  // side-by-side; call sites opt in explicitly, nothing reads this by default.
  fable: Deno.env.get("MODEL_FABLE") ?? "claude-fable-5",
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
