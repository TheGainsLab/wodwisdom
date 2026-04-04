import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import GainsLogo from '../components/GainsLogo';

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const SESSION_INFO_ENDPOINT = SUPABASE_BASE + '/functions/v1/checkout-session-info';

export default function CheckoutCompletePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Signup form
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      // Check if already logged in
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setIsLoggedIn(true);
        setLoading(false);
        // Logged-in user upgrading — redirect after a moment
        setTimeout(() => navigate('/', { replace: true }), 3000);
        return;
      }

      // Not logged in — fetch email from Stripe session
      if (!sessionId) {
        setLoading(false);
        return;
      }

      try {
        const resp = await fetch(SESSION_INFO_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await resp.json();
        if (data.email) setEmail(data.email);
        if (data.plan) setPlan(data.plan);
      } catch {
        // If fetch fails, user can still type their email
      }
      setLoading(false);
    })();
  }, [sessionId, navigate]);

  const handleSignup = async () => {
    setSignupError('');
    if (!email) { setSignupError('Email is required'); return; }
    if (!password) { setSignupError('Password is required'); return; }
    if (password.length < 6) { setSignupError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setSignupError('Passwords do not match'); return; }

    setSignupLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      setSignupSuccess(true);
    } catch (err: any) {
      setSignupError(err.message || 'Failed to create account');
    } finally {
      setSignupLoading(false);
    }
  };

  const planLabel: Record<string, string> = {
    coach: 'AI Coach',
    nutrition: 'AI Nutrition',
    coach_nutrition: 'AI Coach + AI Nutrition',
    engine: 'AI Year of the Engine',
    programming: 'AI Programming',
    all_access: 'All Access',
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div className="loading-pulse" />
      </div>
    );
  }

  // Logged-in user — show upgrade success
  if (isLoggedIn) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 40, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, background: 'rgba(46,196,134,0.2)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>You're upgraded!</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 24 }}>Your subscription is active. Redirecting you to the app...</p>
        <button className="auth-btn" onClick={() => navigate('/', { replace: true })} style={{ maxWidth: 200 }}>Go to App</button>
      </div>
    );
  }

  // Signup success — check email
  if (signupSuccess) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 40, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, background: 'rgba(46,196,134,0.2)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Account created!</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 8 }}>Check your email to confirm your account.</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Your {planLabel[plan] || ''} subscription is already active and waiting for you.</p>
      </div>
    );
  }

  // Not logged in — show account creation form
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <GainsLogo className="landing-hero-logo" />
          <div style={{ width: 64, height: 64, background: 'rgba(46,196,134,0.2)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '24px auto' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2ec486" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Payment successful!</h1>
          {plan && <p style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{planLabel[plan] || plan}</p>}
          <p style={{ color: 'var(--text-dim)', fontSize: 15 }}>Create your account to get started.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

          {signupError && <div className="auth-error" style={{ display: 'block' }}>{signupError}</div>}

          <button className="auth-btn" onClick={handleSignup} disabled={signupLoading} style={{ marginTop: 4 }}>
            {signupLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
