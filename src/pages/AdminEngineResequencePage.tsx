import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import AdminSubPageLayout from '../components/admin/AdminSubPageLayout';

// What engine-resequence returns in admin preview (dry-run) mode.
interface GeneratedBlock { [k: string]: unknown }
interface ProposedDay { day_type: string; reason: string; blocks: GeneratedBlock[] }
interface PreviewResult {
  skipped?: boolean;
  reason?: string;
  dry_run?: boolean;
  currentDay?: number;
  currentPhase?: number;
  maxDays?: number;
  summary?: string;
  diagnosis?: string;
  proposed?: ProposedDay[];
  accepted?: ProposedDay[];
  validation_errors?: string[];
  raw_ai_output?: string;
  error?: string;
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminEngineResequencePage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function runPreview() {
    if (!id) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('engine-resequence', {
        body: { target_user_id: id, dry_run: true },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setResult(data as PreviewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const accepted = result?.accepted ?? [];
  const currentDay = result?.currentDay ?? 0;

  return (
    <AdminSubPageLayout session={session} userId={id ?? ''} title="Engine AI Preview">
      <p style={{ color: '#888', marginBottom: 16 }}>
        Runs the AI self-sequencer against this athlete's real data <strong>without applying anything</strong>.
        Shows what the AI found (diagnosis) and the exact days it would generate for the upcoming positions.
      </p>

      <button
        onClick={runPreview}
        disabled={loading}
        style={{
          padding: '10px 18px', borderRadius: 8, border: 'none', cursor: loading ? 'default' : 'pointer',
          background: loading ? '#444' : '#f0a050', color: '#111', fontWeight: 600,
        }}
      >
        {loading ? 'Running AI…' : 'Run AI Preview'}
      </button>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#3a1a1a', borderRadius: 8, color: '#f99' }}>
          {error}
        </div>
      )}

      {result?.skipped && (
        <div style={{ marginTop: 16, padding: 12, background: '#2a2a1a', borderRadius: 8, color: '#dd9' }}>
          Sequencer skipped: {result.reason}
        </div>
      )}

      {result && !result.skipped && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <Stat label="Current day" value={currentDay} />
            <Stat label="Phase" value={result.currentPhase ?? '—'} />
            <Stat label="Days generated" value={accepted.length} sub={`of ${result.maxDays ?? '?'} requested`} />
          </div>

          {result.summary && (
            <Section title="AI rationale">
              <div style={{ color: '#ccc' }}>{result.summary}</div>
            </Section>
          )}

          <Section title="What the AI found (diagnosis)">
            <pre style={preStyle}>{result.diagnosis?.trim() || 'No diagnosis produced.'}</pre>
          </Section>

          <Section title={`Proposed sequence — would replace positions ${currentDay}–${currentDay + accepted.length - 1}`}>
            {accepted.length === 0 && <div style={{ color: '#999' }}>No days passed validation.</div>}
            {accepted.map((d, i) => (
              <div key={i} style={{ border: '1px solid #333', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: '#f0a050' }}>
                  Day {currentDay + i} — {humanize(d.day_type)}
                </div>
                <div style={{ color: '#bbb', fontSize: 13, margin: '4px 0 8px' }}>{d.reason}</div>
                {d.blocks.map((b, bi) => (
                  <pre key={bi} style={{ ...preStyle, marginTop: 4 }}>
                    block {bi + 1}: {JSON.stringify(b)}
                  </pre>
                ))}
              </div>
            ))}
          </Section>

          {result.validation_errors && result.validation_errors.length > 0 && (
            <Section title="Rejected by validator (kept inside the envelope)">
              <ul style={{ color: '#f99', fontSize: 13 }}>
                {result.validation_errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </Section>
          )}

          <button onClick={() => setShowRaw((v) => !v)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#88a', cursor: 'pointer' }}>
            {showRaw ? 'Hide' : 'Show'} raw AI output
          </button>
          {showRaw && <pre style={preStyle}>{result.raw_ai_output}</pre>}
        </div>
      )}
    </AdminSubPageLayout>
  );
}

const preStyle: React.CSSProperties = {
  background: '#16181d', border: '1px solid #2a2d34', borderRadius: 6, padding: 10,
  color: '#cdd', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 14, color: '#eee', marginBottom: 8 }}>{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: '#1a1d23', borderRadius: 8, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#777' }}>{sub}</div>}
    </div>
  );
}
