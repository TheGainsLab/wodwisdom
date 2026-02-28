import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Entitlements {
  /** Check if the user has access to a specific feature */
  hasFeature: (feature: string) => boolean;
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

  return { hasFeature, isAdmin, loading };
}
