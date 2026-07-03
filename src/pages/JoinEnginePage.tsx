import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// F3 — member-join bridge (wodwisdom side). Reached via the gym's invite link/QR
// at /join/engine/:token. The invite token stays in the URL throughout, so
// signing in mid-flow returns to this same page (App re-renders authenticated).
//
// Linking an existing account is exactly this flow — signing in with existing
// credentials never touches the member's retail subscription; the gym seat is a
// separate, additive grant that only lands when the owner activates the seat.

const CONSENT_VERSION = 'v1-legal-tbd-2026-07'; // must match engine-join's version

export default function JoinEnginePage({ session }: { session: Session | null }) {
  const { token } = useParams<{ token: string }>();
  if (!token) return <Shell><p>Invalid invite link.</p></Shell>;
  if (!session) return <Shell><AuthGate /></Shell>;
  return <Shell><JoinFlow token={token} /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '2rem 1.25rem', minHeight: '100vh' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }}>
          The Gains Lab · Engine Class
        </div>
        <h1 style={{ fontSize: 24, margin: '0.3rem 0 0' }}>Join your gym's Engine Class</h1>
      </div>
      {children}
    </div>
  );
}

// ── Not signed in: compact sign-in / sign-up. On success the session updates and
//    the page re-renders into the join flow — the token in the URL is preserved.
function AuthGate() {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const fn = mode === 'signup'
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password });
    const { data, error } = await fn;
    setBusy(false);
    if (error) { setError(error.message); return; }
    // If email confirmation is on, signUp returns no session — tell them to confirm.
    if (mode === 'signup' && !data.session) setCheckEmail(true);
    // On success with a session, App re-renders into the join flow automatically.
  }

  if (checkEmail) {
    return <p>Check your email to confirm your account, then reopen this invite link to finish joining.</p>;
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <p style={{ margin: 0, opacity: 0.75 }}>
        {mode === 'signup' ? 'Create your free account to join.' : 'Sign in to join.'}
      </p>
      <label style={labelStyle}>
        Email
        <input style={inputStyle} type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label style={labelStyle}>
        Password
        <input style={inputStyle} type="password" required minLength={8}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div style={errorStyle}>{error}</div>}
      <button style={primaryBtn} type="submit" disabled={busy}>
        {busy ? 'Working…' : mode === 'signup' ? 'Create account & continue' : 'Sign in & continue'}
      </button>
      <button type="button" style={linkBtn} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}>
        {mode === 'signup' ? 'I already have an account' : 'Create a new account'}
      </button>
    </form>
  );
}

// ── Signed in: consent → light intake → submit.
function JoinFlow({ token }: { token: string }) {
  const [step, setStep] = useState<'consent' | 'intake' | 'done'>('consent');
  const [agreed, setAgreed] = useState(false);
  const [gender, setGender] = useState('');
  const [bodyweight, setBodyweight] = useState('');
  const [units, setUnits] = useState<'lbs' | 'kg'>('lbs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ gym_name: string; class_name: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const intake: Record<string, unknown> = { units };
    if (gender) intake.gender = gender;
    const bw = parseFloat(bodyweight);
    if (!isNaN(bw) && bw > 0) intake.bodyweight = bw;

    const { data, error } = await supabase.functions.invoke('engine-join', {
      body: { invite_token: token, consent: { version: CONSENT_VERSION, accepted: true }, intake },
    });
    setBusy(false);
    if (error) { setError(error.message || 'Something went wrong. Please try again.'); return; }
    setResult({ gym_name: data.gym_name, class_name: data.class_name });
    setStep('done');
  }

  if (step === 'done' && result) {
    return (
      <div>
        <h2 style={{ fontSize: 20 }}>You're on the roster 🎉</h2>
        <p>You've joined <strong>{result.gym_name}</strong>'s {result.class_name}.</p>
        <p style={{ opacity: 0.75 }}>
          Your coach will activate your access. Once they do, the class workout shows
          up here in your app and you can start logging.
        </p>
      </div>
    );
  }

  if (step === 'consent') {
    return (
      <div style={formStyle}>
        {/* LEGAL-TBD: final member data-consent copy comes from the founding-partner
            legal pass. CONSENT_VERSION pins whatever text was accepted. */}
        <div style={consentBox}>
          <h3 style={{ marginTop: 0 }}>Member data consent</h3>
          <p style={{ opacity: 0.7, fontSize: 13 }}><em>Placeholder copy — final legal text pending.</em></p>
          <p>
            To deliver the Engine Class we process your logged performance to
            personalize your scaling and power your gym's leaderboard, and use it in
            de-identified aggregate to improve the service. Your account and history
            stay yours — if you leave the gym you keep them.
          </p>
        </div>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read and agree to the member data consent above.
        </label>
        {error && <div style={errorStyle}>{error}</div>}
        <button style={primaryBtn} disabled={!agreed} onClick={() => setStep('intake')}>Continue</button>
      </div>
    );
  }

  // intake
  return (
    <form onSubmit={submit} style={formStyle}>
      <p style={{ margin: 0, opacity: 0.75 }}>A couple of numbers so your scaling is personal to you.</p>
      <label style={labelStyle}>
        Sex (for fair leaderboard divisions)
        <select style={inputStyle} value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Prefer not to say</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </label>
      <label style={labelStyle}>
        Bodyweight
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} type="number" inputMode="decimal" min="0"
            value={bodyweight} onChange={(e) => setBodyweight(e.target.value)} />
          <select style={inputStyle} value={units} onChange={(e) => setUnits(e.target.value as 'lbs' | 'kg')}>
            <option value="lbs">lbs</option>
            <option value="kg">kg</option>
          </select>
        </div>
      </label>
      {error && <div style={errorStyle}>{error}</div>}
      <button style={primaryBtn} type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join the class'}</button>
    </form>
  );
}

// ── minimal inline styles (this is a standalone entry surface, not the app shell)
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '1rem' };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, opacity: 0.85 };
const inputStyle: React.CSSProperties = { padding: '0.6rem 0.7rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 15, fontFamily: 'inherit' };
const primaryBtn: React.CSSProperties = { padding: '0.75rem', borderRadius: 8, border: 'none', background: '#1a5fa0', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#1a5fa0', fontSize: 13, cursor: 'pointer', padding: 0 };
const errorStyle: React.CSSProperties = { color: '#a11', fontSize: 13 };
const consentBox: React.CSSProperties = { border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: '1rem', maxHeight: 260, overflowY: 'auto', background: 'rgba(0,0,0,0.02)' };
