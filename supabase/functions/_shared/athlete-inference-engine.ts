/**
 * athlete-inference-engine.ts
 *
 * Step 4 — the Athlete Inference Engine (DETERMINISTIC — curated rules, NOT ML,
 * NOT LLM). It owns BELIEF REVISION: the single question
 *
 *     "given the current belief + new evidence, should belief change?"
 *
 * which unifies capability estimation, confidence promotion, the
 * no-penalty-from-absence rule, and (as a consequence) Athlete Model version
 * creation. It is STATELESS/REPRODUCIBLE: belief = f(prior belief + the current
 * evidence window). It never mutates a running belief; the persist layer mints a
 * new Model version only when this freshly-revised belief differs from the last
 * stored one.
 *
 * v1 RULE — evidence RAISES or CORROBORATES, never auto-cuts:
 *   - observed clearly above self-reported   → raise the value (athlete proved more).
 *   - observed at/near self-reported         → corroborate (hold value, raise confidence).
 *   - observed below (likely volume work)    → no change (no-penalty; not a max attempt).
 *   - no evidence                            → no change (absence is neutral).
 * A genuine decline is surfaced as a TREND via the Athlete Model diff (the
 * "what we learned" story) — NOT an automatic value cut here. (Auto-downward
 * revision from near-max efforts is a documented future refinement.)
 */

import type { Capability, Confidence } from "./athlete-model.ts";
import type { TrainingSummary } from "./training-summary.ts";

export const INFERENCE_VERSION = "v1";

export interface InferenceConfig {
  version: string;
  /** Round observed e1RM to this step (lbs) so trivial fluctuations don't churn versions. */
  round_lbs: number;
  /** Distinct logged sessions for the observed estimate to earn each confidence tier. */
  confidence_sessions: { high: number; medium: number };
  /** Observed within this fraction of the prior value counts as corroboration. */
  corroborate_floor: number; // e.g. 0.95 → observed ≥ 95% of self-reported confirms it
}

export const INFERENCE_CONFIG_V1: InferenceConfig = {
  version: INFERENCE_VERSION,
  round_lbs: 5,
  confidence_sessions: { high: 4, medium: 2 },
  corroborate_floor: 0.95,
};

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function maxConfidence(a: Confidence, b: Confidence): Confidence {
  return CONF_RANK[a] >= CONF_RANK[b] ? a : b;
}

function observedConfidence(sessions: number, cfg: InferenceConfig): Confidence {
  if (sessions >= cfg.confidence_sessions.high) return "high";
  if (sessions >= cfg.confidence_sessions.medium) return "medium";
  return "low";
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export type RevisionAction = "raised" | "corroborated" | "unchanged" | "adopted";

export interface CapabilityRevision {
  lift: string;
  action: RevisionAction;
  from: number | null;
  to: number | null;
  /** Evidence behind a change, for the inspector / reason codes. */
  evidence?: { best_est_1rm: number; sessions: number; best_set: TrainingSummary["lifts"][string]["best_set"] };
}

export interface BeliefRevisionResult {
  capabilities: Record<string, Capability>;
  revisions: CapabilityRevision[];
}

/**
 * Revise the prior capability beliefs given the training summary. Pure +
 * deterministic. Returns the revised capabilities (same keyspace as prior) plus
 * a per-lift revision log. Never downgrades a value; absence is neutral.
 */
export function reviseCapabilities(
  prior: Record<string, Capability>,
  summary: TrainingSummary | null,
  cfg: InferenceConfig = INFERENCE_CONFIG_V1,
): BeliefRevisionResult {
  const capabilities: Record<string, Capability> = {};
  const revisions: CapabilityRevision[] = [];

  for (const [lift, cap] of Object.entries(prior)) {
    const ev = summary?.lifts?.[lift];
    if (!ev) {
      capabilities[lift] = cap; // no evidence → unchanged (no-penalty)
      continue;
    }
    const obs = roundTo(ev.best_est_1rm, cfg.round_lbs);
    const obsConf = observedConfidence(ev.sessions, cfg);
    const evidence = { best_est_1rm: ev.best_est_1rm, sessions: ev.sessions, best_set: ev.best_set };

    if (cap.value == null) {
      // No self-reported value → adopt the observed estimate.
      capabilities[lift] = { value: obs, source: "observed", confidence: obsConf, as_of: ev.last_performed };
      revisions.push({ lift, action: "adopted", from: null, to: obs, evidence });
    } else if (obs > cap.value) {
      // Athlete demonstrated MORE than claimed → raise the belief.
      capabilities[lift] = { value: obs, source: "observed", confidence: obsConf, as_of: ev.last_performed };
      revisions.push({ lift, action: "raised", from: cap.value, to: obs, evidence });
    } else if (obs >= cap.value * cfg.corroborate_floor) {
      // Demonstrated at/near the claimed value → corroborate: hold value, raise confidence.
      capabilities[lift] = {
        value: cap.value,
        source: "observed",
        confidence: maxConfidence(cap.confidence, obsConf),
        as_of: ev.last_performed,
      };
      revisions.push({ lift, action: "corroborated", from: cap.value, to: cap.value, evidence });
    } else {
      // Observed well below claimed → likely volume/accessory work, not a max.
      // No-penalty: hold the prior belief entirely.
      capabilities[lift] = cap;
      revisions.push({ lift, action: "unchanged", from: cap.value, to: cap.value, evidence });
    }
  }

  return { capabilities, revisions };
}
