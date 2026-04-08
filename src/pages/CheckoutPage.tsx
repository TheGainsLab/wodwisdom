import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useEntitlements } from '../hooks/useEntitlements';
import Nav from '../components/Nav';
import { CheckCircle } from 'lucide-react';

type PlanKey = 'coach' | 'nutrition' | 'coach_nutrition' | 'programming' | 'engine' | 'all_access';
type Interval = 'monthly' | 'quarterly';
type Stage = 'browse' | 'confirm' | 'success';

/** Features granted by each plan */
const PLAN_FEATURES: Record<PlanKey, string[]> = {
  coach: ['ai_chat'],
  nutrition: ['nutrition'],
  coach_nutrition: ['ai_chat', 'nutrition'],
  programming: ['programming', 'ai_chat', 'nutrition'],
  engine: ['engine', 'ai_chat', 'nutrition'],
  all_access: ['ai_chat', 'programming', 'engine', 'nutrition'],
};

const PLAN_NAMES: Record<PlanKey, string> = {
  coach: 'AI Coach',
  nutrition: 'AI Nutrition',
  coach_nutrition: 'AI Coach + AI Nutrition',
  programming: 'AI Programming',
  engine: 'Year of the Engine',
  all_access: 'All Access',
};

/** Where to send users after upgrading, based on the new features they gained */
const FEATURE_NEXT_STEPS: { feature: string; label: string; path: string; description: string }[] = [
  { feature: 'programming', label: 'Set Up AI Programming', path: '/programs', description: 'Build your athlete profile and generate your first personalized program' },
  { feature: 'engine', label: 'Go to Engine Dashboard', path: '/engine', description: 'Start your conditioning program with personalized pacing targets' },
  { feature: 'nutrition', label: 'Start Nutrition Tracking', path: '/nutrition', description: 'Log your first meal with food search, barcode scanning, or photo recognition' },
  { feature: 'ai_chat', label: 'Talk to Your AI Coach', path: '/chat', description: 'Ask your first coaching question — training, recovery, programming, anything' },
];

const PLANS: { key: PlanKey; name: string; monthly: string; quarterly: string; features: string[]; badge?: string; featured?: boolean }[] = [
  {
    key: 'coach',
    name: 'AI Coach',
    monthly: '$7.99',
    quarterly: '$17.99',
    features: ['Unlimited coaching questions', 'Full source library', 'Bookmarks & summaries', 'Workout reviews'],
  },
  {
    key: 'nutrition',
    name: 'AI Nutrition',
    monthly: '$7.99',
    quarterly: '$17.99',
    features: ['Photo-based meal logging', 'Barcode scanner', 'Millions of foods & restaurant menus', 'Meal templates & favorites'],
  },
  {
    key: 'coach_nutrition',
    name: 'AI Coach + AI Nutrition',
    monthly: '$11.99',
    quarterly: '$29.99',
    features: ['Everything in AI Coach', 'Everything in AI Nutrition', 'Save vs buying separately'],
  },
  {
    key: 'programming',
    name: 'AI Programming',
    monthly: '$29.99',
    quarterly: '$74.99',
    badge: 'Includes AI Coach & Nutrition',
    features: ['Personalized program generation', 'AI profile evaluation', 'Program analysis & modifications', 'Session-by-session coaching cues'],
  },
  {
    key: 'engine',
    name: 'Year of the Engine',
    monthly: '$29.99',
    quarterly: '$74.99',
    badge: 'Includes AI Coach & Nutrition',
    features: ['20 distinct training frameworks', 'Machine-learning calibrated targets', 'Real-time pacing coach', 'Conditioning analytics & heatmaps'],
  },
  {
    key: 'all_access',
    name: 'All Access',
    monthly: '$49.99',
    quarterly: '$119.99',
    badge: 'Best value',
    featured: true,
    features: ['Everything in AI Coach', 'AI Programming', 'Year of the Engine', 'All future features included'],
  },
];

interface PreviewData {
  current_plan: string;
  new_plan: string;
  interval: string;
  credit: string;
  new_charge: string;
  discount: string;
  total_due: string;
}

interface CheckoutPageProps { session: Session; }

export default function CheckoutPage({ session }: CheckoutPageProps) {
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [interval, setInterval] = useState<Interval>('monthly');
  const [stage, setStage] = useState<Stage>('browse');
  const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradedPlan, setUpgradedPlan] = useState<PlanKey | null>(null);
  const navigate = useNavigate();
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  const userFeatures = ['ai_chat', 'programming', 'engine', 'nutrition'].filter(f => hasFeature(f));
  const hasSubscription = !entLoading && !isAdmin && userFeatures.length > 0;

  const isUpgrade = (planKey: PlanKey): boolean => {
    return PLAN_FEATURES[planKey].some(f => !hasFeature(f));
  };

  const alreadyHas = (planKey: PlanKey): boolean => {
    return PLAN_FEATURES[planKey].every(f => hasFeature(f));
  };

  /** New features the user would gain from this plan */
  const newFeatures = (planKey: PlanKey): string[] => {
    return PLAN_FEATURES[planKey].filter(f => !hasFeature(f));
  };

  const featureLabels: Record<string, string> = { ai_chat: 'AI Coach', nutrition: 'Nutrition', programming: 'AI Programming', engine: 'Engine' };

  // Stage 1: User clicks a plan → fetch preview for existing subscribers
  const selectPlan = async (p: PlanKey) => {
    setError('');
    if (!hasSubscription) {
      // New subscriber: go straight to Stripe checkout
      setLoading(p);
      try {
        const { data, error } = await supabase.functions.invoke('create-checkout', {
          body: { plan: p, interval },
        });
        if (error) throw new Error(error.message || 'Failed to create checkout');
        if (data?.error) throw new Error(data.error || 'Failed to create checkout');
        if (data?.url) { window.location.href = data.url; return; }
        throw new Error('No checkout URL returned');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setLoading(null);
      }
      return;
    }

    // Existing subscriber: fetch proration preview
    setSelectedPlan(p);
    setPreviewLoading(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke('preview-upgrade', {
        body: { plan: p, interval },
      });
      if (error) throw new Error(error.message || 'Failed to preview upgrade');
      if (data?.error) throw new Error(data.error || 'Failed to preview upgrade');
      setPreview(data);
      setStage('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Stage 2: User confirms → execute the upgrade
  const confirmUpgrade = async () => {
    if (!selectedPlan) return;
    setError('');
    setUpgrading(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-subscription', {
        body: { plan: selectedPlan, interval },
      });
      if (error) throw new Error(error.message || 'Failed to update subscription');
      if (data?.error) throw new Error(data.error || 'Failed to update subscription');
      setUpgradedPlan(selectedPlan);
      setStage('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setUpgrading(false);
    }
  };

  const visiblePlans = hasSubscription
    ? PLANS.filter(p => isUpgrade(p.key))
    : PLANS;

  // Determine next steps based on newly gained features
  const nextSteps = upgradedPlan
    ? FEATURE_NEXT_STEPS.filter(s => newFeatures(upgradedPlan).includes(s.feature))
    : [];

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>{stage === 'success' ? 'Upgrade Complete' : hasSubscription ? 'Upgrade Your Plan' : 'Upgrade'}</h1>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 0' }}>

            {/* ── STAGE 3: SUCCESS ── */}
            {stage === 'success' && upgradedPlan && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'rgba(46, 196, 134, 0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px',
                }}>
                  <CheckCircle size={36} style={{ color: '#2ec486' }} />
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
                  You're now on {PLAN_NAMES[upgradedPlan]}!
                </h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 32 }}>
                  Your upgrade is active and your billing has been updated.
                </p>

                {nextSteps.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 16 }}>
                      Get Started
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                      {nextSteps.map(step => (
                        <button
                          key={step.feature}
                          className="auth-btn"
                          onClick={() => navigate(step.path)}
                          style={{ width: '100%', textAlign: 'left', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}
                        >
                          <span style={{ fontWeight: 700 }}>{step.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.8 }}>{step.description}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <button
                  className="auth-btn"
                  onClick={() => navigate('/')}
                  style={{ width: '100%', background: 'var(--surface2)', color: 'var(--text)' }}
                >
                  Back to Home
                </button>
              </div>
            )}

            {/* ── STAGE 2: CONFIRM UPGRADE ── */}
            {stage === 'confirm' && preview && selectedPlan && (
              <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Confirm Your Upgrade</h2>

                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 24, marginBottom: 24, textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>Current plan</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{preview.current_plan}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>New plan</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{preview.new_plan}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>Billing</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{preview.interval === 'quarterly' ? 'Quarterly' : 'Monthly'}</span>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

                  {parseFloat(preview.credit) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>Credit for unused time</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#2ec486' }}>-${preview.credit}</span>
                    </div>
                  )}
                  {parseFloat(preview.new_charge) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{preview.new_plan} ({preview.interval})</span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>${preview.new_charge}</span>
                    </div>
                  )}
                  {parseFloat(preview.discount) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>Discount</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#2ec486' }}>-${preview.discount}</span>
                    </div>
                  )}

                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>Due today</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>${preview.total_due}</span>
                  </div>
                </div>

                <button
                  className="auth-btn"
                  onClick={confirmUpgrade}
                  disabled={upgrading}
                  style={{ width: '100%', marginBottom: 12 }}
                >
                  {upgrading ? 'Upgrading...' : `Confirm Upgrade — $${preview.total_due}`}
                </button>

                <button
                  className="auth-btn"
                  onClick={() => { setStage('browse'); setSelectedPlan(null); setPreview(null); setError(''); }}
                  style={{ width: '100%', background: 'var(--surface2)', color: 'var(--text)' }}
                >
                  Go Back
                </button>

                {error && <div className="auth-error" style={{ display: 'block', marginTop: 16 }}>{error}</div>}
              </div>
            )}

            {/* ── STAGE 1: BROWSE PLANS ── */}
            {stage === 'browse' && (
              <div className="checkout-plans">
                {hasSubscription ? (
                  <>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Upgrade your subscription</h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 4 }}>
                      You currently have: <strong style={{ color: 'var(--text)' }}>{userFeatures.map(f => featureLabels[f] || f).join(', ')}</strong>
                    </p>
                    <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>
                      Select a plan below. You'll see a detailed cost breakdown before confirming.
                    </p>
                  </>
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

                {visiblePlans.map(plan => {
                  const owned = alreadyHas(plan.key);
                  const isPreviewing = previewLoading && selectedPlan === plan.key;
                  return (
                    <div
                      key={plan.key}
                      className={'checkout-plan-card' + (plan.featured ? ' featured' : '')}
                      onClick={() => !loading && !previewLoading && !owned && selectPlan(plan.key)}
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
                        disabled={!!loading || previewLoading || owned}
                        style={{ marginTop: 16 }}
                        onClick={(e) => { e.stopPropagation(); if (!loading && !previewLoading && !owned) selectPlan(plan.key); }}
                      >
                        {owned ? 'Current Plan'
                          : isPreviewing ? 'Loading...'
                          : loading === plan.key ? 'Redirecting...'
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
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
