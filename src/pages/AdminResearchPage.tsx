/**
 * /admin/research — the research-library ingestion console.
 *
 * Upload a PDF → ingest-paper drafts the entry → it appears in the queue
 * with its validator report → open it, see it rendered exactly as a reader
 * would, fix the editorial fields in place if needed → Approve publishes it
 * to /knowledge instantly. Reject keeps the row (and the PDF) for the record.
 * No one ever edits JSON by hand.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ensureGlossary, normalizeKnowledgeEntry, type KnowledgeEntry } from '../lib/knowledgeLibrary';
import { KnowledgeEntryView } from './KnowledgeEntryPage';
import Nav from '../components/Nav';
import '../features.css';
import '../qa.css';

interface Row {
  slug: string;
  status: 'drafting' | 'draft' | 'published' | 'rejected' | 'failed';
  entry: KnowledgeEntry;
  validator_report: { errors: string[]; warnings: string[]; model?: string; repaired?: boolean } | null;
  created_at: string;
  published_at: string | null;
}

const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--surface)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 8,
};
const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 4px', display: 'block' };

export default function AdminResearchPage({ session }: { session: Session }) {
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [draft, setDraft] = useState<KnowledgeEntry | null>(null); // editable copy
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => setRole(data?.role ?? 'user'));
  }, [session.user.id]);

  const refresh = async () => {
    const { data, error: err } = await supabase
      .from('knowledge_entries')
      .select('slug, status, entry, validator_report, created_at, published_at')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setRows(((data ?? []) as Row[]).map((r) => ({ ...r, entry: normalizeKnowledgeEntry(r.entry) })));
  };
  useEffect(() => { if (role === 'admin') { refresh(); ensureGlossary(); } }, [role]);

  // While anything is drafting in the background, poll for it to land.
  const anyDrafting = rows.some((r) => r.status === 'drafting');
  useEffect(() => {
    if (!anyDrafting) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [anyDrafting]);

  const onUpload = async (file: File) => {
    setError('');
    setUploading(`Uploading "${file.name}"…`);
    try {
      // Straight to storage (no base64-through-the-function), so file size
      // is never capped by the function's request body.
      const storagePath = `${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from('knowledge-pdfs')
        .upload(storagePath, file, { contentType: 'application/pdf' });
      if (upErr) throw new Error(`upload failed: ${upErr.message}`);
      const { data, error: err } = await supabase.functions.invoke('ingest-paper', {
        body: { storage_path: storagePath },
      });
      if (err) {
        // The function always says WHY in its JSON body; surface that, never
        // the generic "non-2xx" string.
        let msg = err.message ?? 'ingestion failed';
        const ctx = (err as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) msg = `${body.error} (HTTP ${ctx.status})`;
          } catch { /* keep generic message */ }
        }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      await refresh();
      setUploading(null); // the queue now shows a 'drafting' row that polls itself in
    } catch (e) {
      setUploading(null);
      setError(e instanceof Error ? e.message : 'Ingestion failed');
    }
  };

  const open = (r: Row) => {
    setSelected(r);
    // The shared boundary normalizer guarantees the full entry shape, so
    // the preview and the edit form can never crash on a deviant draft.
    setDraft(normalizeKnowledgeEntry(JSON.parse(JSON.stringify(r.entry))));
  };

  const deleteEntry = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.slug}" permanently? This removes it from the library${selected.status === 'published' ? ' — it is currently LIVE' : ''}.`)) return;
    setSaving(true);
    setError('');
    const { data: row } = await supabase.from('knowledge_entries').select('source_pdf_path').eq('slug', selected.slug).maybeSingle();
    const { error: err } = await supabase.from('knowledge_entries').delete().eq('slug', selected.slug);
    if (!err && row?.source_pdf_path) {
      await supabase.storage.from('knowledge-pdfs').remove([row.source_pdf_path]);
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSelected(null);
    setDraft(null);
    await refresh();
  };

  const saveEntry = async (status?: 'published' | 'rejected') => {
    if (!selected || !draft) return;
    if (status === 'published' && (selected.validator_report?.errors?.length ?? 0) > 0) {
      const ok = window.confirm(
        `This draft had ${selected.validator_report!.errors.length} validator error(s) when drafted — publish anyway?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    const patch: Record<string, unknown> = { entry: draft, updated_at: new Date().toISOString() };
    if (status) {
      patch.status = status;
      if (status === 'published') patch.published_at = new Date().toISOString();
    }
    const { error: err } = await supabase.from('knowledge_entries').update(patch).eq('slug', selected.slug);
    if (!err && status === 'published') await mergeGlossary(draft);
    setSaving(false);
    if (err) { setError(err.message); return; }
    await refresh();
    if (status) { setSelected(null); setDraft(null); }
  };

  // Publish-time glossary merge: first definition wins, alternates recorded
  // for reconciliation — the same rule build.py used for the founding twelve.
  const mergeGlossary = async (entry: KnowledgeEntry) => {
    const candidates = entry.glossary_candidates ?? [];
    for (const g of candidates) {
      if (!g?.term || !g?.definition) continue;
      const key = g.term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key) continue;
      const { data: existing } = await supabase
        .from('knowledge_glossary')
        .select('term_key, definition, sources, alt_definitions')
        .eq('term_key', key)
        .maybeSingle();
      if (!existing) {
        await supabase.from('knowledge_glossary').insert({
          term_key: key, term: g.term, definition: g.definition,
          status: 'candidate', sources: [entry.slug], alt_definitions: [],
        });
      } else {
        const sources: string[] = Array.isArray(existing.sources) ? existing.sources : [];
        const alts: Array<{ entry: string; definition: string }> =
          Array.isArray(existing.alt_definitions) ? existing.alt_definitions : [];
        if (!sources.includes(entry.slug)) sources.push(entry.slug);
        if (existing.definition !== g.definition && !alts.some((a) => a.entry === entry.slug)) {
          alts.push({ entry: entry.slug, definition: g.definition });
        }
        await supabase.from('knowledge_glossary').update({
          sources, alt_definitions: alts, updated_at: new Date().toISOString(),
        }).eq('term_key', key);
      }
    }
  };

  const setHeader = (k: string, v: unknown) => draft && setDraft({ ...draft, header: { ...draft.header, [k]: v } });
  const setL2 = (k: string, v: string) => draft && setDraft({ ...draft, layer2: { ...draft.layer2, [k]: v } });
  const lines = (xs: string[]) => xs.join('\n');
  const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  if (role !== null && role !== 'admin') {
    return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Access denied.</div>;
  }

  const isStudy = draft?.shape === 'intervention' || draft?.shape === 'comparison';
  const report = selected?.validator_report;

  return (
    <div className="app-layout">
      <Nav isOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <button className="menu-btn" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <h1>Research Library</h1>
        </header>

        <div style={{ padding: '0 20px 60px', maxWidth: 920 }}>
          {error && <div style={{ color: 'var(--accent)', fontSize: 13, margin: '10px 0' }}>{error}</div>}

          {!selected && (
            <>
              {/* Upload */}
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (uploading) return;
                  const f = e.dataTransfer.files?.[0];
                  if (!f) return;
                  if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
                    setError('PDFs only — that file is ' + (f.type || 'not a PDF'));
                    return;
                  }
                  onUpload(f);
                }}
                style={{
                  display: 'block', border: '2px dashed var(--border)', borderRadius: 12,
                  padding: '26px 20px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer',
                  color: 'var(--text-dim)', fontSize: 14, margin: '16px 0 24px',
                }}
              >
                {uploading ?? 'Drop a paper here or click to choose a PDF — the entry drafts itself.'}
                <input
                  type="file" accept="application/pdf" style={{ display: 'none' }} disabled={!!uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
                />
              </label>

              {/* Queue */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((r) => (
                  <button key={r.slug} onClick={() => open(r)} style={{
                    textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '12px 14px', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
                  }}>
                    {!!r.entry.header.citation?.title && r.entry.header.citation.title !== 'not printed in source' && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', lineHeight: 1.4, marginBottom: 3 }}>
                        {r.entry.header.citation.title}
                      </div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{r.entry.header.title_plain}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontWeight: 700,
                        color: r.status === 'published' ? '#4ade80'
                          : r.status === 'failed' ? 'var(--accent)'
                          : r.status === 'rejected' ? 'var(--text-muted)'
                          : r.status === 'drafting' ? '#a5b4fc'
                          : '#fdba74',
                      }}>{r.status === 'drafting' ? 'drafting…' : r.status}</span>
                      {r.status === 'drafting' && Date.now() - new Date(r.created_at).getTime() > 12 * 60_000 && (
                        <span style={{ color: 'var(--accent)' }}>stalled? open it and delete, then re-upload</span>
                      )}
                      <span>{r.slug}</span>
                      {r.validator_report && (
                        <span>
                          {r.validator_report.errors.length} errors · {r.validator_report.warnings.length} warnings
                          {r.validator_report.repaired ? ' · repaired' : ''}
                        </span>
                      )}
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
                {rows.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No entries yet.</div>}
              </div>
            </>
          )}

          {selected && draft && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0', flexWrap: 'wrap' }}>
                <button onClick={() => { setSelected(null); setDraft(null); }} style={{ ...field, width: 'auto', cursor: 'pointer' }}>← Queue</button>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{selected.slug} · {selected.status}</span>
                <div style={{ flex: 1 }} />
                <button disabled={saving} onClick={() => saveEntry()} style={{ ...field, width: 'auto', cursor: 'pointer' }}>Save edits</button>
                {selected.status !== 'published' && selected.status !== 'failed' && selected.status !== 'drafting' && (
                  <button disabled={saving} onClick={() => saveEntry('published')} style={{ ...field, width: 'auto', cursor: 'pointer', borderColor: '#4ade80', color: '#4ade80', fontWeight: 700 }}>
                    Approve &amp; publish
                  </button>
                )}
                {(selected.status === 'draft' || selected.status === 'failed') && (
                  <button disabled={saving} onClick={() => saveEntry('rejected')} style={{ ...field, width: 'auto', cursor: 'pointer', color: 'var(--text-muted)' }}>Reject</button>
                )}
                <button disabled={saving} onClick={deleteEntry} style={{ ...field, width: 'auto', cursor: 'pointer', borderColor: 'var(--accent)', color: 'var(--accent)' }}>Delete</button>
              </div>

              {report && (report.errors.length > 0 || report.warnings.length > 0) && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, lineHeight: 1.6 }}>
                  {report.errors.map((m, i) => <div key={`e${i}`} style={{ color: 'var(--accent)' }}>ERROR — {m}</div>)}
                  {report.warnings.map((m, i) => <div key={`w${i}`} style={{ color: '#fdba74' }}>warn — {m}</div>)}
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>model: {report.model}{report.repaired ? ' · after one repair round' : ''}</div>
                </div>
              )}

              {/* A failed row has only a stub entry — report and Reject, no preview. */}
              {!!draft.layer1 && (
              <>
              {/* Editorial fields — the judgment seats. Layer-1 extraction
                  problems are a reject-and-reingest, not a hand edit. */}
              <details style={{ marginBottom: 20 }}>
                <summary style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--text)' }}>Edit editorial fields</summary>
                <span style={label}>Headline (title_plain)</span>
                <input style={field} value={draft.header.title_plain} onChange={(e) => setHeader('title_plain', e.target.value)} />
                {isStudy && (
                  <>
                    <span style={label}>Lede (setup_plain)</span>
                    <textarea style={{ ...field, minHeight: 70 }} value={draft.header.setup_plain ?? ''} onChange={(e) => setHeader('setup_plain', e.target.value)} />
                  </>
                )}
                <span style={label}>Key findings (one per line)</span>
                <textarea style={{ ...field, minHeight: 110 }} value={lines(draft.key_findings ?? [])} onChange={(e) => setDraft({ ...draft, key_findings: unlines(e.target.value) })} />
                <span style={label}>Confidence — level and why</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select style={{ ...field, width: 150 }} value={draft.header.confidence.level} onChange={(e) => setHeader('confidence', { ...draft.header.confidence, level: e.target.value })}>
                    {['strong', 'moderate', 'preliminary', 'conceptual', 'reference'].map((v) => <option key={v}>{v}</option>)}
                  </select>
                  <input style={field} value={draft.header.confidence.why} onChange={(e) => setHeader('confidence', { ...draft.header.confidence, why: e.target.value })} />
                </div>
                <span style={label}>Relevance — level and why</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select style={{ ...field, width: 150 }} value={draft.header.practical_relevance.level} onChange={(e) => setHeader('practical_relevance', { ...draft.header.practical_relevance, level: e.target.value })}>
                    {['high', 'medium', 'low'].map((v) => <option key={v}>{v}</option>)}
                  </select>
                  <input style={field} value={draft.header.practical_relevance.why} onChange={(e) => setHeader('practical_relevance', { ...draft.header.practical_relevance, why: e.target.value })} />
                </div>
                <span style={label}>What it means</span>
                <textarea style={{ ...field, minHeight: 100 }} value={draft.layer2.what_it_means} onChange={(e) => setL2('what_it_means', e.target.value)} />
                <span style={label}>What it doesn&apos;t mean</span>
                <textarea style={{ ...field, minHeight: 100 }} value={draft.layer2.what_it_doesnt_mean} onChange={(e) => setL2('what_it_doesnt_mean', e.target.value)} />
                <span style={label}>Say it to a member (one per line)</span>
                <textarea style={{ ...field, minHeight: 70 }} value={lines(draft.translation)} onChange={(e) => setDraft({ ...draft, translation: unlines(e.target.value) })} />
              </details>

              {/* Exactly what a reader will see. */}
              <div className="feature-page" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '8px 18px 24px' }}>
                <div className="qa-entry-container">
                  <KnowledgeEntryView entry={draft} signedIn />
                </div>
              </div>
              </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
