import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { getTierStatus } from '../utils/tier-status';
import { X } from 'lucide-react';

const DISMISS_KEY = 'profile-banner-dismissed';

interface Props {
  userId: string;
}

/**
 * Banner shown at the top of ChatPage prompting incomplete-profile users
 * to fill out their profile. Hides when ANY of:
 *   - User has any active entitlement (paid for any feature)
 *   - User has T2 complete AND has at least one profile_evaluations row
 *   - User has dismissed the banner (localStorage)
 *
 * Auth state on the banner: no — even non-paying users benefit from the
 * free Tier 2 evaluation, so the banner is shown to anyone with an
 * incomplete profile regardless of subscription.
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
      // 1. Dismissed?
      if (typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === 'true') {
        if (!cancelled) { setShouldShow(false); setChecking(false); }
        return;
      }

      // 2. Has any active entitlement?
      const hasAnyPaid = isAdmin
        || hasFeature('ai_chat')
        || hasFeature('programming')
        || hasFeature('engine')
        || hasFeature('nutrition');
      if (hasAnyPaid) {
        if (!cancelled) { setShouldShow(false); setChecking(false); }
        return;
      }

      // 3. T2 complete AND has at least one evaluation?
      const [profileRes, evalRes] = await Promise.all([
        supabase
          .from('athlete_profiles')
          .select('lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender')
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, 'true');
    }
    setShouldShow(false);
  };

  if (checking || !shouldShow) return null;

  return (
    <div
      style={{
        background: 'var(--accent)',
        color: 'white',
        padding: '12px 20px',
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
        Complete your profile for personalized answers and a free evaluation
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
