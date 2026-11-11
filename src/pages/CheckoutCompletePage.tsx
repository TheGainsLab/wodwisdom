import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import { getAcquisition } from '../lib/acquisition';
import { markWelcomeSeen } from '../lib/welcome';
import GainsLogo from '../components/GainsLogo';
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget';

/**
 * /checkout/complete — where Stripe sends the buyer back.
 *
 * Founder decisions 2026-11-11:
 *  - A buyer who paid on the website must not then "create an account" and
 *    confirm an email. Stripe just billed the address. The page exchanges
 *    the session id for a signed-in account (checkout-claim-account: finds
 *    or creates the account, attaches the purchase, mints a one-time token),
 *    asks for a PASSWORD right away, and goes to the intake for the plan.
 *  - Every plan lands on its own intake (PLAN_LANDING), and a paid account
 *    never sees the welcome screen — the intake is the welcome.
 *  - A signed-in buyer (upgrade from the welcome screen or anywhere in the
 *    app) is already an account: entitlements refresh, then the intake.
 *  - Free signups are untouched: they keep the confirmation email.
 *
 * The legacy signup form remains only as the fallback when the claim call
 * fails for a reason other than "already claimed".
 */

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const SESSION_INFO_ENDPOINT = SUPABASE_BASE + '/functions/v1/checkout-session-info';
const CLAIM_ENDPOINT = SUPABASE_BASE + '/functions/v1/checkout-claim-account';

/** Where a buyer lands after paying — the intake for the plan they bought. */
const PLAN_LANDING: Record<string, string> = {
  programming: '/profile',   // evaluation required to generate a program
  all_access: '/profile',    // Programming leads; the goal set there carries to Engine
  engine: '/engine',         // the Engine setup is its intake
  ai_research: '/knowledge',
  coach: '/chat',
  nutrition: '/nutrition',
  coach_nutrition: '/chat',
};
const landingFor = (plan: string | null | undefined) => (plan && PLAN_LANDING[plan]) || '/';

/** First-stop line per landing, for the screens that name it. */
const FIRST_STOP: Record<string, string> = {
  '/profile': 'your profile and free evaluation — your program is built from it',
  '/engine': 'Engine setup — pick your days, set a goal, start with a time trial',
  '/knowledge': 'the research library — ask it anything',
  '/chat': 'your AI Coach — ask your first question',
  '/nutrition': 'nutrition — log your first meal',
};

/** Survives the remount that signing in causes (the app swaps route trees):
 *  "this session still owes a password step". */
const PASSWORD_PENDING_KEY = (sessionId: string) => `checkout-password-pending:${sessionId}`;

const planLabel: Record<string, string> = {
  coach: 'AI Coach',
  nutrition: 'AI Nutrition',
  coach_nutrition: 'AI Coach + AI Nutrition',
  engine: 'AI Year of the Engine',
  programming: 'AI Programming',
  all_access: 'All Access',
  ai_research: 'AI Research',
};

type Stage =
  | 'loading'
  | 'upgraded'        // signed-in buyer: entitlements refreshed, redirecting
  | 'set_password'    // claimed + signed in: one field, then the intake
  | 'sign_in'         // session already claimed and we are signed out
  | 'fallback_form'   // claim failed for another reason: legacy signup
  | 'signup_success'; // legacy form submitted: check email

function Check() {
  return (
    <div style={{ width: 64, height: 64, background: 'rgba(46,196,134,0.2)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px auto' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </div>
  );
}

export default function CheckoutCompletePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { refresh } = useEntitlements();

  const [stage, setStage] = useState<Stage>('loading');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('');
  const [claimError, setClaimError] = useState('');

  // Password step (claimed path) / legacy form
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const landing = landingFor(plan);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

      // A session that owes a password step (we just signed it in below and
      // the app remounted this page in the signed-in tree).
      if (session && sessionId) {
        let pending = '';
        try { pending = sessionStorage.getItem(PASSWORD_PENDING_KEY(sessionId)) ?? ''; } catch { /* ignore */ }
        if (pending) {
          if (!cancelled) { setPlan(pending); setEmail(session.user.email ?? ''); setStage('set_password'); }
          return;
        }
      }

      if (session) {
        // Signed-in buyer (upgrade). The entitlement was granted server-side
        // after the provider's last read, so pull it before leaving.
        await refresh();
        let dest = '/';
        try {
          if (sessionId) {
            const resp = await fetch(SESSION_INFO_ENDPOINT, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId }),
            });
            const data = await resp.json();
            if (data.plan) setPlan(data.plan);
            dest = landingFor(data.plan);
          }
        } catch { /* fall back to home */ }
        await markWelcomeSeen(session.user.id);
        if (!cancelled) setStage('upgraded');
        setTimeout(() => navigate(dest, { replace: true }), 2500);
        return;
      }

      if (!sessionId) { if (!cancelled) setStage('fallback_form'); return; }

      // Signed-out buyer: exchange the paid session for a signed-in account.
      try {
        const resp = await fetch(CLAIM_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await resp.json();
        if (data.email) setEmail(data.email);
        if (data.plan) setPlan(data.plan);
        if (resp.status === 409) { if (!cancelled) setStage('sign_in'); return; }
        if (!resp.ok || !data.token_hash) throw new Error(data.error || 'Could not claim this purchase');

        try { sessionStorage.setItem(PASSWORD_PENDING_KEY(sessionId), data.plan || 'unknown'); } catch { /* ignore */ }
        const { data: signed, error } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
        if (error || !signed.session) {
          try { sessionStorage.removeItem(PASSWORD_PENDING_KEY(sessionId)); } catch { /* ignore */ }
          throw new Error(error?.message || 'Sign-in failed');
        }
        // The app now swaps to the signed-in tree and remounts this page,
        // which reads the pending flag and shows the password step.
        if (!cancelled) setStage('set_password');
      } catch (err) {
        if (!cancelled) {
          setClaimError(err instanceof Error ? err.message : String(err));
          setStage('fallback_form');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, navigate, refresh]);

  const finishPassword = async () => {
    setFormError('');
    if (!password) { setFormError('Password is required'); return; }
    if (password.length < 6) { setFormError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setFormError('Passwords do not match'); return; }
    setBusy(true);
    try {
      const { data: { user }, error } = await supabase.auth.updateUser({
        password,
        ...(fullName.trim() ? { data: { full_name: fullName.trim() } } : {}),
      });
      if (error) throw error;
      if (sessionId) { try { sessionStorage.removeItem(PASSWORD_PENDING_KEY(sessionId)); } catch { /* ignore */ } }
      await refresh();
      if (user) await markWelcomeSeen(user.id);
      navigate(landing, { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not set your password');
      setBusy(false);
    }
  };

  const skipPassword = async () => {
    // They own the account either way. Without a password, "Forgot password"
    // on the sign-in page is the way back in (it emails a reset link).
    if (sessionId) { try { sessionStorage.removeItem(PASSWORD_PENDING_KEY(sessionId)); } catch { /* ignore */ } }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await markWelcomeSeen(user.id);
    navigate(landing, { replace: true });
  };

  // Legacy fallback: the old signup form (confirmation email), only when the
  // claim failed for a reason other than "already claimed".
  const handleSignup = async () => {
    setFormError('');
    if (!email) { setFormError('Email is required'); return; }
    if (!password) { setFormError('Password is required'); return; }
    if (password.length < 6) { setFormError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setFormError('Passwords do not match'); return; }
    if (TURNSTILE_ENABLED && !captchaToken) { setFormError('Please complete the verification below.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName, acquisition: getAcquisition() }, captchaToken },
      });
      if (error) throw error;
      setStage('signup_success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setBusy(false);
      setCaptchaToken('');
      setCaptchaResetKey(k => k + 1);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <GainsLogo className="landing-hero-logo" />
        <Check />
        {children}
      </div>
    </div>
  );

  if (stage === 'loading') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div className="loading-pulse" />
      </div>
    );
  }

  if (stage === 'upgraded') {
    return shell(
      <>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>You&rsquo;re upgraded!</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 24 }}>
          {planLabel[plan] ? `${planLabel[plan]} is active.` : 'Your subscription is active.'}
          {FIRST_STOP[landing] ? ` First stop: ${FIRST_STOP[landing]}.` : ''}
        </p>
        <button className="auth-btn" onClick={() => navigate(landing, { replace: true })} style={{ maxWidth: 220, margin: '0 auto' }}>Continue</button>
      </>,
    );
  }

  if (stage === 'set_password') {
    return shell(
      <>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>You&rsquo;re in</h1>
        {plan && <p style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{planLabel[plan] || plan}</p>}
        <p style={{ color: 'var(--text-dim)', fontSize: 15, marginBottom: 20 }}>
          Your account is ready{email ? ` for ${email}` : ''}. Set a password so you can sign in next time.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
          <div className="field">
            <label>Your name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password" autoFocus />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" />
          </div>
          {formError && <div className="auth-error" style={{ display: 'block' }}>{formError}</div>}
          <button className="auth-btn" onClick={finishPassword} disabled={busy} style={{ marginTop: 4 }}>
            {busy ? 'Saving…' : `Save and continue →`}
          </button>
          <button type="button" onClick={skipPassword} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
            Set it later (use &ldquo;Forgot password&rdquo; on the sign-in page to get back in)
          </button>
        </div>
      </>,
    );
  }

  if (stage === 'sign_in') {
    return shell(
      <>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Welcome back</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, marginBottom: 20 }}>
          {planLabel[plan] ? `${planLabel[plan]} is active on ` : 'Your subscription is active on '}
          {email ? <strong style={{ color: 'var(--text)' }}>{email}</strong> : 'your account'}. Sign in to continue.
        </p>
        <button className="auth-btn" onClick={() => navigate(`/auth?next=${encodeURIComponent(landing)}`, { replace: true })} style={{ maxWidth: 220, margin: '0 auto' }}>Sign in →</button>
      </>,
    );
  }

  if (stage === 'signup_success') {
    return shell(
      <>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Account created!</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 8 }}>Check your email to confirm your account.</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Your {planLabel[plan] || ''} subscription is already active and waiting for you.</p>
        {FIRST_STOP[landing] && (
          <p style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 8 }}>First stop once you&rsquo;re in: {FIRST_STOP[landing]}.</p>
        )}
      </>,
    );
  }

  // fallback_form
  return shell(
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Payment successful!</h1>
      {plan && <p style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{planLabel[plan] || plan}</p>}
      <p style={{ color: 'var(--text-dim)', fontSize: 15, marginBottom: 20 }}>Create your account to get started.</p>
      {claimError && <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginBottom: 12 }}>Automatic sign-in didn&rsquo;t work ({claimError}), so here is the manual way.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
        <div className="field">
          <label>Full Name</label>
          <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" disabled={!!email} style={email ? { opacity: 0.7 } : {}} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a password" />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" />
        </div>
        {formError && <div className="auth-error" style={{ display: 'block' }}>{formError}</div>}
        <TurnstileWidget onToken={setCaptchaToken} onExpire={() => setCaptchaToken('')} resetKey={captchaResetKey} />
        <button className="auth-btn" onClick={handleSignup} disabled={busy} style={{ marginTop: 4 }}>
          {busy ? 'Creating account...' : 'Create Account'}
        </button>
      </div>
    </>,
  );
}
