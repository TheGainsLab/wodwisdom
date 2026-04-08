import { useNavigate } from 'react-router-dom';
import { Zap, Calendar, Dumbbell, Clock, BarChart3, Timer, TrendingUp } from 'lucide-react';

interface Props {
  hasFeature?: (feature: string) => boolean;
}

/** Plans that include engine, with what they offer */
const ENGINE_UPGRADE_OPTIONS = [
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
  engine: ['engine', 'ai_chat', 'nutrition'],
  all_access: ['ai_chat', 'programming', 'engine', 'nutrition'],
};

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

const FEATURE_LIST = [
  { icon: TrendingUp, text: 'Personalized pace targets from time trial baselines' },
  { icon: Timer, text: 'Built-in interval timer with work/rest tracking' },
  { icon: Calendar, text: 'Progressive month-by-month unlock system' },
  { icon: BarChart3, text: 'Performance analytics and trend tracking' },
  { icon: Dumbbell, text: '20+ workout frameworks across all energy systems' },
  { icon: Clock, text: 'Workouts scaled to your current fitness level' },
];

export default function EnginePaywall({ hasFeature }: Props) {
  const navigate = useNavigate();

  const has = (f: string) => hasFeature ? hasFeature(f) : false;
  const hasAnySub = has('ai_chat') || has('programming') || has('nutrition');

  // Filter to only show plans that are an upgrade (grant at least one new feature)
  const upgradeOptions = hasAnySub
    ? ENGINE_UPGRADE_OPTIONS.filter(opt => PLAN_FEATURES[opt.key].some(f => !has(f)))
    : ENGINE_UPGRADE_OPTIONS;

  // Build description for each option based on what user currently has
  const describeOption = (opt: typeof ENGINE_UPGRADE_OPTIONS[0]) => {
    const kept: string[] = [];
    const gained: string[] = [];
    for (const label of opt.includes) {
      const featureMap: Record<string, string> = {
        'AI Coach': 'ai_chat', 'Nutrition': 'nutrition',
        'Year of the Engine': 'engine', 'AI Programming': 'programming',
      };
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
          {/* Hero */}
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--accent-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)',
          }}>
            <Zap size={28} />
          </div>

          <h2 className="engine-header">Year of the Engine</h2>
          <p className="engine-subheader" style={{ maxWidth: 360 }}>
            The world's most comprehensive conditioning program. 8 programs, 20+ workout
            frameworks, personalized pacing, and built-in analytics — from 3 to 5 days per week.
          </p>

          {/* Upgrade options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            {upgradeOptions.map(opt => (
              <button
                key={opt.key}
                className="engine-btn engine-btn-primary"
                onClick={() => navigate(`/checkout?plan=${opt.key}&interval=monthly`)}
                style={{
                  width: '100%',
                  flexDirection: 'column',
                  padding: '16px 20px',
                  gap: 4,
                  border: opt.featured ? '2px solid var(--accent)' : undefined,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={16} /> {opt.name} — {opt.price}
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
                      <div key={prog.name} style={{
                        background: 'var(--surface2)', border: '1px solid var(--border-light)',
                        borderRadius: 8, padding: '12px 14px',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{prog.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{prog.duration}</div>
                        </div>
                        <div style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                          background: 'var(--accent-glow)', padding: '4px 10px',
                          borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
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
                onClick={() => navigate(`/checkout?plan=${opt.key}&interval=monthly`)}
                style={{
                  width: '100%',
                  flexDirection: 'column',
                  padding: '16px 20px',
                  gap: 4,
                  border: opt.featured ? '2px solid var(--accent)' : undefined,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={16} /> {opt.name} — {opt.price}
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
