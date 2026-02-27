import { useNavigate } from 'react-router-dom';
import { Lock, Zap } from 'lucide-react';

/**
 * Shown when a user visits Engine pages without an active or trial subscription.
 * Displays a marketing summary and upgrade CTA.
 */
export default function EnginePaywall() {
  const navigate = useNavigate();

  return (
    <div className="engine-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="engine-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div className="engine-section" style={{ alignItems: 'center' }}>
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
            A 720-day structured conditioning program with 20+ workout frameworks,
            personalized pacing, interval timers, and performance analytics.
          </p>

          <hr className="engine-divider" style={{ width: '100%' }} />

          <div className="engine-grid" style={{ width: '100%' }}>
            <div className="engine-stat" style={{ textAlign: 'center' }}>
              <div className="engine-stat-value" style={{ fontSize: 22 }}>720</div>
              <div className="engine-stat-label">Training Days</div>
            </div>
            <div className="engine-stat" style={{ textAlign: 'center' }}>
              <div className="engine-stat-value" style={{ fontSize: 22 }}>20+</div>
              <div className="engine-stat-label">Workout Types</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', textAlign: 'left' }}>
            {[
              'Personalized pace targets from time trial baselines',
              'Built-in interval timer with work/rest tracking',
              'Progressive month-by-month unlock system',
              'Performance analytics and trend tracking',
            ].map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-dim)' }}>
                <Lock size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                {item}
              </div>
            ))}
          </div>

          <hr className="engine-divider" style={{ width: '100%' }} />

          <button
            className="engine-btn engine-btn-primary"
            onClick={() => navigate('/checkout')}
            style={{ width: '100%' }}
          >
            <Zap size={18} /> Upgrade to Access Engine
          </button>
        </div>
      </div>
    </div>
  );
}
