import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchKnowledgeIndex, topicLabel, type KnowledgeIndexRow } from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import KnowledgeDiscuss, { renderAssistantHtml } from '../components/KnowledgeDiscuss';
import '../features.css';
import '../qa.css';
import { logKnowledgeEvent } from '../lib/knowledgeEvents';
import { supabase } from '../lib/supabase';
import { RESEARCH_FREE_QUESTIONS } from '../lib/pricingPlans';

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
  const navigate = useNavigate();
  const [index, setIndex] = useState<KnowledgeIndexRow[] | null>(null);
  const [myThreads, setMyThreads] = useState<MyThread[]>([]);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [myResearchOpen, setMyResearchOpen] = useState(false);
  const [showAllPapers, setShowAllPapers] = useState(false);
  // Chip row: tap a topic to filter the list. The chips and scrolling are
  // the ONLY navigation — there is no free-text search (founder's call,
  // 2026-10-20: "there is no free search - people can either scroll or
  // use the chips"). The typed input on this page is Ask the Library.
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

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

  // Chips returned (founder's call, 2026-10-20) — but as SEARCH STARTERS,
  // not card metadata: one curated row of the ten most common topics under
  // the box, each a tap-to-filter. They answer "what would I even type?"
  // and disappear the moment a query is typed. Cards and paper pages stay
  // chip-free.
  const topTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of index ?? []) {
      for (const t of r.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([t]) => t);
  }, [index]);

  const matches = useMemo(() => {
    if (!activeTopic) return index ?? [];
    return (index ?? []).filter((r) => r.topics.includes(activeTopic));
  }, [index, activeTopic]);

  // The library grows fast; the landing page shouldn't. By default show
  // the DEFAULT_VISIBLE_PAPERS most relevant entries (the index arrives
  // sorted by practical relevance). An active chip filters everything
  // and shows every match.
  const capped = activeTopic === null && !showAllPapers && matches.length > DEFAULT_VISIBLE_PAPERS;
  const rows = capped ? matches.slice(0, DEFAULT_VISIBLE_PAPERS) : matches;

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <div className="qa-entry-container" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>Research Library</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.55, margin: '0 0 20px' }}>
          Science for coaches and athletes.
        </p>

        {/* My research — the ONE home of the member's saved conversations,
            and the first thing on the page (founder, 2026-11-20: as a small
            red line between the question box and the chips it looked out of
            place and unimportant). A full-width bar, collapsed by default:
            thread cards grow with every paper questioned, and uncollapsed
            they'd become the page's next clutter. */}
        {signedIn && myThreads.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <button
              type="button"
              onClick={() => setMyResearchOpen((v) => !v)}
              aria-expanded={myResearchOpen}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: 12,
                padding: '13px 16px', color: 'var(--text)', marginBottom: myResearchOpen ? 8 : 0,
              }}
            >
              <span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>My research</span>
                <span style={{ fontSize: 13.5, color: 'var(--text-dim)' }}>
                  {' '}· {myThreads.length} saved {myThreads.length === 1 ? 'conversation' : 'conversations'}
                </span>
              </span>
              <span aria-hidden="true" style={{ color: 'var(--text-dim)', fontSize: 14 }}>{myResearchOpen ? '▾' : '▸'}</span>
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
                  name = 'AI Research Assistant';
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

        {/* ASK THE LIBRARY (founder's call, 2026-10-20 — the one-box is
            gone): the page's only typed input is the question panel. It
            owns its own composer, lifetime meter, and locked/upgrade row
            (KnowledgeDiscuss in library mode, history never replayed).
            Visitors with no account get the pitch row instead. */}
        {signedIn ? (
          <div>
            <div style={{
              fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
              color: 'var(--accent)', marginBottom: 8,
            }}>
              AI Research Assistant
            </div>
            <KnowledgeDiscuss signedIn={signedIn} noHistory />
          </div>
        ) : (
          // No padlock, no button up here (founder, 2026-11-19): at the top
          // of the page a locked row read as "this library is locked", when
          // everything below is free to read. One line, in the assistant's
          // place, says what an account gets — including that it is three
          // questions, so the counter is no surprise later (2026-11-20). The
          // button waits at the bottom.
          <Link
            to="/auth?signup=1&next=/knowledge"
            style={{ display: 'block', fontSize: 14.5, color: 'var(--text-dim)', lineHeight: 1.5, textDecoration: 'none' }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Create a free account</span>
            {' '}to try the AI Research Assistant. {RESEARCH_FREE_QUESTIONS} questions free &rarr;
          </Link>
        )}

        {/* Above the line: the assistant (needs an account). Below it:
            browsing the papers (does not). */}
        <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '22px 0 16px' }} />

        {/* Topic chips — the list's only filter, for every visitor (the
            founder's call: "people can either scroll or use the chips").
            The ten most common topics, tap to filter, tap again to clear.
            Cards and paper pages stay chip-free. */}
        {topTopics.length > 0 && (
          <p style={{ fontSize: 13.5, color: 'var(--text-dim)', margin: '0 0 10px', lineHeight: 1.5 }}>
            {activeTopic ? (
              <>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Showing: {topicLabel(activeTopic)}</span>
                {' '}·{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTopic(null); setShowAllPapers(false); }}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--accent)', fontWeight: 600 }}
                >
                  show all
                </button>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Browse by topic</span>
                {' '}· tap one to filter the papers
              </>
            )}
          </p>
        )}
        {topTopics.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 18px' }}>
            {topTopics.map((t) => {
              const active = activeTopic === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setActiveTopic(active ? null : t); setShowAllPapers(false); }}
                  style={{
                    fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3, cursor: 'pointer',
                    fontFamily: 'inherit', borderRadius: 999, padding: '4px 12px',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? '#fff' : 'var(--text-dim)',
                  }}
                >
                  {topicLabel(t)}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {rows.map((r) => (
            <Link
              key={r.slug}
              to={`/knowledge/${r.slug}`}
              style={{
                display: 'block', padding: '14px 16px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.85)', background: 'var(--surface)',
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
              {index === null ? 'Loading the library…' : 'No papers under that topic yet.'}
            </div>
          )}
        </div>

        {/* The account pitch, AFTER the visitor has seen the library. */}
        {!signedIn && (
          <div className="qa-cta-card">
            <p className="qa-cta-text">
              Ask the AI Research Assistant about any paper and get the answer in plain coaching terms. {RESEARCH_FREE_QUESTIONS} questions free with an account.
            </p>
            <button className="feature-cta qa-cta-btn" onClick={() => navigate('/auth?signup=1&next=/knowledge')}>
              Create Free Account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
