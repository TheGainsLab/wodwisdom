import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Apple, Camera, Search, BookOpen, BarChart3, Utensils, ScanBarcode } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  hasFeature?: (feature: string) => boolean;
}

const FEATURES = [
  { icon: Search, text: 'Search 900,000+ foods with detailed nutrition data' },
  { icon: Camera, text: 'Snap a photo to auto-identify foods and macros' },
  { icon: ScanBarcode, text: 'Barcode scanner for packaged foods' },
  { icon: BookOpen, text: 'Save meal templates for quick daily logging' },
  { icon: Utensils, text: 'Favorites for foods you eat regularly' },
  { icon: BarChart3, text: 'Daily macro tracking with calorie targets' },
];

export default function NutritionPaywall({ hasFeature }: Props) {
  const navigate = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);

  // Determine if user has an existing subscription (but not nutrition)
  const hasOtherSub = hasFeature
    ? hasFeature('ai_chat') || hasFeature('programming') || hasFeature('engine')
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

  // Users with programming or engine already include nutrition — they shouldn't see this.
  // This handles users with just ai_chat (Coach only) who need to upgrade.
  const handleUpgrade = hasOtherSub ? openBillingPortal : () => navigate('/checkout');
  const ctaLabel = hasOtherSub ? 'Upgrade to Add Nutrition' : 'Upgrade to Access Nutrition';

  const ctaButton = (
    <button
      className="engine-btn engine-btn-primary"
      onClick={handleUpgrade}
      disabled={portalLoading}
      style={{ width: '100%' }}
    >
      <Apple size={18} /> {portalLoading ? 'Opening...' : ctaLabel}
    </button>
  );

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
            Track your daily nutrition with AI-powered food recognition,
            barcode scanning, meal templates, and macro analytics.
          </p>

          {hasOtherSub && (
            <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              You have an active subscription — upgrade your plan to add Nutrition.
            </p>
          )}

          {/* Top CTA */}
          {ctaButton}

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Features */}
          <div style={{ width: '100%', textAlign: 'left' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 14, textAlign: 'center' }}>
              What You Get
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
