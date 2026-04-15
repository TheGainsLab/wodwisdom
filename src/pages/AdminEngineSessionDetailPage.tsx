import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// ── Helpers ──────────────────────────────────────────────────────────

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1) return value.toFixed(3);
  if (abs < 10) return value.toFixed(2);
  return value.toFixed(1);
}

function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ── Components ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{
        fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.8, color: 'var(--text-muted)', marginBottom: 8,
      }}>{title}</h3>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" }}>{value ?? '—'}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminEngineSessionDetailPage({ session }: { session: Session }) {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!id || !sessionId) return;
    (async () => {
      setLoading(true);
      const { data: result, error: err } = await supabase.rpc('admin_get_engine_session', {
        target_user_id: id,
        session_id: sessionId,
      });
      if (err) setError(err.message);
      else setData(result);
      setLoading(false);
    })();
  }, [id, sessionId]);

  const unitSuffix = data?.units ? ` ${data.units}` : '';

  return (
    <AdminSubPageLayout session={session} userId={id!} title="Engine Session">
      <button
        onClick={() => navigate(`/admin/users/${id}/engine-sessions`)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-dim)',
          cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 16,
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        ← All sessions
      </button>

      {loading && <div className="page-loading"><div className="loading-pulse" /></div>}
      {error && <div className="auth-error" style={{ display: 'block' }}>{error}</div>}

      {!loading && !data && !error && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          Session not found.
        </div>
      )}

      {data && (
        <>
          {/* Header */}
          <div style={{ marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {humanize(data.day_type)} — {humanize(data.modality)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {formatDateTime(data.created_at)}
              {data.program_day_number != null && ` · Program Day ${data.program_day_number}`}
              {data.program_version && ` · ${data.program_version}`}
              {!data.completed && ' · Not completed'}
            </div>
          </div>

          <Section title="Performance">
            <Row label={`Target Pace (${data.units ?? ''}/min)`} value={formatCompactNumber(data.target_pace)} />
            <Row label={`Actual Pace (${data.units ?? ''}/min)`} value={formatCompactNumber(data.actual_pace)} />
            <Row label="Performance Ratio" value={formatCompactNumber(data.performance_ratio)} />
            <Row label={`Total Output${unitSuffix}`} value={formatCompactNumber(data.total_output)} />
            <Row label={`Calculated Rate (${data.units ?? ''}/min)`} value={formatCompactNumber(data.calculated_rpm)} />
          </Section>

          <Section title="Heart Rate & Effort">
            <Row label="Average HR (bpm)" value={data.average_heart_rate} />
            <Row label="Peak HR (bpm)" value={data.peak_heart_rate} />
            <Row label="RPE" value={data.perceived_exertion} />
          </Section>

          <Section title="Program Context">
            <Row label="Program Day" value={data.program_day} />
            <Row label="Program Day Number" value={data.program_day_number} />
            <Row label="Program Version" value={data.program_version} />
          </Section>

          {/* Raw workout_data */}
          {data.workout_data && Object.keys(data.workout_data).length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button
                onClick={() => setShowRaw(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', fontSize: 12, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: 0.5, padding: 0,
                }}
              >
                {showRaw ? '▾' : '▸'} Raw workout data
              </button>
              {showRaw && (
                <pre style={{
                  marginTop: 10, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  overflowX: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(data.workout_data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </AdminSubPageLayout>
  );
}
