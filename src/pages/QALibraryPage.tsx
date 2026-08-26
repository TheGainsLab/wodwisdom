import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  QA_CATEGORIES,
  QA_ENTRIES,
  searchQAEntries,
  type QACategory,
} from '../lib/qaLibrary';
import { QAHeader, QACoachCTA } from '../components/QAShared';
import '../features.css';
import '../qa.css';

const CATEGORY_ORDER: QACategory[] = [
  'week', 'skills', 'nutrition', 'physiology', 'conditioning', 'coaches',
];

export default function QALibraryPage({ signedIn = false }: { signedIn?: boolean }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<QACategory | null>(null);

  useEffect(() => {
    document.body.classList.add('feature-body');
    document.title = 'Ask a Coach — Q&A | The Gains Lab';
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, []);

  const results = useMemo(() => {
    const matched = searchQAEntries(query);
    return category ? matched.filter((e) => e.category === category) : matched;
  }, [query, category]);

  const searching = query.trim().length > 0;

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <section className="feature-hero" style={{ paddingBottom: 36 }}>
        <h1 className="feature-hero-title">Ask a Coach</h1>
        <p className="feature-hero-sub">
          Real questions athletes ask our AI Coach — answered.
        </p>
      </section>

      <div className="feature-container" style={{ paddingBottom: 80 }}>
        <input
          className="qa-search"
          type="search"
          placeholder="Search — muscle-ups, protein, pacing, zone 2…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search questions"
        />

        <div className="qa-chips">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              className={`qa-chip${category === c ? ' active' : ''}`}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {QA_CATEGORIES[c]}
            </button>
          ))}
        </div>

        {results.length === 0 ? (
          <div className="qa-empty">
            <p style={{ marginBottom: 20 }}>
              Nothing here matches that — but the Coach answers questions like it every day.
            </p>
            <Link
              to={signedIn ? '/chat' : '/auth?signup=1&next=/chat'}
              className="feature-cta qa-cta-btn"
            >
              Ask yours
            </Link>
          </div>
        ) : searching || category ? (
          <div className="qa-question-list" style={{ marginTop: 32 }}>
            {results.map((e) => <QuestionRow key={e.slug} slug={e.slug} question={e.question} />)}
          </div>
        ) : (
          CATEGORY_ORDER.map((c) => (
            <section key={c}>
              <h2 className="qa-section-label">{QA_CATEGORIES[c]}</h2>
              <div className="qa-question-list">
                {QA_ENTRIES.filter((e) => e.category === c).map((e) => (
                  <QuestionRow key={e.slug} slug={e.slug} question={e.question} />
                ))}
              </div>
            </section>
          ))
        )}

        <QACoachCTA signedIn={signedIn} />
      </div>
    </div>
  );
}

function QuestionRow({ slug, question }: { slug: string; question: string }) {
  return (
    <Link to={`/qa/${slug}`} className="qa-question-link">
      <span>{question}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
