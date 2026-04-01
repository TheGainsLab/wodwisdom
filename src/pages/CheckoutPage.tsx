import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';

type PlanKey = 'coach' | 'nutrition' | 'coach_nutrition' | 'programming' | 'engine' | 'all_access';

const PLANS: { key: PlanKey; name: string; price: string; features: string[]; badge?: string; featured?: boolean }[] = [
  {
    key: 'coach',
    name: 'AI Coach',
    price: '$7.99',
    features: [
      'Unlimited coaching questions',
      'Full source library',
      'Bookmarks & summaries',
      'Workout reviews',
    ],
  },
  {
    key: 'nutrition',
    name: 'AI Nutrition',
    price: '$7.99',
    features: [
      'Photo-based meal logging',
      'Barcode scanner',
      'Millions of foods & restaurant menus',
      'Meal templates & favorites',
    ],
  },
  {
    key: 'coach_nutrition',
    name: 'AI Coach + AI Nutrition',
    price: '$11.99',
    features: [
      'Everything in AI Coach',
      'Everything in AI Nutrition',
      'Save vs buying separately',
    ],
  },
  {
    key: 'programming',
    name: 'AI Programming',
    price: '$29.99',
    badge: 'Includes AI Coach & Nutrition',
    features: [
      'Personalized program generation',
      'AI profile evaluation',
      'Program analysis & modifications',
      'Session-by-session coaching cues',
    ],
  },
  {
    key: 'engine',
    name: 'Year of the Engine',
    price: '$29.99',
    badge: 'Includes AI Coach & Nutrition',
    features: [
      '20 distinct training frameworks',
      'Machine-learning calibrated targets',
      'Real-time pacing coach',
      'Conditioning analytics & heatmaps',
    ],
  },
  {
    key: 'all_access',
    name: 'All Access',
    price: '$49.99',
    badge: 'Best value',
    featured: true,
    features: [
      'Everything in AI Coach',
      'AI Programming',
      'Year of the Engine',
      'All future features included',
    ],
  },
];

interface CheckoutPageProps { session: Session; }

export default function CheckoutPage({ session: _session }: CheckoutPageProps) {
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);

  const selectPlan = async (p: PlanKey) => {
    setError('');
    setLoading(p);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { plan: p },
      });
      if (error) throw new Error(error.message || 'Failed to create checkout');
      if (data?.error) throw new Error(data.error || 'Failed to create checkout');
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('No checkout URL returned');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  };

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
            <div className="checkout-plans">
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Choose your plan</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24 }}>All plans include a free trial. You'll complete payment on Stripe's secure page.</p>

              {PLANS.map(plan => (
                <div
                  key={plan.key}
                  className={'checkout-plan-card' + (plan.featured ? ' featured' : '')}
                  onClick={() => !loading && selectPlan(plan.key)}
                >
                  {plan.badge && <div className="checkout-plan-badge">{plan.badge}</div>}
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700 }}>{plan.name}</h3>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>
                      {plan.price}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>/mo</span>
                    </div>
                    <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.8 }}>
                      {plan.features.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                  <button
                    type="button"
                    className="auth-btn"
                    disabled={!!loading}
                    style={{ marginTop: 16 }}
                    onClick={(e) => { e.stopPropagation(); if (!loading) selectPlan(plan.key); }}
                  >
                    {loading === plan.key ? 'Redirecting...' : 'Subscribe'}
                  </button>
                </div>
              ))}

              {error && <div className="auth-error" style={{ display: 'block', marginTop: 16 }}>{error}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
