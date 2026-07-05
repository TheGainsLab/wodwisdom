import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * The retail SHELL features (Decision 10): holding ANY of these means the member bought
 * (or was plan-granted) into the retail product line, so they keep the full retail shell —
 * cross-sell tiles, All-Access CTA and all. Every Stripe plan expands into a subset of
 * these four (stripe-webhook PLAN_ENTITLEMENTS), so plan-derived grants are covered.
 */
export const RETAIL_SHELL_FEATURES = ['engine', 'programming', 'nutrition', 'ai_chat'] as const;

/**
 * Decision 10(a): "same Engine, different shell." A member is in the GYM shell when their
 * only shell-relevant feature is the gym-granted `gym_engine` seat. Any retail feature —
 * or admin — wins the full retail shell (feature-set union; retail wins).
 * Pure so Nav (which does its own entitlement fetch) derives it from the same logic.
 */
export function deriveIsGymShell(features: ReadonlySet<string>, isAdmin: boolean): boolean {
  return (
    !isAdmin &&
    features.has('gym_engine') &&
    !RETAIL_SHELL_FEATURES.some((f) => features.has(f))
  );
}

interface Entitlements {
  /** Check if the user has access to a specific feature */
  hasFeature: (feature: string) => boolean;
  /** Decision 10(a): access to the ENGINE surfaces — retail `engine` OR the gym
   *  `gym_engine` seat (or admin). Use this at Engine gates, never a bare
   *  hasFeature('engine'). */
  hasEngineAccess: boolean;
  /** Decision 10(c): true when the member gets the gym-variant shell (Engine only,
   *  gym-branded, zero retail cross-sell). */
  isGymShell: boolean;
  /** True if user is an admin (bypasses all feature checks) */
  isAdmin: boolean;
  /** True while loading entitlements */
  loading: boolean;
}

export function useEntitlements(userId: string | undefined): Entitlements {
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    (async () => {
      // Fetch role and entitlements in parallel
      const [profileRes, entitlementRes] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', userId).single(),
        supabase.from('user_entitlements')
          .select('feature')
          .eq('user_id', userId)
          .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString()),
      ]);

      const admin = profileRes.data?.role === 'admin';
      setIsAdmin(admin);

      const featureSet = new Set<string>();
      if (entitlementRes.data) {
        for (const row of entitlementRes.data) {
          featureSet.add(row.feature);
        }
      }
      setFeatures(featureSet);
      setLoading(false);
    })();
  }, [userId]);

  const hasFeature = (feature: string): boolean => {
    if (isAdmin) return true;
    return features.has(feature);
  };

  const hasEngineAccess = isAdmin || features.has('engine') || features.has('gym_engine');
  const isGymShell = deriveIsGymShell(features, isAdmin);

  return { hasFeature, hasEngineAccess, isGymShell, isAdmin, loading };
}
