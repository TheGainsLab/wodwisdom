import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Identity model Phase 2 — the member claims a gym seat token at /claim/:token
// (affiliate-intelligence docs/IDENTITY_PHASE_2_DESIGN §5/§6).
//
// Not signed in? Send them to the ONE auth surface (AuthPage) with ?next= back here,
// so they get the shared signup/login (a DURABLE member-owned credential — the §5.5
// requirement that keeps revocation from orphaning). Signing in with an existing
// account never touches a retail subscription; the gym seat is an additive grant.
//
// The token in the URL is a bearer credential: single-use, 30-day TTL, HTTPS-only. We
// capture it into state and strip it from the address bar/history on mount so it can't
// linger or leak via referrer; the client never logs it.

// Consent copy — v1, versioned (the server records the version; bump both together).
// Two service-contextual variants. "will be able to see" (not "can see"): nothing
// consumes consent until the member feed ships (IDENTITY_MODEL §6).
// (Exported so the doc-constant survives noUnusedLocals — nothing imports it yet.)
export const CONSENT_COPY_VERSION = 'gymclaim-v1-2026-07-11';
function serviceLabel(feature: string): string {
  if (feature === 'nutrition') return 'Nutrition';
  return 'Engine';
}
function consentCopy(feature: string, gymName: string): { heading: string; body: string } {
  const gym = gymName || 'your gym';
  if (feature === 'nutrition') {
    return {
      heading: 'Share your nutrition data with your gym?',
      body: `If you say yes, coaches at ${gym} will be able to see your food logs and daily nutrition to help coach you. Your injury and health details are never included unless you separately choose to share them. You can change this anytime in Settings, and your answer doesn't affect your access.`,
    };
  }
  return {
    heading: 'Share your training data with your gym?',
    body: `If you say yes, coaches at ${gym} will be able to see your workout results and progress to help coach you. Your injury and health details are never included unless you separately choose to share them. You can change this anytime in Settings, and your answer doesn't affect your access.`,
  };
}

export default function ClaimSeatPage({ session }: { session: Session | null }) {
  const { token } = useParams<{ token: string }>();
  if (!token) return <Shell><p>Invalid claim link.</p></Shell>;
  if (!session) {
    return <Navigate to={`/auth?next=${encodeURIComponent(`/claim/${token}`)}`} replace />;
  }
  return <Shell><ClaimFlow initialToken={token} /></Shell>;
}

// Deliberately UNBRANDED: a gym member must never see the service provider's brand
// (IDENTITY_MODEL North Star §2). The content leads with the GYM's name (the peek's
// gym_name → "<Gym> is giving you <Service>"); this shell is a neutral container only.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '2rem 1.25rem', minHeight: '100vh' }}>
      {children}
    </div>
  );
}

type Peek = { feature: string; gym_name: string | null; status: string; claimable: boolean; already_claimed_by_me: boolean };

function ClaimFlow({ initialToken }: { initialToken: string }) {
  // Capture the token, then strip it from the URL/history (bearer-credential hygiene).
  const [token] = useState(initialToken);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ feature: string; consent: 'granted' | 'declined' } | null>(null);

  useEffect(() => {
    try { window.history.replaceState({}, '', '/claim'); } catch { /* non-fatal */ }
    (async () => {
      const { data, error } = await supabase.functions.invoke('gym-seat-claim', { body: { token, peek: true } });
      if (error) { setLoadError('This claim link is no longer valid. Ask your gym to resend it.'); return; }
      setPeek(data as Peek);
    })();
  }, [token]);

  async function claim(consentAccepted: boolean) {
    setBusy(true); setError(null);
    // The server OWNS the recorded consent version (no client-pinned version → no
    // cache-skew on a copy swap); CONSENT_COPY_VERSION here just documents which copy
    // this page shows — keep it in sync with the server constant when the copy changes.
    const { data, error } = await supabase.functions.invoke('gym-seat-claim', {
      body: { token, consent_accepted: consentAccepted },
    });
    setBusy(false);
    if (error) { setError(error.message || 'Something went wrong. Please try again.'); return; }
    setDone({ feature: (data.feature as string) ?? peek?.feature ?? '', consent: data.consent });
  }

  if (loadError) return <Info title="Link not valid">{loadError}</Info>;
  if (!peek) return <p style={{ opacity: 0.7 }}>Loading…</p>;

  if (done) {
    const svc = serviceLabel(done.feature);
    return (
      <Info title={`${svc} is active 🎉`}>
        Your {svc} access is on{done.consent === 'granted' ? ' and you’re sharing your data with your gym' : ''}.
        {' '}It shows up here in your app. You can change data sharing anytime in Settings.
      </Info>
    );
  }

  if (peek.already_claimed_by_me) {
    const svc = serviceLabel(peek.feature);
    return <Info title="You're all set">Your {svc} access is already active. You can change data sharing anytime in Settings.</Info>;
  }

  if (!peek.claimable) {
    const msg = peek.status === 'expired'
      ? 'This claim link has expired. Ask your gym to resend it.'
      : peek.status === 'claimed'
        ? 'This link has already been used.'
        : 'This link is no longer available. Ask your gym to resend it.';
    return <Info title="Link not available">{msg}</Info>;
  }

  // Claimable — show what's being given, capture consent, activate (either button
  // activates; they differ only in data-sharing — orthogonal, never a gate, §6).
  const svc = serviceLabel(peek.feature);
  const gym = peek.gym_name || 'Your gym';
  const copy = consentCopy(peek.feature, peek.gym_name ?? '');
  return (
    <div style={formStyle}>
      <div>
        <h1 style={{ fontSize: 24, margin: 0 }}>{gym} is giving you {svc}</h1>
        <p style={{ opacity: 0.75, marginTop: 6 }}>Activate it below.</p>
      </div>
      <div style={consentBox}>
        <h3 style={{ marginTop: 0 }}>{copy.heading}</h3>
        <p style={{ whiteSpace: 'pre-line' }}>{copy.body}</p>
      </div>
      {error && <div style={errorStyle}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={primaryBtn} disabled={busy} onClick={() => claim(true)}>
          {busy ? 'Activating…' : 'Yes, share'}
        </button>
        <button style={secondaryBtn} disabled={busy} onClick={() => claim(false)}>
          Not now
        </button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.6, textAlign: 'center', margin: 0 }}>
        Either way, your {svc} access turns on.
      </p>
    </div>
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 style={{ fontSize: 22, margin: '0 0 0.5rem' }}>{title}</h1>
      <p style={{ opacity: 0.8 }}>{children}</p>
    </div>
  );
}

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '1.25rem' };
const primaryBtn: React.CSSProperties = { padding: '0.8rem', borderRadius: 8, border: 'none', background: '#1a5fa0', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '0.8rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.2)', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 15, cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#a11', fontSize: 13 };
const consentBox: React.CSSProperties = { border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '1rem', background: 'rgba(0,0,0,0.02)' };
