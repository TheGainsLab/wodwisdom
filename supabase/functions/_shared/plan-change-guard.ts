/**
 * plan-change-guard.ts — a self-serve plan change may never take away
 * something the member already has.
 *
 * Why (2026-11-23): the Home screen's locked Engine tile sent a Programming
 * member to "Confirm Your Upgrade" for the Engine plan. A subscription holds
 * ONE price, so confirming REPLACED Programming with the Engine: Programming
 * access ended and their program was archived (and the reverse reset an
 * Engine member's Engine). The checkout page's plan LIST only ever offered
 * true upgrades; the tile's direct link went around the list. This guard sits
 * on the server, behind every route in.
 *
 * Pure — no I/O. Used by preview-upgrade and update-subscription.
 */

import { featuresFromMetadata, PLAN_ENTITLEMENTS } from "./plan-entitlements.ts";

type PriceTable = Record<string, { monthly: string | undefined; quarterly: string | undefined }>;

const FEATURE_LABELS: Record<string, string> = {
  programming: "AI Programming",
  engine: "Year of the Engine",
  nutrition: "Nutrition",
  ai_chat: "AI Coach",
  research_chat: "the Research Library chat",
};

/** The plan key a Stripe price id belongs to, or null when it is not one of ours. */
export function planForPrice(prices: PriceTable, priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  for (const [plan, p] of Object.entries(prices)) {
    if (p.monthly === priceId || p.quarterly === priceId) return plan;
  }
  return null;
}

/**
 * What the member holds on their current price: the plan's features when the
 * price is one of ours, else whatever the price's own metadata declares.
 * Unknown on both counts = [] (nothing provable to protect).
 */
export function currentFeatures(
  prices: PriceTable,
  // deno-lint-ignore no-explicit-any
  currentPrice: any,
): string[] {
  const plan = planForPrice(prices, currentPrice?.id);
  if (plan && PLAN_ENTITLEMENTS[plan]) return PLAN_ENTITLEMENTS[plan];
  return featuresFromMetadata(currentPrice?.metadata);
}

/** Features held now that the new plan does not include. */
export function featuresLost(held: string[], newPlan: string): string[] {
  const next = PLAN_ENTITLEMENTS[newPlan] ?? [];
  return held.filter((f) => !next.includes(f));
}

/** Throws when the change would remove something the member has. */
export function assertKeepsEverything(
  prices: PriceTable,
  // deno-lint-ignore no-explicit-any
  currentPrice: any,
  newPlan: string,
): void {
  const lost = featuresLost(currentFeatures(prices, currentPrice), newPlan);
  if (lost.length === 0) return;
  const names = lost.map((f) => FEATURE_LABELS[f] ?? f);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  throw new Error(
    `That change would remove ${list} from your subscription. Choose All Access to keep everything you have.`,
  );
}
