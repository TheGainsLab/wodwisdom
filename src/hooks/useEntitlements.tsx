import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// The gym shell (`gym_engine` + deriveIsGymShell) was retired in the Decision 12a
// Phase C sweep: gym members live on their gym's member app (affiliate-side) and
// never hold a wodwisdom account. This PWA serves retail only.

export interface Entitlements {
  /**
   * Feature access as the UI should gate on it — admins bypass every check.
   * For "does this user literally hold this entitlement", use hasEntitlement.
   */
  hasFeature: (feature: string) => boolean;
  /**
   * Raw entitlement presence, with NO admin bypass. Nav uses this so an admin
   * without the `engine` entitlement keeps seeing the nav it saw before.
   */
  hasEntitlement: (feature: string) => boolean;
  /** Access to the ENGINE surfaces — the retail `engine` feature (or admin). */
  hasEngineAccess: boolean;
  /** True if user is an admin (bypasses all feature checks) */
  isAdmin: boolean;
  /** True only during the first load of a session. Revalidations never set it. */
  loading: boolean;
  /**
   * Force an immediate refetch and resolve once state reflects the server.
   * Await this anywhere entitlements change as a direct result of user action
   * (checkout being the one that matters) — the background revalidation below
   * is too slow to beat a redirect.
   */
  refresh: () => Promise<void>;
}

/**
 * Background revalidations closer together than this are collapsed, so tapping
 * through five pages costs one refetch rather than five. Short enough that an
 * admin grant or an expiry lands within a navigation or two.
 */
const REVALIDATE_TTL_MS = 45_000;

function sameFeatures(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

interface CtxValue extends Entitlements {
  /** The user these entitlements belong to — used only for the dev-mode guard. */
  ownerId: string | undefined;
}

const EntitlementsContext = createContext<CtxValue | null>(null);

/**
 * Session-wide entitlement state, stale-while-revalidate.
 *
 * Why SWR rather than fetch-once: entitlements change out from under the client
 * (admin grants, trial expiry, checkout). A fetch-once cache turns every one of
 * those into a session-length staleness bug that you fix by hunting down
 * invalidation call-sites forever. Revalidating on navigation makes freshness a
 * policy instead of a maintenance list.
 *
 * Why not keep fetching inline per page: Nav is mounted by each page rather than
 * above the router, so every route change remounted it and refired its fetch —
 * that plus each page's own useEntitlements call meant ~5 blocking round-trips
 * before anything rendered. Cached reads render instantly; the refetch that
 * keeps them honest now happens off the critical path.
 */
export function EntitlementsProvider(
  { userId, children }: { userId: string | undefined; children: ReactNode },
) {
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const lastFetchedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!userId) {
      setFeatures(prev => (prev.size === 0 ? prev : new Set()));
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    const [profileRes, entitlementRes] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', userId).single(),
      supabase.from('user_entitlements')
        .select('feature')
        .eq('user_id', userId)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString()),
    ]);

    const admin = profileRes.data?.role === 'admin';
    const next = new Set<string>();
    for (const row of entitlementRes.data ?? []) next.add(row.feature);

    // Compare by value, not reference: `new Set() !== new Set()` always, so
    // assigning unconditionally would re-render Nav and every gated page on
    // each navigation and flicker the UI for no reason.
    setIsAdmin(prev => (prev === admin ? prev : admin));
    setFeatures(prev => (sameFeatures(prev, next) ? prev : next));
    setLoading(false);
    lastFetchedAt.current = Date.now();
  }, [userId]);

  const run = useCallback((force: boolean): Promise<void> => {
    if (force) {
      // Never piggyback a forced refresh on an in-flight background revalidate:
      // that request may have been issued before the entitlement was granted,
      // which is exactly the checkout case this exists for.
      const p = (inFlight.current ?? Promise.resolve())
        .then(load)
        .finally(() => { if (inFlight.current === p) inFlight.current = null; });
      inFlight.current = p;
      return p;
    }
    if (inFlight.current) return inFlight.current;
    if (Date.now() - lastFetchedAt.current < REVALIDATE_TTL_MS) return Promise.resolve();
    const p = load()
      .finally(() => { if (inFlight.current === p) inFlight.current = null; });
    inFlight.current = p;
    return p;
  }, [load]);

  // Session change — the one blocking load. `loading` gates the gated UI so a
  // page can't flash unlocked content before we know what the user holds.
  useEffect(() => {
    lastFetchedAt.current = 0;
    setLoading(true);
    void run(true);
  }, [run]);

  // Stale-while-revalidate. Runs on mount too, but the forced load above has
  // already set inFlight by then, so mount costs one request rather than two.
  useEffect(() => {
    void run(false);
  }, [location.pathname, run]);

  const hasEntitlement = useCallback(
    (feature: string) => features.has(feature),
    [features],
  );
  const hasFeature = useCallback(
    (feature: string) => isAdmin || features.has(feature),
    [isAdmin, features],
  );
  const refresh = useCallback(() => run(true), [run]);

  const value = useMemo<CtxValue>(() => ({
    hasFeature,
    hasEntitlement,
    hasEngineAccess: isAdmin || features.has('engine'),
    isAdmin,
    loading,
    refresh,
    ownerId: userId,
  }), [hasFeature, hasEntitlement, isAdmin, features, loading, refresh, userId]);

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}

/**
 * Read the session's entitlements.
 *
 * `userId` is accepted only for backwards compatibility with the ~19 call sites
 * that pass `session.user.id`, and is ignored: entitlements are session-scoped.
 * Passing anyone else's id would silently return the signed-in user's access,
 * so that mistake warns loudly in dev.
 */
export function useEntitlements(userId?: string): Entitlements {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error('useEntitlements must be used inside <EntitlementsProvider>');
  if (import.meta.env.DEV && userId && ctx.ownerId && userId !== ctx.ownerId) {
    console.warn(
      `[useEntitlements] called with ${userId} but entitlements are session-scoped ` +
      `to ${ctx.ownerId}. This returns the signed-in user's access, not that user's.`,
    );
  }
  return ctx;
}
