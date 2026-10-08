import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { getTierStatus } from '../utils/tier-status';
import { X } from 'lucide-react';

// v2 (2026-10-08): timestamped dismissal that expires after 7 days — the
// old boolean key silenced onboarding permanently on one idle tap. The
// legacy key is deliberately ignored (previously-dismissed users see the
// banner once more; they're the least-oriented group we have).
const DISMISS_KEY = 'profile-banner-dismissed-v2';
const DISMISS_TTL_MS = 7 * 24 * 3600_000;

interface Props {
  userId: string;
}

/**
 * Banner shown at the top of ChatPage prompting users without an
 * evaluation to go get one. Hides when ANY of:
 *   - User has T2 complete AND has at least one profile_evaluations row
 *   - User dismissed it within the last 7 days
 *
 * 2026-10-08: the old "hide for any paying user" rule is gone — it assumed
 * paying meant oriented, and the paid-but-never-started churn cohort
 * disproved that. The eval is step one of EVERY journey; paid users just
 * get sharper copy.
 */
export default function ProfileBanner({ userId }: Props) {
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(userId);
  const [shouldShow, setShouldShow] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (entLoading) return;

    let cancelled = false;

    const decide = async () => {
      // 1. Dismissed within the TTL? (Admins are exempt from the banner.)
      try {
        const ts = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (ts && Date.now() - ts < DISMISS_TTL_MS) {
          if (!cancelled) { setShouldShow(false); setChecking(false); }
          return;
        }
      } catch { /* storage unavailable — show per the data checks below */ }
      if (isAdmin) {
        if (!cancelled) { setShouldShow(false); setChecking(false); }
        return;
      }

      // 3. T2 complete AND has at least one evaluation?
      const [profileRes, evalRes] = await Promise.all([
        supabase
          .from('athlete_profiles')
          .select('lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, athletic_reviewed_at')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('profile_evaluations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
      ]);
      if (cancelled) return;
      const tier = getTierStatus(profileRes.data);
      const hasEvaluation = (evalRes.count ?? 0) > 0;
      if (tier.tier2.complete && hasEvaluation) {
        setShouldShow(false);
      } else {
        setShouldShow(true);
      }
      setChecking(false);
    };

    decide();
    return () => { cancelled = true; };
  }, [userId, entLoading, hasFeature, isAdmin]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShouldShow(false);
  };

  const isPaid = hasFeature('ai_chat') || hasFeature('programming') || hasFeature('engine') || hasFeature('nutrition');

  if (checking || !shouldShow) return null;

  return (
    <div
      className="profile-banner"
      style={{
        background: 'var(--accent)',
        color: 'white',
        // Topmost element on the page: in the installed PWA the app draws under
        // the phone's status bar (viewport-fit=cover), so start the content
        // below it. In a browser tab the inset is 0 and this collapses to 12px.
        padding: 'calc(12px + env(safe-area-inset-top, 0px)) 20px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontFamily: "'Outfit', sans-serif",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      <button
        onClick={() => navigate('/profile')}
        style={{
          flex: 1,
          background: 'none',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
          padding: 0,
        }}
      >
        {isPaid
          ? 'Your subscription starts with your evaluation — 5 minutes of your numbers and the AI gets to work'
          : 'Complete your profile for personalized answers and a free evaluation'}
        <span style={{ marginLeft: 8, textDecoration: 'underline', fontWeight: 600 }}>
          Set up profile →
        </span>
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: 4,
          opacity: 0.85,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
