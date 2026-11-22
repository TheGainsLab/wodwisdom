/**
 * plan-entitlements.ts — which features a plan grants, and how a Stripe price
 * resolves to them. Moved here unchanged from stripe-webhook (2026-11-22) so
 * the paid-periods record and the nightly recounts read a price the same way
 * the webhook does; there is one map, not two.
 */

// Fallback plan → entitlements mapping (used if price metadata is missing)
export const PLAN_ENTITLEMENTS: Record<string, string[]> = {
  coach: ["ai_chat"],
  nutrition: ["nutrition"],
  coach_nutrition: ["ai_chat", "nutrition"],
  engine: ["engine", "ai_chat", "nutrition"],
  programming: ["programming", "ai_chat", "nutrition"],
  all_access: ["ai_chat", "programming", "engine", "nutrition", "research_chat"],
  // AI Research ($9.99): the knowledge sub — Talk to the Research plus the
  // methodology AI Coach chat. ai_chat rides along so chat treats these
  // subscribers as coach_standalone (20/day), matching the research cap.
  ai_research: ["research_chat", "ai_chat"],
};

// Resolve a feature list from price/subscription metadata. `entitlements` (a
// comma list) wins; otherwise the `plan` name maps through PLAN_ENTITLEMENTS.
export function featuresFromMetadata(meta: Record<string, string> | undefined | null): string[] {
  if (!meta) return [];
  if (meta.entitlements) return meta.entitlements.split(",").map(s => s.trim()).filter(Boolean);
  if (meta.plan && PLAN_ENTITLEMENTS[meta.plan]) return PLAN_ENTITLEMENTS[meta.plan];
  return [];
}
