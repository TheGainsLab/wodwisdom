import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KNOWLEDGE_INDEX, KNOWLEDGE_TOPICS, topicLabel } from '../lib/knowledgeLibrary';
import { QAHeader } from '../components/QAShared';
import { KnowledgeBadge } from '../components/KnowledgeShared';
import '../features.css';
import '../qa.css';

/**
 * /knowledge — the research library list. Free to browse, no account.
 * index.json arrives pre-sorted by practical relevance (high → low) then
 * title; render order is file order.
 */
export default function KnowledgeListPage({ signedIn = false }: { signedIn?: boolean }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Research Library | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  // Topic chips: only topics carried by more than one entry are useful
  // filters at corpus size twelve; the rest stay reachable via text search.
  const chipTopics = useMemo(
    () => Object.entries(KNOWLEDGE_TOPICS)
      .filter(([, slugs]) => slugs.length > 1)
      .map(([t]) => t)
      .sort(),
    [],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return KNOWLEDGE_INDEX.filter((r) => {
      if (topic && !r.topics.includes(topic)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.authors.toLowerCase().includes(q) ||
        r.topics.some((t) => topicLabel(t).includes(q))
      );
    });
  }, [query, topic]);

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <div className="qa-entry-container" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>Research Library</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.55, margin: '0 0 20px' }}>
          Papers worth knowing, summarized honestly: what was studied, what was found,
          and what it doesn&apos;t show. Every number traced to its page in the source.
        </p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles and topics — e.g. sprint, fasted cardio"
          aria-label="Search the research library"
          style={{
            width: '100%', padding: '10px 14px', fontSize: 14, fontFamily: 'inherit',
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12,
          }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
          {chipTopics.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(topic === t ? null : t)}
              style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                fontFamily: 'inherit',
                border: `1px solid ${topic === t ? 'var(--accent)' : 'var(--border)'}`,
                background: topic === t ? 'var(--accent)' : 'transparent',
                color: topic === t ? 'white' : 'var(--text-dim)',
              }}
            >
              {topicLabel(t)}
            </button>
          ))}
        </div>

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
              <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 }}>
                {r.title}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                {r.authors} ({r.year}){r.journal ? ` · ${r.journal}` : ''}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <KnowledgeBadge kind="shape" value={r.shape} />
                <KnowledgeBadge kind="confidence" value={r.confidence} />
                <KnowledgeBadge kind="relevance" value={r.practical_relevance} />
                {r.topics.slice(0, 4).map((t) => (
                  <span key={t} style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {topicLabel(t)}
                  </span>
                ))}
              </div>
            </Link>
          ))}
          {rows.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 14, padding: '20px 0' }}>
              Nothing matches — try a broader term, or clear the topic filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
