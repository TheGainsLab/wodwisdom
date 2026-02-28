import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import EnginePaywall from '../components/engine/EnginePaywall';
import { loadDayTypes, loadUserProgress, type EngineDayType } from '../lib/engineService';
import { useEntitlements } from '../hooks/useEntitlements';
import { ChevronLeft } from 'lucide-react';

// ── Day type descriptions (not stored in DB) ────────────────────────

const DESCRIPTIONS: Record<string, string> = {
  endurance:
    'Long, sustained efforts at aerobic pace. Builds base engine capacity and teaches pacing discipline.',
  threshold:
    'Extended work at threshold intensity. Pushes your lactate threshold higher for sustained performance.',
  anaerobic:
    'Max-effort intervals with long rest. Develops top-end power and anaerobic capacity.',
  polarized:
    'Continuous base-pace work with periodic max-effort bursts. Trains the ability to surge and recover within a session.',
  flux:
    'Alternating base and elevated-pace segments within a single block. Builds metabolic flexibility and pace awareness.',
  flux_stages:
    'Progressive flux workout with increasing intensity across stages. Develops pacing control under rising fatigue.',
  time_trial:
    'All-out 10-minute effort that establishes your baseline pace for each piece of equipment. Sets targets for future workouts.',
  interval:
    'Multi-round intervals with short rest. Classic conditioning format targeting work capacity.',
  synthesis:
    'Four-block comprehensive workout mixing multiple intensities. The most complex day type — tests everything.',
  afterburner:
    'Multi-block high-intensity workout with recovery periods. Develops the ability to perform after fatigue accumulation.',
  atomic:
    'Two-block high-intensity work with options for duration. Short, sharp efforts that build explosive conditioning.',
  devour:
    'Progressive work blocks at sub-threshold intensity. Teaches sustained output over increasing durations.',
  ascending_devour:
    'Progressive work with increasing both pace and duration. Builds capacity while demanding more output each round.',
  descending_devour:
    'Decreasing rest periods with consistent work duration. Forces adaptation to incomplete recovery.',
  ascending:
    'Progressive pace increases with equal rest periods. Develops the ability to accelerate through a workout.',
  towers:
    'Three-block progressive workout finishing with an extended base block. Builds endurance through structured volume.',
  infinity:
    'Three-block progressive intensity finishing with max effort. Teaches full-spectrum energy system usage.',
  hybrid_aerobic:
    'Two-block moderate intensity with partial rest recovery. Bridges aerobic and threshold training.',
  hybrid_anaerobic:
    'Two-block high intensity with long rest intervals. Combines anaerobic power with repeat effort ability.',
  max_aerobic_power:
    'Moderate-to-high intensity blocks with equal rest. Targets the ceiling of your aerobic output.',
  rocket_races_a:
    'High-intensity rounds with 2-3x work rest. Short explosive efforts that build peak power.',
  rocket_races_b:
    'Follow-up to Rocket Races A with reduced rest. Demands the same output under greater fatigue.',
};

function badgeClass(name: string): string {
  const n = name.toLowerCase();
  if (n === 'endurance') return 'engine-badge--endurance';
  if (['threshold', 'anaerobic', 'ascending', 'interval', 'max_aerobic_power'].includes(n))
    return 'engine-badge--strength';
  if (['polarized', 'flux', 'flux_stages', 'rocket_races_a', 'rocket_races_b'].includes(n))
    return 'engine-badge--power';
  if (n === 'time_trial') return 'engine-badge--hypertrophy';
  return 'engine-badge--default';
}

function categoryLabel(name: string): string {
  const n = name.toLowerCase();
  if (n === 'endurance') return 'Aerobic';
  if (['threshold', 'anaerobic', 'ascending', 'interval', 'max_aerobic_power'].includes(n))
    return 'Threshold / Anaerobic';
  if (['polarized', 'flux', 'flux_stages', 'rocket_races_a', 'rocket_races_b'].includes(n))
    return 'Variable Intensity';
  if (n === 'time_trial') return 'Assessment';
  return 'Multi-Block';
}

// ── Component ────────────────────────────────────────────────────────

export default function EngineTaxonomyPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dayTypes, setDayTypes] = useState<EngineDayType[]>([]);
  const { hasFeature } = useEntitlements(session.user.id);
  const hasAccess = hasFeature('engine');

  useEffect(() => {
    (async () => {
      try {
        const dt = await loadDayTypes();
        setDayTypes(dt);
      } catch {
        // degrade
      }
      setLoading(false);
    })();
  }, [session.user.id]);

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Workout Types</h1>
        </header>

        {loading ? (
          <div className="page-loading"><div className="loading-pulse" /></div>
        ) : !hasAccess ? (
          <EnginePaywall />
        ) : (
          <div className="engine-page">
            <div className="engine-section">
              <button
                className="engine-btn engine-btn-secondary engine-btn-sm"
                onClick={() => navigate('/engine')}
                style={{ alignSelf: 'flex-start' }}
              >
                <ChevronLeft size={16} /> Dashboard
              </button>

              <p className="engine-subheader">
                The Engine program uses {dayTypes.length} distinct workout frameworks.
                Each targets a specific energy system and progressively scales across the 36-month program.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dayTypes.map((dt) => {
                  const desc = DESCRIPTIONS[dt.name] ?? 'Specialized workout framework.';
                  const cat = categoryLabel(dt.name);

                  return (
                    <div key={dt.id} className="engine-card" style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span className={'engine-badge ' + badgeClass(dt.name)}>
                          {dt.name.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                          {cat}
                        </span>
                        {dt.is_support_day && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Support day
                          </span>
                        )}
                      </div>

                      <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
                        {desc}
                      </p>

                      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                        {dt.block_count > 0 && (
                          <span>{dt.block_count} block{dt.block_count > 1 ? 's' : ''}</span>
                        )}
                        {dt.max_duration_minutes != null && (
                          <span>Up to {dt.max_duration_minutes} min</span>
                        )}
                        {dt.phase_requirement > 1 && (
                          <span>Unlocks phase {dt.phase_requirement}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
