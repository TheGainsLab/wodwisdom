import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthPage() {
  const params = new URLSearchParams(window.location.search);
  const inviteEmail = params.get('invite') || '';
  const [isSignUp, setIsSignUp] = useState(!!inviteEmail);
  const [email, setEmail] = useState(inviteEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Enter email and password'); return; }
    if (isSignUp && password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (isSignUp && password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); setError('');
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        // If this is an invite sign-up, accept the invite immediately
        if (inviteEmail && data.user) {
          const userId = data.user.id;
          const normalized = inviteEmail.toLowerCase();
          await supabase.from('gym_members').update({ user_id: userId, status: 'active' }).eq('invited_email', normalized).eq('status', 'invited');
          await supabase.from('profiles').update({ role: 'coach', subscription_status: 'active' }).eq('id', userId);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">W</div>
        <h1>{inviteEmail ? 'Welcome to WOD Wisdom' : isSignUp ? 'Create Account' : 'Sign In'}</h1>
        <p className="auth-subtitle">{inviteEmail ? 'Enter your name and a password to create your account' : isSignUp ? 'Start your coaching knowledge journey' : 'Access your coaching knowledge base'}</p>
        {inviteEmail && <div className="invite-email-badge">{inviteEmail}</div>}
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          {isSignUp && <div className="field"><label>Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>}
          {!inviteEmail && <div className="field"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>}
          <div className="field"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={isSignUp ? 'Choose a password (min 6 chars)' : 'Your password'} /></div>
          {isSignUp && <div className="field"><label>Confirm Password</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" /></div>}
          <button className="auth-btn" type="submit" disabled={loading}>{loading ? (isSignUp ? 'Creating...' : 'Signing in...') : inviteEmail ? 'Create Account & Accept Invite' : (isSignUp ? 'Create Account' : 'Sign In')}</button>
        </form>
        {!inviteEmail && <div className="auth-toggle">
          <span>{isSignUp ? 'Have an account? ' : 'No account? '}</span>
          <a onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>{isSignUp ? 'Sign in' : 'Sign up'}</a>
        </div>}
      </div>
    </div>
  );
}
