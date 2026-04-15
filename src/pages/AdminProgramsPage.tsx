import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

interface ProgramSummary {
  id: string;
  name: string;
  source: string;
  gym_name: string | null;
  is_ongoing: boolean;
  committed: boolean;
  generated_months: number;
  subscription_start: string | null;
  created_at: string;
  workout_count: number;
}

interface Workout {
  id: string;
  month_number: number;
  week_num: number;
  day_num: number;
  sort_order: number;
  workout_text: string;
  blocks: BlockRow[] | null;
  log_id: string | null;
}

interface BlockRow {
  id: string;
  block_type: string;
  block_order: number;
  block_text: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sourceBadgeColor(source: string): string {
  if (source === 'generated') return 'var(--accent)';
  if (source === 'external') return '#6ea8fe';
  if (source === 'uploaded') return '#2ec486';
  return 'var(--text-muted)';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminProgramsPage({ session }: { session: Session }) {
  const { id, programId } = useParams<{ id: string; programId?: string }>();
  const navigate = useNavigate();

  const [loadingList, setLoadingList] = useState(true);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [listError, setListError] = useState('');

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<{ program: any; workouts: Workout[] } | null>(null);
  const [detailError, setDetailError] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Record<number, boolean>>({ 1: true });
  const [showMeta, setShowMeta] = useState(false);

  // Load program list
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingList(true);
      const { data, error: err } = await supabase.rpc('admin_list_programs', { target_user_id: id });
      if (err) setListError(err.message);
      else if (Array.isArray(data)) setPrograms(data);
      setLoadingList(false);
    })();
  }, [id]);

  // Auto-select first program if none in the URL
  useEffect(() => {
    if (loadingList || programId) return;
    if (programs.length > 0 && id) {
      navigate(`/admin/users/${id}/programs/${programs[0].id}`, { replace: true });
    }
  }, [loadingList, programs, programId, id, navigate]);

  // Load detail
  useEffect(() => {
    if (!id || !programId) {
      setDetail(null);
      return;
    }
    (async () => {
      setLoadingDetail(true);
      setDetailError('');
      const { data, error: err } = await supabase.rpc('admin_get_program', {
        target_user_id: id,
        p_program_id: programId,
      });
      if (err) setDetailError(err.message);
      else setDetail(data);
      setLoadingDetail(false);
      setExpandedMonths({ 1: true });
      setShowMeta(false);
    })();
  }, [id, programId]);

  // Group workouts: month → (week → days)
  const grouped = useMemo(() => {
    const byMonth = new Map<number, Map<number, Workout[]>>();
    for (const w of detail?.workouts ?? []) {
      if (!byMonth.has(w.month_number)) byMonth.set(w.month_number, new Map());
      const byWeek = byMonth.get(w.month_number)!;
      if (!byWeek.has(w.week_num)) byWeek.set(w.week_num, []);
      byWeek.get(w.week_num)!.push(w);
    }
    return byMonth;
  }, [detail]);

  const months = useMemo(() => Array.from(grouped.keys()).sort((a, b) => a - b), [grouped]);

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Programs">
      {loadingList && <div className="page-loading"><div className="loading-pulse" /></div>}
      {listError && <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{listError}</div>}

      {!loadingList && programs.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          No programs created yet.
        </div>
      )}

      {!loadingList && programs.length > 0 && (
        <div className="admin-programs-layout" style={{
          display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start',
        }}>
          {/* Sidebar */}
          <aside style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 12, position: 'sticky', top: 12,
            maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', padding: '4px 8px', marginBottom: 4 }}>
              Programs ({programs.length})
            </div>
            {programs.map(p => {
              const isSel = programId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/admin/users/${id}/programs/${p.id}`)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: isSel ? 'var(--accent-glow)' : 'transparent',
                    border: 'none', color: isSel ? 'var(--accent)' : 'var(--text)',
                    padding: '8px 10px', borderRadius: 6, fontSize: 12,
                    cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
                    marginBottom: 2,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
                    <span style={{ color: sourceBadgeColor(p.source), fontWeight: 600, textTransform: 'uppercase' }}>
                      {p.source}
                    </span>
                    <span>· {p.workout_count} wk</span>
                    <span>· {formatDate(p.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Detail pane */}
          <section style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 20, minHeight: 300,
          }}>
            {loadingDetail && <div className="loading-pulse" />}
            {detailError && <div className="auth-error" style={{ display: 'block' }}>{detailError}</div>}

            {detail?.program && (
              <>
                {/* Header */}
                <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {detail.program.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: sourceBadgeColor(detail.program.source), fontWeight: 600, textTransform: 'uppercase' }}>
                      {detail.program.source}
                    </span>
                    <span>·</span>
                    <span>Created {formatDate(detail.program.created_at)}</span>
                    <span>·</span>
                    <span>{detail.program.generated_months} month{detail.program.generated_months !== 1 ? 's' : ''} built</span>
                    {detail.program.gym_name && <><span>·</span><span>{detail.program.gym_name}</span></>}
                    {!detail.program.committed && <><span>·</span><span style={{ color: 'var(--text-muted)' }}>Draft</span></>}
                  </div>
                </div>

                {/* Month tree */}
                {months.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>
                    No workouts in this program.
                  </div>
                ) : months.map(month => {
                  const isOpen = !!expandedMonths[month];
                  const weeksMap = grouped.get(month)!;
                  const weeks = Array.from(weeksMap.keys()).sort((a, b) => a - b);
                  const totalDays = Array.from(weeksMap.values()).reduce((sum, d) => sum + d.length, 0);
                  const completed = Array.from(weeksMap.values())
                    .flat()
                    .filter(w => w.log_id).length;
                  return (
                    <div key={month} style={{ marginBottom: 12 }}>
                      <button
                        onClick={() => setExpandedMonths(prev => ({ ...prev, [month]: !isOpen }))}
                        style={{
                          display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                          background: 'var(--bg)', border: '1px solid var(--border)',
                          padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                          fontFamily: "'Outfit', sans-serif", color: 'var(--text)',
                          fontSize: 14, fontWeight: 600,
                        }}
                      >
                        <span>{isOpen ? '▾' : '▸'}</span>
                        <span>Month {month}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                          {completed}/{totalDays} completed
                        </span>
                      </button>

                      {isOpen && (
                        <div style={{ padding: '8px 0 0 12px' }}>
                          {weeks.map(wk => {
                            const days = weeksMap.get(wk)!;
                            return (
                              <div key={wk} style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 0' }}>
                                  Week {wk}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {days.map(d => (
                                    <DayRow key={d.id} userId={id!} day={d} onNavigate={navigate} />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Meta (collapsible) */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setShowMeta(v => !v)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', fontSize: 12, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: 0.5, padding: 0,
                    }}
                  >
                    {showMeta ? '▾' : '▸'} Program metadata
                  </button>
                  {showMeta && (
                    <pre style={{
                      marginTop: 10, background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                      overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                    }}>
                      {JSON.stringify(detail.program, null, 2)}
                    </pre>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .admin-programs-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </AdminSubPageLayout>
  );
}

function DayRow({ userId, day, onNavigate }: { userId: string; day: Workout; onNavigate: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const completed = !!day.log_id;
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 8, padding: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
            background: completed ? '#2ec48633' : 'var(--surface)',
            color: completed ? '#2ec486' : 'var(--text-muted)',
            border: '1px solid ' + (completed ? '#2ec48633' : 'var(--border)'),
            fontSize: 11, fontWeight: 700,
          }}
          title={completed ? 'Completed' : 'Not logged'}
        >
          {completed ? '✓' : ''}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          Day {day.day_num}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
          {day.blocks?.length ?? 0} block{(day.blocks?.length ?? 0) !== 1 ? 's' : ''}
        </span>
        {day.blocks && day.blocks.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>
            · {Array.from(new Set(day.blocks.map(b => b.block_type))).join(', ')}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {completed && (
            <button
              onClick={() => onNavigate(`/admin/users/${userId}/workouts/${day.log_id}`)}
              style={{
                background: 'var(--accent-glow)', color: 'var(--accent)',
                border: 'none', borderRadius: 4, padding: '3px 8px',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
                fontFamily: "'Outfit', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
              }}
            >
              View log →
            </button>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', fontSize: 11, padding: '3px 6px',
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: 24 }}>
          {day.blocks && day.blocks.length > 0 ? (
            day.blocks.map(b => (
              <div key={b.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)', marginBottom: 3 }}>
                  {humanize(b.block_type)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
                  {b.block_text}
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
              {day.workout_text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
