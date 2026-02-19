import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { CREATE_CHECKOUT_ENDPOINT } from '../lib/supabase';
import Nav from '../components/Nav';

const stripePromise = (() => {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  return key ? loadStripe(key) : null;
})();

interface CheckoutPageProps { session: Session; }

export default function CheckoutPage({ session }: CheckoutPageProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [plan, setPlan] = useState<'athlete' | 'gym' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const selectPlan = async (p: 'athlete' | 'gym') => {
    if (!stripePromise) {
      setError('Stripe is not configured');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const resp = await fetch(CREATE_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: p }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to create checkout');
      setClientSecret(data.client_secret);
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const planName = plan === 'gym' ? 'Gym' : 'Coach';
  const planPrice = plan === 'gym' ? '$24.99' : '$7.99';

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Upgrade</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 0' }}>
            {!clientSecret ? (
              <div className="checkout-plans">
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Choose your plan</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24 }}>Get unlimited access to the full coaching knowledge base.</p>

                <div className="checkout-plan-card" onClick={() => !loading && selectPlan('athlete')}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700 }}>Coach</h3>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>$7.99<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>/mo</span></div>
                    <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.8 }}>
                      <li>Unlimited questions</li>
                      <li>Full source library</li>
                      <li>Bookmarks & summaries</li>
                      <li>Workout reviews</li>
                    </ul>
                  </div>
                  <button className="auth-btn" disabled={loading} style={{ marginTop: 16 }}>Subscribe</button>
                </div>

                <div className="checkout-plan-card featured" onClick={() => !loading && selectPlan('gym')}>
                  <div className="checkout-plan-badge">Best for teams</div>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700 }}>Gym</h3>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>$24.99<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>/mo</span></div>
                    <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.8 }}>
                      <li>Everything in Coach</li>
                      <li>Up to 3 coach seats</li>
                      <li>Gym dashboard</li>
                      <li>Invite & manage coaches</li>
                    </ul>
                  </div>
                  <button className="auth-btn" disabled={loading} style={{ marginTop: 16 }}>Subscribe</button>
                </div>

                {error && <div className="auth-error" style={{ display: 'block', marginTop: 16 }}>{error}</div>}
              </div>
            ) : stripePromise ? (
              <div className="checkout-embedded">
                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>Subscribing to </span>
                  <strong>{planName}</strong>
                  <span style={{ fontSize: 14, color: 'var(--text-dim)' }}> — {planPrice}/mo</span>
                </div>
                <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
                <button
                  className="auth-btn"
                  onClick={() => { setClientSecret(null); setPlan(null); }}
                  style={{ marginTop: 20, background: 'var(--surface2)', color: 'var(--text)' }}
                >
                  Choose a different plan
                </button>
              </div>
            ) : (
              <div className="auth-error" style={{ display: 'block' }}>Stripe is not configured. Add VITE_STRIPE_PUBLISHABLE_KEY to your environment.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
