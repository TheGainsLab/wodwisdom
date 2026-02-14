import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Enter email and password'); return; }
    setLoading(true); setError('');
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
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
        <h1>{isSignUp ? 'Create Account' : 'Sign In'}</h1>
        <p className="auth-subtitle">{isSignUp ? 'Start your coaching knowledge journey' : 'Access your coaching knowledge base'}</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          {isSignUp && <div className="field"><label>Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></div>}
          <div className="field"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>
          <div className="field"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" /></div>
          <button className="auth-btn" type="submit" disabled={loading}>{loading ? (isSignUp ? 'Creating...' : 'Signing in...') : (isSignUp ? 'Create Account' : 'Sign In')}</button>
        </form>
        <div className="auth-toggle">
          <span>{isSignUp ? 'Have an account? ' : 'No account? '}</span>
          <a onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>{isSignUp ? 'Sign in' : 'Sign up'}</a>
        </div>
      </div>
    </div>
  );
}
