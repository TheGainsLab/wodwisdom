/**
 * /admin/program-score — Methodology Adherence Score, Phase 1 test console.
 *
 * Admin-only while we validate the pipeline. Paste a program → Sonnet parses
 * it into days/pieces → the confirm card shows exactly what was read (the
 * ratification gate — piece types are editable here) → score runs the
 * deterministic analyzer + rubric → the report shows the overall score,
 * the four dimension cards with evidence, and the findings.
 *
 * Nothing is persisted: the parsed structure lives in this page's state
 * between parse and score.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Nav from '../components/Nav';
import '../features.css';

// Must match FUNCTION_VERSION in supabase/functions/score-program/index.ts.
const EXPECTED_FUNCTION_VERSION = '2026-10-19.1';

const PIECE_TYPES = ['strength', 'metcon', 'skills', 'accessory', 'warm-up', 'cool-down', 'mobility', 'other'] as const;
type PieceType = typeof PIECE_TYPES[number];

interface ParsedTask { movement: string; sets?: number | null; reps?: number | string | null; weight?: number | null; percentage?: number | null; category?: string | null }
interface Piece { type: PieceType; text: string; tasks: ParsedTask[]; notes?: string }
interface Day { week_num: number; day_num: number; label?: string; pieces: Piece[] }
interface Program { days: Day[] }
interface ReadBack { days: number; weeks: number; pieces: number; by_type: Record<string, number>; notes: string[] }
interface Dimension { key: string; label: string; score: number | null; excluded_reason?: string; verdict: string; evidence: string[] }
interface Rubric { overall: number | null; scored_dimensions: number; total_dimensions: number; dimensions: Dimension[]; findings: string[]; window: { days: number; weeks: number } }
interface Analysis { modal_balance: Record<string, number>; time_domains: Record<string, number>; workout_formats: Record<string, number>; movement_frequency: { name: string; count: number; modality: string }[]; consecutive_overlaps: { days: string; movements: string[] }[] }

async function invokeScore(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error: err } = await supabase.functions.invoke('score-program', { body });
  if (err) {
    let msg = err.message ?? 'function call failed';
    const ctx = (err as { context?: Response }).context;
    if (ctx) {
      let detail = '';
      if (typeof ctx.json === 'function') {
        try { const b = await ctx.json(); if (b?.error) detail = String(b.error); } catch { /* non-JSON */ }
      }
      msg = `${detail || msg} (HTTP ${ctx.status}${ctx.status === 404 ? ' — function not deployed?' : ''})`;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(String(data.error));
  return data ?? {};
}

// W / G / M identities — fixed per modality on every chart in the product.
const MODAL_COLORS: Record<string, string> = {
  Weightlifting: '#4e7fe0',
  Gymnastics: '#bb8628',
  Monostructural: '#2f9f87',
};

const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)', padding: '16px 18px', marginTop: 14 };
const dimName: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-dim)' };
const noteStyle: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8, borderLeft: '2px solid var(--border)', paddingLeft: 10 };
const btn: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 20px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const chip: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 10px', background: 'var(--bg)' };

function TimeDomainBars({ td }: { td: Record<string, number> }) {
  const buckets: [string, string][] = [['short', 'Short <8 min'], ['medium', 'Medium 8–15'], ['long', 'Long >15 min']];
  const max = Math.max(1, ...buckets.map(([k]) => td[k] ?? 0));
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', height: 120, marginTop: 14 }}>
      {buckets.map(([k, label]) => {
        const n = td[k] ?? 0;
        return (
          <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: n > 0 ? 'var(--text)' : 'var(--text-muted)' }}>{n}</span>
            <div style={{ width: '70%', borderRadius: '4px 4px 0 0', background: '#6e6e8a', height: n > 0 ? `${Math.round((n / max) * 72)}%` : 3, minHeight: 3, opacity: n > 0 ? 1 : 0.4 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ModalBar({ mb }: { mb: Record<string, number> }) {
  const entries = Object.entries(MODAL_COLORS).map(([k, c]) => [k, mb[k] ?? 0, c] as const);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 2, borderRadius: 6, overflow: 'hidden', height: 26 }}>
        {entries.filter(([, n]) => n > 0).map(([k, n, c]) => (
          <div key={k} style={{ width: `${(n / total) * 100}%`, background: c, minWidth: 4 }} title={`${k} ${Math.round((n / total) * 100)}%`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 8, fontSize: 12.5, color: 'var(--text-dim)' }}>
        {entries.map(([k, n, c]) => (
          <span key={k}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: c, marginRight: 6 }} />{k} <b style={{ color: 'var(--text)' }}>{Math.round((n / total) * 100)}%</b></span>
        ))}
      </div>
    </div>
  );
}

export default function AdminProgramScorePage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [step, setStep] = useState<'input' | 'confirm' | 'report'>('input');
  const [text, setText] = useState('');
  const [program, setProgram] = useState<Program | null>(null);
  const [readBack, setReadBack] = useState<ReadBack | null>(null);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [versionWarning, setVersionWarning] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => setRole(data?.role ?? 'user'));
  }, [session.user.id]);

  const onParse = async () => {
    setError('');
    setBusy('Parsing the program… (one Sonnet call)');
    try {
      const out = await invokeScore({ action: 'parse', text });
      if (out.version && out.version !== EXPECTED_FUNCTION_VERSION) {
        setVersionWarning(`Function version ${out.version} ≠ expected ${EXPECTED_FUNCTION_VERSION} — redeploy score-program.`);
      }
      setProgram(out.program as Program);
      setReadBack(out.read_back as ReadBack);
      setStep('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onScore = async () => {
    if (!program) return;
    setError('');
    setBusy('Scoring… (deterministic, zero tokens)');
    try {
      const out = await invokeScore({ action: 'score', program });
      setRubric(out.rubric as Rubric);
      setAnalysis(out.analysis as Analysis);
      setStep('report');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const setPieceType = (dayIdx: number, pieceIdx: number, type: PieceType) => {
    if (!program) return;
    const next: Program = { days: program.days.map((d, di) => di !== dayIdx ? d : ({ ...d, pieces: d.pieces.map((p, pi) => pi !== pieceIdx ? p : { ...p, type }) })) };
    setProgram(next);
  };

  const reset = () => { setStep('input'); setProgram(null); setReadBack(null); setRubric(null); setAnalysis(null); setError(''); };

  if (role !== null && role !== 'admin') {
    return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Admin only.</div>;
  }

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Methodology Adherence Score</h1>
        </header>

        {/* page-body is the app's scroll container — body is overflow:hidden app-wide. */}
        <div className="page-body" style={{ padding: '0 20px 60px', maxWidth: 780 }}>
        <p style={{ fontSize: 13.5, color: 'var(--text-dim)', margin: '14px 0 20px', lineHeight: 1.5 }}>
          Admin test tool. Paste a program → confirm what was read → score. Nothing is saved.
        </p>

        {versionWarning && <div style={{ ...card, borderColor: 'var(--accent)', fontSize: 13 }}>{versionWarning}</div>}
        {error && <div style={{ ...card, borderColor: 'var(--accent)', color: 'var(--text)', fontSize: 13.5 }}>{error}</div>}
        {busy && <div style={{ ...card, fontSize: 13.5, color: 'var(--text-dim)' }}>{busy}</div>}

        {step === 'input' && (
          <>
            <textarea
              id="program-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              placeholder={'Paste the program text — any format. Example:\n\nMonday\nBack squat 5x5 @ 225\nAMRAP 12: 10 KB swings 53#, 12 wall balls, 200m run\n\nTuesday\n…'}
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, lineHeight: 1.5 }}
            />
            <div style={{ marginTop: 12 }}>
              <button style={btn} disabled={!text.trim() || !!busy} onClick={onParse}>Parse program</button>
            </div>
          </>
        )}

        {step === 'confirm' && program && readBack && (
          <>
            <div style={{ ...card, borderColor: 'var(--accent)' }}>
              <div style={dimName}>Confirm the read</div>
              <p style={{ fontSize: 14.5, margin: '8px 0 0', lineHeight: 1.55 }}>
                I read <b>{readBack.days} training day{readBack.days === 1 ? '' : 's'}</b> across {readBack.weeks} week{readBack.weeks === 1 ? '' : 's'}, <b>{readBack.pieces} pieces</b>: {Object.entries(readBack.by_type).map(([t, n]) => `${n} ${t}`).join(', ')}.
              </p>
              {readBack.notes.length > 0 && (
                <div style={noteStyle}>{readBack.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}</div>
              )}
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                Fix any mis-typed piece below, then score. Nothing is scored off an unconfirmed read.
              </p>
            </div>

            {program.days.map((day, di) => (
              <div key={di} style={card}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {day.label || `Day ${day.day_num}`}{readBack.weeks > 1 ? ` · Week ${day.week_num}` : ''}
                </div>
                {day.pieces.map((p, pi) => (
                  <div key={pi} style={{ borderTop: pi > 0 ? '1px solid var(--border)' : 'none', marginTop: 10, paddingTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <select
                        id={`piece-type-${di}-${pi}`}
                        value={p.type}
                        onChange={(e) => setPieceType(di, pi, e.target.value as PieceType)}
                        style={{ fontSize: 12, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
                      >
                        {PIECE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {p.tasks.map((t, ti) => (
                          <span key={ti} style={chip}>
                            {t.movement}{t.weight ? ` ${t.weight}` : t.percentage ? ` ${t.percentage}%` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                    <pre style={{ fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '8px 0 0', lineHeight: 1.5 }}>{p.text}</pre>
                  </div>
                ))}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button style={btn} disabled={!!busy} onClick={onScore}>Looks right — score it</button>
              <button style={btnGhost} disabled={!!busy} onClick={reset}>Start over</button>
            </div>
          </>
        )}

        {step === 'report' && rubric && analysis && (
          <>
            <div style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 28px' }}>
              <div>
                <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {rubric.overall ?? '—'}<span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 600 }}>/100</span>
                </div>
                <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-dim)', marginTop: 4 }}>Adherence score</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 220 }}>
                {rubric.dimensions.map((d) => (
                  <div key={d.key} style={{ flex: 1, minWidth: 100, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)', opacity: d.score === null ? 0.55 : 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{d.score ?? '—'}</div>
                    <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>{d.label}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, margin: 0, width: '100%' }}>
                Scored on {rubric.scored_dimensions} of {rubric.total_dimensions} computed dimensions over {rubric.window.days} day{rubric.window.days === 1 ? '' : 's'} ({rubric.window.weeks} week{rubric.window.weeks === 1 ? '' : 's'}). Excluded dimensions never count against the program.
              </p>
            </div>

            {rubric.dimensions.map((d) => (
              <div key={d.key} style={{ ...card, ...(d.score === null ? { borderStyle: 'dashed', background: 'transparent' } : {}) }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={dimName}>{d.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: d.score === null ? 11 : 20, fontWeight: d.score === null ? 600 : 800, color: d.score === null ? 'var(--text-muted)' : 'var(--text)', textTransform: d.score === null ? 'uppercase' : 'none', letterSpacing: d.score === null ? 0.6 : 0, fontVariantNumeric: 'tabular-nums' }}>
                    {d.score === null ? d.excluded_reason : d.score}
                  </span>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.55, margin: '8px 0 0', color: d.score === null ? 'var(--text-dim)' : 'var(--text)' }}>{d.verdict}</p>
                {d.key === 'time_domain_variance' && d.score !== null && <TimeDomainBars td={analysis.time_domains} />}
                {d.key === 'modal_balance' && d.score !== null && <ModalBar mb={analysis.modal_balance} />}
                {d.evidence.length > 0 && (
                  <div style={noteStyle}><b style={{ color: 'var(--text-dim)' }}>Evidence:</b> {d.evidence.map((e, i) => <div key={i}>{e}</div>)}</div>
                )}
              </div>
            ))}

            {rubric.findings.length > 0 && (
              <div style={card}>
                <div style={dimName}>What would move the score</div>
                {rubric.findings.map((f, i) => (
                  <p key={i} style={{ fontSize: 14, lineHeight: 1.5, margin: '10px 0 0' }}>· {f}</p>
                ))}
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Findings, not edits — applying changes is a later phase.</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button style={btnGhost} onClick={() => setStep('confirm')}>Back to the read</button>
              <button style={btn} onClick={reset}>Score another program</button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
