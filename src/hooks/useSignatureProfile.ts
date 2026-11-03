/**
 * useSignatureProfile — data layer for the signature profile panel.
 *
 * Reads the fitted profile from storage (athlete_signature_profiles +
 * athlete_capability_vectors + athlete_gate_possession — all RLS
 * select-own, so the client reads its own rows directly; no endpoint).
 * `refresh()` calls the signature-profile-refit function (with Open
 * ingestion) and re-reads. `sendConcordance()` writes the athlete's
 * reaction onto their latest fit-log row (column-level grant allows
 * exactly those fields).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase, getAuthHeaders, SIGNATURE_PROFILE_REFIT_ENDPOINT } from '../lib/supabase';
import type { FittedProfileView } from '../lib/signatureProfile';

export interface SignatureProfileState {
  profile: FittedProfileView | null; // null = no fit persisted yet (zero-state)
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  sendConcordance: (verdict: 'match' | 'partial' | 'miss', note?: string) => Promise<boolean>;
  concordanceSent: boolean;
}

interface VectorRow {
  axis: string;
  mean_pct: number;
  sd_pct: number;
}

interface HeaderRow {
  level_mean: number;
  level_sd: number;
  limiter: Array<{ axis: string; p: number }>;
  n_evidence: number;
  model_params_key: string;
  fitted_at: string;
}

export function useSignatureProfile(userId: string | undefined): SignatureProfileState {
  const [profile, setProfile] = useState<FittedProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concordanceSent, setConcordanceSent] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: header }, { data: vectors }, { data: gates }] = await Promise.all([
      supabase
        .from('athlete_signature_profiles')
        .select('level_mean, level_sd, limiter, n_evidence, model_params_key, fitted_at')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('athlete_capability_vectors')
        .select('axis, mean_pct, sd_pct')
        .eq('user_id', userId),
      supabase
        .from('athlete_gate_possession')
        .select('movement, status')
        .eq('user_id', userId),
    ]);
    if (!header || !vectors || vectors.length === 0) {
      setProfile(null);
      return;
    }
    const h = header as HeaderRow;
    const axes: FittedProfileView['axes'] = {};
    for (const v of vectors as VectorRow[]) {
      axes[v.axis] = { mean: Number(v.mean_pct), sd: Number(v.sd_pct) };
    }
    const limiterPosterior: Record<string, number> = {};
    for (const l of h.limiter ?? []) limiterPosterior[l.axis] = l.p;
    const gateMap: Record<string, 'has' | 'lacks' | 'unknown'> = {};
    for (const g of (gates ?? []) as Array<{ movement: string; status: 'has' | 'lacks' | 'unknown' }>) {
      gateMap[g.movement] = g.status;
    }
    setProfile({
      level: { mean: Number(h.level_mean), sd: Number(h.level_sd) },
      axes,
      limiterPosterior,
      nEvidence: h.n_evidence,
      cohort: 'open_rx_general',
      gates: Object.keys(gateMap).length > 0 ? gateMap : undefined,
    });
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load profile');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(SIGNATURE_PROFILE_REFIT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ingest_open: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Refit failed (${res.status})`);
      }
      await load();
      setConcordanceSent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const sendConcordance = useCallback(
    async (verdict: 'match' | 'partial' | 'miss', note?: string): Promise<boolean> => {
      if (!userId) return false;
      // attach to the latest fit-log row (the fit the athlete is reacting to)
      const { data: latest } = await supabase
        .from('signature_fit_log')
        .select('id')
        .eq('user_id', userId)
        .order('fitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latest) return false;
      const { error: upErr } = await supabase
        .from('signature_fit_log')
        .update({
          concordance: verdict,
          concordance_note: note?.slice(0, 500) ?? null,
          concordance_at: new Date().toISOString(),
        })
        .eq('id', (latest as { id: string }).id);
      if (!upErr) setConcordanceSent(true);
      return !upErr;
    },
    [userId],
  );

  return { profile, loading, refreshing, error, refresh, sendConcordance, concordanceSent };
}
