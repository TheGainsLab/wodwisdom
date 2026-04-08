import { useNavigate } from 'react-router-dom';
import { Apple, Camera, Search, BookOpen, BarChart3, Utensils, ScanBarcode } from 'lucide-react';

interface Props {
  hasFeature?: (feature: string) => boolean;
}

/** All plans that include nutrition, ordered by price */
const NUTRITION_UPGRADE_OPTIONS = [
  {
    key: 'nutrition',
    name: 'AI Nutrition',
    price: '$7.99/mo',
    includes: ['Nutrition'],
    onlyForFree: true, // hide if user already has any sub (they'd need a combo plan)
  },
  {
    key: 'coach_nutrition',
    name: 'AI Coach + AI Nutrition',
    price: '$11.99/mo',
    includes: ['AI Coach', 'Nutrition'],
  },
  {
    key: 'programming',
    name: 'AI Programming',
    price: '$29.99/mo',
    includes: ['AI Coach', 'Nutrition', 'AI Programming'],
  },
  {
    key: 'engine',
    name: 'Year of the Engine',
    price: '$29.99/mo',
    includes: ['AI Coach', 'Nutrition', 'Year of the Engine'],
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
  programming: ['programming', 'ai_chat', 'nutrition'],
  engine: ['engine', 'ai_chat', 'nutrition'],
  all_access: ['ai_chat', 'programming', 'engine', 'nutrition'],
};

const FEATURE_LIST = [
  { icon: Search, text: 'Search 900,000+ foods with detailed nutrition data' },
  { icon: Camera, text: 'Snap a photo to auto-identify foods and macros' },
  { icon: ScanBarcode, text: 'Barcode scanner for packaged foods' },
  { icon: BookOpen, text: 'Save meal templates for quick daily logging' },
  { icon: Utensils, text: 'Favorites for foods you eat regularly' },
  { icon: BarChart3, text: 'Daily macro tracking with calorie targets' },
];

export default function NutritionPaywall({ hasFeature }: Props) {
  const navigate = useNavigate();

  const has = (f: string) => hasFeature ? hasFeature(f) : false;
  const hasAnySub = has('ai_chat') || has('programming') || has('engine');

  // Filter to plans that are an upgrade and make sense for the user
  const upgradeOptions = NUTRITION_UPGRADE_OPTIONS.filter(opt => {
    // Hide nutrition-only plan if user already has another sub
    if (opt.onlyForFree && hasAnySub) return false;
    // Must grant at least one new feature
    return PLAN_FEATURES[opt.key].some(f => !has(f));
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
                onClick={() => navigate('/checkout')}
                style={{
                  width: '100%',
                  flexDirection: 'column',
                  padding: '16px 20px',
                  gap: 4,
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

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Features */}
          <div style={{ width: '100%', textAlign: 'left' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--accent)', marginBottom: 14, textAlign: 'center' }}>
              What You Get
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FEATURE_LIST.map(({ icon: Icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--text-dim)' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, background: 'var(--surface2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Icon size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  {text}
                </div>
              ))}
            </div>
          </div>

          <hr className="engine-divider" style={{ width: '100%' }} />

          {/* Bottom upgrade options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            {upgradeOptions.map(opt => (
              <button
                key={opt.key}
                className="engine-btn engine-btn-primary"
                onClick={() => navigate('/checkout')}
                style={{
                  width: '100%',
                  flexDirection: 'column',
                  padding: '16px 20px',
                  gap: 4,
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

          <button
            onClick={() => navigate(-1 as any)}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', marginTop: 4, fontFamily: 'inherit' }}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
