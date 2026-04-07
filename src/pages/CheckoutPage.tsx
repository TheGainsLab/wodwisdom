import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';

type PlanKey = 'coach' | 'nutrition' | 'coach_nutrition' | 'programming' | 'engine' | 'all_access';
type Interval = 'monthly' | 'quarterly';

const PLANS: { key: PlanKey; name: string; monthly: string; quarterly: string; features: string[]; badge?: string; featured?: boolean }[] = [
  {
    key: 'coach',
    name: 'AI Coach',
    monthly: '$7.99',
    quarterly: '$17.99',
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
    monthly: '$7.99',
    quarterly: '$17.99',
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
    monthly: '$11.99',
    quarterly: '$29.99',
    features: [
      'Everything in AI Coach',
      'Everything in AI Nutrition',
      'Save vs buying separately',
    ],
  },
  {
    key: 'programming',
    name: 'AI Programming',
    monthly: '$29.99',
    quarterly: '$74.99',
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
    monthly: '$29.99',
    quarterly: '$74.99',
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
    monthly: '$49.99',
    quarterly: '$119.99',
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

export default function CheckoutPage({ session }: CheckoutPageProps) {
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [interval, setInterval] = useState<Interval>('monthly');
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);
  const hasSubscription = !entLoading && (isAdmin || hasFeature('ai_chat') || hasFeature('engine') || hasFeature('programming') || hasFeature('nutrition'));

  const selectPlan = async (p: PlanKey) => {
    setError('');
    setLoading(p);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { plan: p, interval },
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
              {hasSubscription ? (
                <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)', marginBottom: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>You already have an active subscription</h2>
                  <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>To upgrade, downgrade, or change your plan, use Manage subscription in Settings.</p>
                  <button className="auth-btn" onClick={() => navigate('/settings')}>Go to Settings</button>
                </div>
              ) : (
                <>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Choose your plan</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>All plans include a free trial. You'll complete payment on Stripe's secure page.</p>
                </>
              )}

              {/* Monthly / Quarterly toggle */}
              <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
                <button
                  style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'monthly' ? 'var(--accent)' : 'transparent', color: interval === 'monthly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                  onClick={() => setInterval('monthly')}
                >
                  Monthly
                </button>
                <button
                  style={{ flex: 1, padding: '10px 0', border: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 14, fontWeight: 600, cursor: 'pointer', background: interval === 'quarterly' ? 'var(--accent)' : 'transparent', color: interval === 'quarterly' ? 'white' : 'var(--text-dim)', transition: 'all .15s' }}
                  onClick={() => setInterval('quarterly')}
                >
                  Quarterly
                </button>
              </div>

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
                      {interval === 'monthly' ? plan.monthly : plan.quarterly}
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>
                        {interval === 'monthly' ? '/mo' : '/qtr'}
                      </span>
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
