import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Calendar, Dumbbell, Clock, BarChart3, Timer, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  hasFeature?: (feature: string) => boolean;
}

const PROGRAM_GROUPS = [
  {
    category: 'Year of the Engine',
    description: 'The complete structured conditioning program',
    programs: [
      { name: 'Year of the Engine', detail: '5 days/week', duration: '720 days · 36 months' },
      { name: 'Year of the Engine (3-Day)', detail: '3 days/week', duration: '432 days · 36 months' },
    ],
  },
  {
    category: 'Varied Order',
    description: 'Shuffled sequence for returning athletes',
    programs: [
      { name: 'Engine: Varied Order', detail: '5 days/week', duration: '720 days' },
      { name: 'Engine: Varied Order (3-Day)', detail: '3 days/week', duration: '432 days' },
    ],
  },
  {
    category: 'VO2 Max',
    description: '12-month focus on max aerobic power',
    programs: [
      { name: 'VO2 Max (3-Day)', detail: '3 days/week', duration: '144 days · 12 months' },
      { name: 'VO2 Max (4-Day)', detail: '4 days/week', duration: '192 days · 12 months' },
    ],
  },
  {
    category: 'Hyrox Race Prep',
    description: 'Competition-specific conditioning',
    programs: [
      { name: 'Hyrox Race Prep (3-Day)', detail: '3 days/week', duration: '144 days · 12 months' },
      { name: 'Hyrox Race Prep (5-Day)', detail: '5 days/week', duration: '240 days · 12 months' },
    ],
  },
];

const FEATURES = [
  { icon: TrendingUp, text: 'Personalized pace targets from time trial baselines' },
  { icon: Timer, text: 'Built-in interval timer with work/rest tracking' },
  { icon: Calendar, text: 'Progressive month-by-month unlock system' },
  { icon: BarChart3, text: 'Performance analytics and trend tracking' },
  { icon: Dumbbell, text: '20+ workout frameworks across all energy systems' },
  { icon: Clock, text: 'Workouts scaled to your current fitness level' },
];

/**
 * Shown when a user visits Engine pages without an active or trial subscription.
 * Displays program details, features, and upgrade CTAs.
 * Context-aware: if user has another subscription, offers upgrade to All Access via Stripe portal.
 */
export default function EnginePaywall({ hasFeature }: Props) {
  const navigate = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);

  // Determine if user has an existing subscription (but not engine)
  const hasOtherSub = hasFeature
    ? hasFeature('ai_chat') || hasFeature('programming') || hasFeature('nutrition')
    : false;

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} });
      if (error || data?.error) { navigate('/checkout'); return; }
      if (data?.url) { window.location.href = data.url; return; }
      navigate('/checkout');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleUpgrade = hasOtherSub ? openBillingPortal : () => navigate('/checkout');
  const ctaLabel = hasOtherSub ? 'Upgrade to All Access' : 'Upgrade to Access Engine';
  const ctaLoading = portalLoading;

  const ctaButton = (
    <button
      className="engine-btn engine-btn-primary"
      onClick={handleUpgrade}
      disabled={ctaLoading}
      style={{ width: '100%' }}
    >
      <Zap size={18} /> {ctaLoading ? 'Opening...' : ctaLabel}
    </button>
  );

  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div className="engine-section" style={{ alignItems: 'center' }}>
          {/* Hero */}
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--accent-glow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
          }}>
            <Zap size={28} />
          </div>

          <h2 className="engine-header">Year of the Engine</h2>
          <p className="engine-subheader" style={{ maxWidth: 360 }}>
            The world's most comprehensive conditioning program. 8 programs, 20+ workout
            frameworks, personalized pacing, and built-in analytics — from 3 to 5 days per week.
          </p>

          {hasOtherSub && (
            <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              You have an active subscription — upgrade to All Access to add Engine.
            </p>
          )}

          {/* Top CTA */}
          {ctaButton}

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Programs showcase */}
          <div style={{ width: '100%', textAlign: 'left' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 16, textAlign: 'center' }}>
              Choose Your Program
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {PROGRAM_GROUPS.map((group) => (
                <div key={group.category}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{group.category}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{group.description}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.programs.map((prog) => (
                      <div
                        key={prog.name}
                        style={{
                          background: 'var(--surface2)',
                          border: '1px solid var(--border-light)',
                          borderRadius: 8,
                          padding: '12px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{prog.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{prog.duration}</div>
                        </div>
                        <div style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--accent)',
                          background: 'var(--accent-glow)',
                          padding: '4px 10px',
                          borderRadius: 20,
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}>
                          {prog.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Common features */}
          <div style={{ width: '100%', textAlign: 'left' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 14, textAlign: 'center' }}>
              Every Program Includes
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FEATURES.map(({ icon: Icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--text-dim)' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--surface2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  {text}
                </div>
              ))}
            </div>
          </div>

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Bottom CTA */}
          {ctaButton}
        </div>
      </div>
    </div>
  );
}
