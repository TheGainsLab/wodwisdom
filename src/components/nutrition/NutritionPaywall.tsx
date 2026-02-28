import { useNavigate } from 'react-router-dom';
import { Lock, Apple } from 'lucide-react';

export default function NutritionPaywall() {
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
            <Apple size={28} />
          </div>

          <h2 className="engine-header">Nutrition Tracking</h2>
          <p className="engine-subheader" style={{ maxWidth: 360 }}>
            Track your daily nutrition with food search, barcode scanning,
            photo recognition, meal templates, and macro analytics.
          </p>

          <hr className="engine-divider" style={{ width: '100%' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', textAlign: 'left' }}>
            {[
              'Search 900,000+ foods with detailed nutrition data',
              'Snap a photo to auto-identify foods and macros',
              'Save meal templates for quick daily logging',
              'Daily macro tracking with calorie targets',
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
            <Apple size={18} /> Upgrade to Access Nutrition
          </button>
        </div>
      </div>
    </div>
  );
}
