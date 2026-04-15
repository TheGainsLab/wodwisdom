import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatMarkdown } from '../lib/formatMarkdown';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Types ────────────────────────────────────────────────────────────

type EvalType = 'profile' | 'training' | 'nutrition';

interface EvalSummary {
  id: string;
  created_at: string;
  month_number?: number | null;
  program_id?: string | null;
  visible?: boolean | null;
}

interface EvalDetail {
  id: string;
  created_at: string;
  analysis: string | null;
  profile_snapshot?: any;
  training_snapshot?: string | null;
  nutrition_snapshot?: any;
  month_number?: number | null;
  program_id?: string | null;
  visible?: boolean | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

const TYPE_LABEL: Record<EvalType, string> = {
  profile: 'Profile Evaluations',
  training: 'Training Evaluations',
  nutrition: 'Nutrition Evaluations',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminEvaluationsPage({ session }: { session: Session }) {
  const { id, evalType: routeType, evalId: routeEvalId } = useParams<{
    id: string; evalType?: string; evalId?: string;
  }>();
  const navigate = useNavigate();

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [list, setList] = useState<Record<EvalType, EvalSummary[]>>({
    profile: [], training: [], nutrition: [],
  });

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<EvalDetail | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Fetch sidebar list
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingList(true);
      const { data, error } = await supabase.rpc('admin_list_evaluations', { target_user_id: id });
      if (error) setListError(error.message);
      else if (data) setList(data as Record<EvalType, EvalSummary[]>);
      setLoadingList(false);
    })();
  }, [id]);

  // Auto-select the first eval if none in the URL and the list has loaded
  const firstAvailable = useMemo(() => {
    if (list.profile.length > 0) return { type: 'profile' as EvalType, id: list.profile[0].id };
    if (list.training.length > 0) return { type: 'training' as EvalType, id: list.training[0].id };
    if (list.nutrition.length > 0) return { type: 'nutrition' as EvalType, id: list.nutrition[0].id };
    return null;
  }, [list]);

  useEffect(() => {
    if (loadingList) return;
    if (routeType && routeEvalId) return;
    if (firstAvailable && id) {
      navigate(`/admin/users/${id}/evaluations/${firstAvailable.type}/${firstAvailable.id}`, { replace: true });
    }
  }, [loadingList, firstAvailable, id, navigate, routeType, routeEvalId]);

  // Fetch detail for the selected eval
  useEffect(() => {
    if (!id || !routeType || !routeEvalId) {
      setDetail(null);
      return;
    }
    (async () => {
      setLoadingDetail(true);
      setDetailError('');
      const { data, error } = await supabase.rpc('admin_get_evaluation', {
        target_user_id: id,
        eval_type: routeType,
        evaluation_id: routeEvalId,
      });
      if (error) setDetailError(error.message);
      else setDetail(data as EvalDetail | null);
      setLoadingDetail(false);
      setShowRaw(false);
    })();
  }, [id, routeType, routeEvalId]);

  const selectedType = routeType as EvalType | undefined;
  const selectedId = routeEvalId;
  const totalEvals =
    list.profile.length + list.training.length + list.nutrition.length;

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Evaluations">
      {loadingList && <div className="page-loading"><div className="loading-pulse" /></div>}

      {listError && (
        <div className="auth-error" style={{ display: 'block', marginBottom: 16 }}>{listError}</div>
      )}

      {!loadingList && totalEvals === 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)',
        }}>
          No evaluations generated yet.
        </div>
      )}

      {!loadingList && totalEvals > 0 && (
        <div className="admin-eval-layout" style={{
          display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start',
        }}>
          {/* Sidebar */}
          <aside style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 12, position: 'sticky', top: 12,
            maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto',
          }}>
            {(['profile', 'training', 'nutrition'] as EvalType[]).map(type => (
              <div key={type} style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: 0.8, color: 'var(--text-muted)',
                  padding: '4px 8px', marginBottom: 4,
                }}>
                  {TYPE_LABEL[type]} ({list[type].length})
                </div>
                {list[type].length === 0 ? (
                  <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)' }}>none</div>
                ) : (
                  list[type].map(e => {
                    const isSel = selectedType === type && selectedId === e.id;
                    return (
                      <button
                        key={e.id}
                        onClick={() => navigate(`/admin/users/${id}/evaluations/${type}/${e.id}`)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          background: isSel ? 'var(--accent-glow)' : 'transparent',
                          border: 'none', color: isSel ? 'var(--accent)' : 'var(--text)',
                          padding: '6px 8px', borderRadius: 6, fontSize: 12,
                          cursor: 'pointer', fontFamily: "'Outfit', sans-serif",
                          marginBottom: 2,
                        }}
                      >
                        {e.month_number != null ? `Month ${e.month_number} · ` : ''}
                        {formatDate(e.created_at)}
                        {e.visible === false && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>(hidden)</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ))}
          </aside>

          {/* Detail pane */}
          <section style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 20, minHeight: 300,
          }}>
            {loadingDetail && <div className="loading-pulse" />}

            {detailError && (
              <div className="auth-error" style={{ display: 'block' }}>{detailError}</div>
            )}

            {!loadingDetail && !detail && !detailError && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Select an evaluation from the sidebar.
              </div>
            )}

            {detail && selectedType && (
              <>
                {/* Metadata header */}
                <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {TYPE_LABEL[selectedType].replace(/s$/, '')}
                    {detail.month_number != null && ` — Month ${detail.month_number}`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Generated {formatDateTime(detail.created_at)}
                    {detail.visible === false && ' · Hidden from user'}
                  </div>
                </div>

                {/* Analysis body */}
                {detail.analysis ? (
                  <div
                    className="workout-review-content"
                    dangerouslySetInnerHTML={{ __html: formatMarkdown(detail.analysis) }}
                  />
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    No analysis content.
                  </div>
                )}

                {/* Raw context — collapsible */}
                <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setShowRaw(v => !v)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', fontSize: 12, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: 0.5, padding: 0,
                    }}
                  >
                    {showRaw ? '▾' : '▸'} Raw context sent to LLM
                  </button>

                  {showRaw && (
                    <div style={{ marginTop: 12 }}>
                      {detail.profile_snapshot && Object.keys(detail.profile_snapshot).length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Profile Snapshot
                          </div>
                          <pre style={{
                            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                            padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                          }}>
                            {JSON.stringify(detail.profile_snapshot, null, 2)}
                          </pre>
                        </div>
                      )}

                      {detail.training_snapshot && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Training Snapshot
                          </div>
                          <pre style={{
                            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                            padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                          }}>
                            {detail.training_snapshot}
                          </pre>
                        </div>
                      )}

                      {detail.nutrition_snapshot && Object.keys(detail.nutrition_snapshot).length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                            Nutrition Snapshot
                          </div>
                          <pre style={{
                            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                            padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            overflowX: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap',
                          }}>
                            {JSON.stringify(detail.nutrition_snapshot, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .admin-eval-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </AdminSubPageLayout>
  );
}
