import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchKnowledgeIndex, topicLabel, type KnowledgeIndexRow } from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import KnowledgeDiscuss, { renderAssistantHtml } from '../components/KnowledgeDiscuss';
import '../features.css';
import '../qa.css';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';
import { supabase } from '../lib/supabase';

/**
 * "Schumann et al. (2022)" — card-level provenance. A card needs "real
 * paper, real year", not the full roster; the complete citation stays on
 * the entry page's ABOUT THIS PAPER.
 */
function shortCitation(authors: string, year: string): string {
  if (!authors || /not printed/i.test(authors)) return year ? `(${year})` : '';
  const parts = authors.split(',');
  const surname = parts[0].trim().split(/\s+/)[0];
  return `${surname}${parts.length > 1 ? ' et al.' : ''}${year ? ` (${year})` : ''}`;
}

/** A saved research conversation, as "My research" lists it. */
type MyThread = {
  slug: string;
  questionCount: number;
  updatedAt: string;
  lastQuestion: string;
  messages: Array<{ role: string; content: string }>;
};

/** How many papers the landing page shows before "show all". */
const DEFAULT_VISIBLE_PAPERS = 20;

/**
 * /knowledge — the research library list. Free to browse, no account.
 * index.json arrives pre-sorted by practical relevance (high → low) then
 * title; render order is file order.
 */
export default function KnowledgeListPage({ signedIn = false }: { signedIn?: boolean }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<KnowledgeIndexRow[] | null>(null);
  const [myThreads, setMyThreads] = useState<MyThread[]>([]);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [myResearchOpen, setMyResearchOpen] = useState(false);
  const [showAllPapers, setShowAllPapers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchKnowledgeIndex().then((rows) => { if (!cancelled) setIndex(rows); });
    logKnowledgeEvent('list_view');
    return () => { cancelled = true; };
  }, []);

  // My research — the member's saved threads (RLS: own rows only). The last
  // question is the scannable line; the thread itself reopens on the paper's
  // page (or in the Ask-the-library panel above for the `_library` thread).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('knowledge_conversations')
        .select('slug, question_count, updated_at, messages')
        .order('updated_at', { ascending: false });
      if (cancelled || !data) return;
      setMyThreads(data.map((r) => {
        const msgs = Array.isArray(r.messages) ? r.messages as Array<{ role: string; content: string }> : [];
        const lastQ = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
        return {
          slug: r.slug as string,
          questionCount: r.question_count || 0,
          updatedAt: r.updated_at as string,
          lastQuestion: lastQ.length > 90 ? lastQ.slice(0, 90) + '…' : lastQ,
          messages: msgs,
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Research Library | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  // No chip row: with search matching topics and Ask-the-library answering
  // open questions, the chips had become 50+ pieces of wallpaper (removed
  // at the founder's call). Topic tags stay in the data — they feed search
  // here and the Ask-the-library router server-side.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (index ?? []).filter((r) => {
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.paper_title.toLowerCase().includes(q) ||
        r.authors.toLowerCase().includes(q) ||
        r.topics.some((t) => topicLabel(t).includes(q))
      );
    });
  }, [index, query]);

  // The library grows fast; the landing page shouldn't. By default show
  // the DEFAULT_VISIBLE_PAPERS most relevant entries (the index arrives
  // sorted by practical relevance) — searching always searches everything
  // and shows every match.
  const searching = query.trim() !== '';
  const capped = !searching && !showAllPapers && matches.length > DEFAULT_VISIBLE_PAPERS;
  const rows = capped ? matches.slice(0, DEFAULT_VISIBLE_PAPERS) : matches;

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <div className="qa-entry-container" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>Research Library</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.55, margin: '0 0 20px' }}>
          Science for coaches and athletes.
        </p>

        {/* Ask the library — same Discuss panel, no slug: the server routes
            the question across the whole catalog and answers from the papers
            that bear on it, with links to each. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: '14px 16px', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2 }}>
            Ask the library
          </div>
          <KnowledgeDiscuss signedIn={signedIn} noHistory />
        </div>

        {/* My research — the ONE home of the member's saved conversations.
            Collapsed to a single header line by default: thread cards grow
            with every paper questioned, and uncollapsed they'd become the
            page's next clutter. */}
        {signedIn && myThreads.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <button
              type="button"
              onClick={() => setMyResearchOpen((v) => !v)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', border: 'none', padding: 0, fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                color: 'var(--accent)', marginBottom: myResearchOpen ? 8 : 0,
              }}
            >
              My research ({myThreads.length}) {myResearchOpen ? '▾' : '▸'}
            </button>
            {myResearchOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myThreads.map((t) => {
                const isLibrary = t.slug === '_library';
                // The meta line is a NAME (first author + year), never the
                // entry's headline — headlines are finding-carrying sentences
                // and drowned the member's own question on these cards.
                const row = index?.find((r) => r.slug === t.slug);
                let name = t.slug;
                if (isLibrary) {
                  name = 'Ask the library';
                } else if (row) {
                  name = shortCitation(row.authors, row.year) || t.slug;
                }
                // My research is the ONE home for conversation history (the
                // Ask panel never replays it). Each card starts collapsed to
                // the member's question; tapping expands the full transcript
                // in place. Paper threads also link out to continue on the
                // paper's page.
                const expanded = expandedThread === t.slug;
                return (
                  <div
                    key={t.slug}
                    style={{
                      padding: '10px 14px', borderRadius: 10,
                      border: '1px solid var(--border)', background: 'var(--surface)',
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedThread(expanded ? null : t.slug)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedThread(expanded ? null : t.slug); } }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.45 }}>
                        {t.lastQuestion ? `“${t.lastQuestion}”` : name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                        {name} · {t.questionCount} {t.questionCount === 1 ? 'question' : 'questions'} · {expanded ? 'hide' : 'view'}
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        {t.messages.map((m, i) => (
                          m.role === 'assistant' ? (
                            <div key={i} className="msg-body assistant" style={{ fontSize: 13, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: renderAssistantHtml(m.content) }} />
                          ) : (
                            <div key={i} className="msg-body user" style={{ alignSelf: 'flex-end', maxWidth: '85%', fontSize: 13 }}>
                              {m.content}
                            </div>
                          )
                        ))}
                        {!isLibrary && (
                          <Link to={`/knowledge/${t.slug}`} style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                            Open this paper →
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles and topics — e.g. sprint, fasted cardio"
          aria-label="Search the research library"
          style={{
            width: '100%', padding: '10px 14px', fontSize: 14, fontFamily: 'inherit',
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20,
          }}
        />


        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => (
            <Link
              key={r.slug}
              to={`/knowledge/${r.slug}`}
              style={{
                display: 'block', padding: '14px 16px', borderRadius: 12,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', textDecoration: 'none',
              }}
            >
              {/* Red eyebrow: the paper's own title marks each card as a real
                  paper and delineates it in the list; the headline below stays
                  the attention line. */}
              {!!r.paper_title && r.paper_title !== 'not printed in source' && (
                <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, color: 'var(--accent)', marginBottom: 4, letterSpacing: 0.2 }}>
                  {r.paper_title}
                </div>
              )}
              <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 }}>
                {r.title}
              </div>
              {/* No badges on list cards (founder's call): inclusion in the
                  library IS the relevance statement, and "confidence:
                  conceptual" misleads without the entry page's context. The
                  judgment still works invisibly — relevance drives the sort.
                  All three badges render on the entry page. */}
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {shortCitation(r.authors, r.year)}{r.journal ? ` · ${r.journal}` : ''}
              </div>
            </Link>
          ))}
          {capped && (
            <button
              type="button"
              onClick={() => setShowAllPapers(true)}
              style={{
                padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px dashed var(--border)', background: 'transparent',
                color: 'var(--text-dim)', fontSize: 13.5,
              }}
            >
              Showing the {DEFAULT_VISIBLE_PAPERS} most relevant of {matches.length} papers — show all
            </button>
          )}
          {rows.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 14, padding: '20px 0' }}>
              {index === null ? 'Loading the library…' : 'Nothing matches — try a broader term.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
