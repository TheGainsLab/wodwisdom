/**
 * LogActivityPage — log training done outside your programs.
 *
 * Flow: pick a date, describe the session in plain words → AI parses it →
 * confirm (or fix) the structured card → save. Saved activities land on the
 * Training Log calendar, inform the AI Coach immediately, and are considered
 * when the next month's program generates. They never change Engine pacing.
 *
 * AI Programming + Year of the Engine tiers (and admins) — a coach
 * capability, not a program feature. The entry primitive of the long-term
 * AI Logger platform — keep it self-contained.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Nav from '../components/Nav';
import { useEntitlements } from '../hooks/useEntitlements';
import {
  parseActivity,
  saveActivity,
  listActivities,
  deleteActivity,
  type ParsedActivity,
  type AthleteActivity,
} from '../lib/activitiesService';
import { Loader2, Check, Trash2, ChevronLeft } from 'lucide-react';

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LogActivityPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const { hasFeature, isAdmin, loading: entLoading } = useEntitlements(session.user.id);

  const [date, setDate] = useState(params.get('date') ?? localDate());
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedActivity | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<AthleteActivity[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  // Coach capability, not a program feature: Programming AND Engine tiers.
  const allowed = isAdmin || hasFeature('programming') || hasFeature('engine');

  const loadRecent = () => {
    listActivities(15).then(setRecent).catch(() => {});
  };
  useEffect(() => { if (allowed) loadRecent(); }, [allowed]);

  const doParse = async () => {
    setError('');
    setParsing(true);
    try {
      setParsed(await parseActivity(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    }
    setParsing(false);
  };

  const doSave = async () => {
    if (!parsed) return;
    setSaving(true);
    setError('');
    try {
      await saveActivity(date, text.trim(), parsed);
      setParsed(null);
      setText('');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setSaving(false);
  };

  const editField = (k: keyof ParsedActivity, v: unknown) =>
    setParsed((p) => (p ? { ...p, [k]: v } : p));

  if (entLoading) {
    return (
      <div className="app-layout">
        <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <div className="main-content"><div className="page-loading"><div className="loading-pulse" /></div></div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Log Activity</h1>
        </header>

        {!allowed ? (
          <div className="engine-page">
            <div className="engine-empty">
              <div className="engine-empty-title">Part of our training subscriptions</div>
              <div className="engine-empty-desc">
                Logging training done outside your program — and having your coach and
                programming account for it — comes with AI Programming and Year of the Engine.
              </div>
              <button className="engine-btn engine-btn-secondary" onClick={() => navigate(-1)}>
                <ChevronLeft size={16} /> Back
              </button>
            </div>
          </div>
        ) : (
          <div className="engine-page" style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: 620, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="engine-card">
                <div className="engine-section">
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
                    Did something outside your program — a ride, a run, an extra strength
                    day, a test? Describe it in plain words. It'll show on your calendar,
                    your coach sees it right away, and your programming accounts for it.
                  </p>
                  <span className="engine-label">Date</span>
                  <input
                    type="date"
                    value={date}
                    max={localDate()}
                    onChange={(e) => setDate(e.target.value)}
                    style={{ display: 'block', marginBottom: 12, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                  />
                  <span className="engine-label">What did you do?</span>
                  <textarea
                    value={text}
                    onChange={(e) => { setText(e.target.value); setParsed(null); }}
                    placeholder='e.g. "45 min trail ride, hilly, felt hard, avg HR 152" or "20 min FTP test on the bike erg — 254W"'
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
                  />
                  {!parsed && (
                    <button
                      className="engine-btn engine-btn-primary"
                      onClick={doParse}
                      disabled={parsing || text.trim().length < 3}
                      style={{ marginTop: 12 }}
                    >
                      {parsing ? <Loader2 size={16} className="spin" /> : 'Continue'}
                    </button>
                  )}
                  {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{error}</p>}
                  {savedFlash && (
                    <p style={{ color: '#4ade80', fontSize: 13, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={14} /> Logged — it's on your calendar.
                    </p>
                  )}
                </div>
              </div>

              {parsed && (
                <div className="engine-card" style={{ border: '1px solid var(--accent)' }}>
                  <div className="engine-section">
                    <span className="engine-label">Confirm</span>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: '6px 0 10px' }}>{parsed.summary}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Type
                        <input value={parsed.activity_type} onChange={(e) => editField('activity_type', e.target.value)}
                          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Minutes
                        <input type="number" value={parsed.duration_minutes ?? ''} onChange={(e) => editField('duration_minutes', e.target.value === '' ? null : Number(e.target.value))}
                          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>RPE (1-10)
                        <input type="number" min={1} max={10} value={parsed.rpe ?? ''} onChange={(e) => editField('rpe', e.target.value === '' ? null : Number(e.target.value))}
                          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Avg HR
                        <input type="number" value={parsed.avg_hr ?? ''} onChange={(e) => editField('avg_hr', e.target.value === '' ? null : Number(e.target.value))}
                          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
                      </label>
                    </div>
                    {parsed.is_benchmark && parsed.benchmark && (
                      <div style={{ padding: '10px 12px', background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.35)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                        Benchmark detected: <strong>{parsed.benchmark.name}</strong> — {parsed.benchmark.value}{parsed.benchmark.unit ? ` ${parsed.benchmark.unit}` : ''}.
                        Saved with retest history. (Your profile's declared numbers aren't changed — update those in your profile if this test should drive programming loads.)
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="engine-btn engine-btn-primary" onClick={doSave} disabled={saving}>
                        {saving ? <Loader2 size={16} className="spin" /> : 'Save'}
                      </button>
                      <button className="engine-btn engine-btn-secondary" onClick={() => setParsed(null)} disabled={saving}>
                        Edit text
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {recent.length > 0 && (
                <div className="engine-card">
                  <div className="engine-section">
                    <span className="engine-label">Recent activities</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {recent.map((a) => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{a.date}</span>
                          <span style={{ flex: 1 }}>
                            {(a.parsed?.summary as string | undefined) ?? `${a.activity_type ?? 'activity'}${a.duration_minutes ? ` · ${a.duration_minutes} min` : ''}`}
                          </span>
                          <button
                            onClick={() => deleteActivity(a.id).then(loadRecent).catch(() => {})}
                            aria-label="Delete activity"
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
