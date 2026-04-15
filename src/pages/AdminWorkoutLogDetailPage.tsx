import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)', margin: 0 }}>{title}</h3>
        {right}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        {children}
      </div>
    </div>
  );
}

export default function AdminWorkoutLogDetailPage({ session }: { session: Session }) {
  const { id, workoutId } = useParams<{ id: string; workoutId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!id || !workoutId) return;
    (async () => {
      setLoading(true);
      const { data: result, error: err } = await supabase.rpc('admin_get_workout_log', {
        target_user_id: id,
        p_log_id: workoutId,
      });
      if (err) setError(err.message);
      else setData(result);
      setLoading(false);
    })();
  }, [id, workoutId]);

  const log = data?.log;
  const blocks = data?.blocks ?? [];
  const entries = data?.entries ?? [];
  const review = data?.review;

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Workout Log">
      <button
        onClick={() => navigate(`/admin/users/${id}/workouts`)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-dim)',
          cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 16,
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        ← All workouts
      </button>

      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}
      {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}

      {!loading && !log && !error && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          Workout log not found.
        </div>
      )}

      {log && (
        <>
          <div style={{ marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {humanize(log.workout_type)}
              {log.status === 'in_progress' && (
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, background: 'var(--border)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 4, marginLeft: 10, verticalAlign: 'middle' }}>
                  In Progress
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {formatDateTime(log.created_at)} · {humanize(log.source_type)}
              {log.source_id && ` · source ${log.source_id}`}
            </div>
          </div>

          {/* Blocks */}
          {blocks.length > 0 && (
            <Section title={`Blocks (${blocks.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {blocks.map((b: any) => (
                  <div key={b.id} style={{ padding: 10, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)' }}>
                        {humanize(b.block_type)}
                        {b.block_label && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {b.block_label}</span>}
                      </div>
                      {b.score && (
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          {b.score} {b.rx && <span style={{ color: 'var(--accent)', fontSize: 10 }}>Rx</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-dim)' }}>
                      {b.block_text}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Entries (movements) */}
          {entries.length > 0 && (
            <Section title={`Movement Entries (${entries.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={thStyle}>Movement</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Sets</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Reps</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Weight</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>RPE</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e: any) => (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={tdStyle}>{e.movement}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{e.sets ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{e.reps ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                        {e.weight != null ? `${e.weight}${e.weight_unit || ''}` : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{e.rpe ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Notes */}
          {log.notes && (
            <Section title="Notes">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{log.notes}</div>
            </Section>
          )}

          {/* AI Coach review */}
          {review && (
            <Section title="Coach Review">
              {typeof review.review === 'object' ? (
                <pre style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  overflowX: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(review.review, null, 2)}
                </pre>
              ) : (
                <div
                  className="workout-review-content"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(String(review.review)) }}
                />
              )}
            </Section>
          )}

          {/* Raw workout_text + full log */}
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => setShowRaw(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: 12, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.5, padding: 0,
              }}
            >
              {showRaw ? '▾' : '▸'} Raw workout_text & log row
            </button>
            {showRaw && (
              <div style={{ marginTop: 10 }}>
                {log.workout_text && (
                  <pre style={{
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                    padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', marginBottom: 10,
                  }}>
                    {log.workout_text}
                  </pre>
                )}
                <pre style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(log, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </AdminSubPageLayout>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '8px 10px', color: 'var(--text)' };
