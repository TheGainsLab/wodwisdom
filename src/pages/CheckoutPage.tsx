import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';

type PlanKey = 'coach' | 'nutrition' | 'coach_nutrition' | 'programming' | 'engine' | 'all_access';
type Interval = 'monthly' | 'quarterly';

/** Features granted by each plan */
const PLAN_FEATURES: Record<PlanKey, string[]> = {
  coach: ['ai_chat'],
  nutrition: ['nutrition'],
  coach_nutrition: ['ai_chat', 'nutrition'],
  programming: ['programming', 'ai_chat', 'nutrition'],
  engine: ['engine', 'ai_chat', 'nutrition'],
  all_access: ['ai_chat', 'programming', 'engine', 'nutrition'],
};

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
  const [portalLoading, setPortalLoading] = useState(false);
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  // Determine current subscription state
  const userFeatures = ['ai_chat', 'programming', 'engine', 'nutrition'].filter(f => hasFeature(f));
  const hasSubscription = !entLoading && !isAdmin && userFeatures.length > 0;

  /** Check if a plan would be an upgrade (grants at least one new feature) */
  const isUpgrade = (planKey: PlanKey): boolean => {
    const planFeats = PLAN_FEATURES[planKey];
    return planFeats.some(f => !hasFeature(f));
  };

  /** Check if user already has all features this plan offers */
  const alreadyHas = (planKey: PlanKey): boolean => {
    const planFeats = PLAN_FEATURES[planKey];
    return planFeats.every(f => hasFeature(f));
  };

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} });
      if (error || data?.error) {
        setError('Failed to open billing portal. Please try again.');
        return;
      }
      if (data?.url) { window.location.href = data.url; return; }
    } finally {
      setPortalLoading(false);
    }
  };

  const selectPlan = async (p: PlanKey) => {
    // Existing subscribers go to Stripe portal to upgrade
    if (hasSubscription) {
      await openBillingPortal();
      return;
    }

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

  // Filter plans for existing subscribers: only show upgrades
  const visiblePlans = hasSubscription
    ? PLANS.filter(p => isUpgrade(p.key))
    : PLANS;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{hasSubscription ? 'Upgrade Your Plan' : 'Upgrade'}</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 0' }}>
            <div className="checkout-plans">
              {hasSubscription ? (
                <>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Upgrade your subscription</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 4 }}>
                    You currently have: <strong style={{ color: 'var(--text)' }}>{userFeatures.map(f => {
                      const labels: Record<string, string> = { ai_chat: 'AI Coach', nutrition: 'Nutrition', programming: 'AI Programming', engine: 'Engine' };
                      return labels[f] || f;
                    }).join(', ')}</strong>
                  </p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>
                    Select a plan below to upgrade. Stripe will prorate your billing automatically.
                  </p>
                </>
              ) : (
                <>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Choose your plan</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>All plans include a free trial. You'll complete payment on Stripe's secure page.</p>
                </>
              )}

              {/* Monthly / Quarterly toggle */}
              {!hasSubscription && (
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
              )}

              {visiblePlans.map(plan => {
                const owned = alreadyHas(plan.key);
                return (
                  <div
                    key={plan.key}
                    className={'checkout-plan-card' + (plan.featured ? ' featured' : '')}
                    onClick={() => !loading && !portalLoading && !owned && selectPlan(plan.key)}
                    style={owned ? { opacity: 0.5, cursor: 'default' } : undefined}
                  >
                    {plan.badge && <div className="checkout-plan-badge">{plan.badge}</div>}
                    {hasSubscription && !owned && (
                      <div className="checkout-plan-badge" style={{ background: 'var(--accent)', color: 'white' }}>Upgrade</div>
                    )}
                    <div>
                      <h3 style={{ fontSize: 18, fontWeight: 700 }}>{plan.name}</h3>
                      <div style={{ fontSize: 24, fontWeight: 800, color: owned ? 'var(--text-dim)' : 'var(--accent)' }}>
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
                      disabled={!!loading || portalLoading || owned}
                      style={{ marginTop: 16 }}
                      onClick={(e) => { e.stopPropagation(); if (!loading && !portalLoading && !owned) selectPlan(plan.key); }}
                    >
                      {owned ? 'Current Plan'
                        : (loading === plan.key || portalLoading) ? 'Redirecting...'
                        : hasSubscription ? 'Upgrade'
                        : 'Subscribe'}
                    </button>
                  </div>
                );
              })}

              {hasSubscription && visiblePlans.length === 0 && (
                <div className="settings-card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-glow)', textAlign: 'center' }}>
                  <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>You have All Access!</p>
                  <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16 }}>You already have access to every feature.</p>
                  <button className="auth-btn" onClick={() => navigate('/settings')}>Go to Settings</button>
                </div>
              )}

              {error && <div className="auth-error" style={{ display: 'block', marginTop: 16 }}>{error}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
