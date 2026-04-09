import { useNavigate } from 'react-router-dom';
import { Apple } from 'lucide-react';

interface Props {
  hasFeature?: (feature: string) => boolean;
}

/** Plans to show on the Nutrition paywall — focused options, not every plan */
const NUTRITION_UPGRADE_OPTIONS = [
  {
    key: 'nutrition',
    name: 'AI Nutrition',
    price: '$7.99/mo',
    includes: ['Nutrition'],
  },
  {
    key: 'coach_nutrition',
    name: 'AI Coach + AI Nutrition',
    price: '$11.99/mo',
    includes: ['AI Coach', 'Nutrition'],
  },
  {
    key: 'all_access',
    name: 'All Access',
    price: '$49.99/mo',
    includes: ['AI Coach', 'Nutrition', 'Year of the Engine', 'AI Programming'],
    featured: true,
  },
];

const PLAN_FEATURES: Record<string, string[]> = {
  nutrition: ['nutrition'],
  coach_nutrition: ['ai_chat', 'nutrition'],
  all_access: ['ai_chat', 'programming', 'engine', 'nutrition'],
};

export default function NutritionPaywall({ hasFeature }: Props) {
  const navigate = useNavigate();

  const has = (f: string) => hasFeature ? hasFeature(f) : false;
  const hasAnySub = has('ai_chat') || has('programming') || has('engine');

  const currentFeatures = ['ai_chat', 'programming', 'engine', 'nutrition'].filter(f => has(f));
  const upgradeOptions = NUTRITION_UPGRADE_OPTIONS.filter(opt => {
    const planFeats = PLAN_FEATURES[opt.key];
    return currentFeatures.every(f => planFeats.includes(f)) && planFeats.some(f => !has(f));
  });

  const featureMap: Record<string, string> = {
    'AI Coach': 'ai_chat', 'Nutrition': 'nutrition',
    'Year of the Engine': 'engine', 'AI Programming': 'programming',
  };

  const describeOption = (opt: typeof NUTRITION_UPGRADE_OPTIONS[0]) => {
    const kept: string[] = [];
    const gained: string[] = [];
    for (const label of opt.includes) {
      const feat = featureMap[label];
      if (feat && has(feat)) kept.push(label);
      else gained.push(label);
    }
    const parts: string[] = [];
    if (kept.length > 0) parts.push('Keep ' + kept.join(', '));
    if (gained.length > 0) parts.push('Add ' + gained.join(', '));
    return parts.join(' · ');
  };

  return (
    <div className="engine-page" style={{ padding: '24px 0' }}>
      <div className="engine-card" style={{ maxWidth: 480, width: '100%', textAlign: 'center', margin: '0 auto' }}>
        <div className="engine-section" style={{ alignItems: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--accent-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
          }}>
            <Apple size={28} />
          </div>

          <h2 className="engine-header">Nutrition Tracking</h2>
          <p className="engine-subheader" style={{ maxWidth: 360 }}>
            Track your daily nutrition with AI-powered food recognition,
            barcode scanning, meal templates, and macro analytics.
          </p>

          {/* Upgrade options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            {upgradeOptions.map(opt => (
              <button
                key={opt.key}
                className="engine-btn engine-btn-primary"
                onClick={() => navigate(`/checkout?plan=${opt.key}&interval=monthly`)}
                style={{
                  width: '100%', flexDirection: 'column',
                  padding: '16px 20px', gap: 4,
                  border: opt.featured ? '2px solid var(--accent)' : undefined,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Apple size={16} /> {opt.name} — {opt.price}
                </span>
                {hasAnySub && (
                  <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>
                    {describeOption(opt)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Nutrition is also included with AI Programming, Year of the Engine, and All Access.
          </p>

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', textAlign: 'left' }}>
            {[
              'Search 900,000+ foods with detailed nutrition data',
              'Snap a photo to auto-identify foods and macros',
              'Barcode scanner for packaged foods',
              'Meal templates and favorites for quick logging',
              'Daily macro tracking with calorie targets',
            ].map(text => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-dim)' }}>
                <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0 }}>&#10003;</span>
                {text}
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate(-1 as any)}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' }}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
