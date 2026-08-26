import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { QA_CATEGORIES, QA_ENTRIES, findQAEntry } from '../lib/qaLibrary';
import { QAHeader, QACoachCTA, renderAnswer } from '../components/QAShared';
import '../features.css';
import '../qa.css';

export default function QAEntryPage({ signedIn = false }: { signedIn?: boolean }) {
  const { slug } = useParams<{ slug: string }>();
  const entry = slug ? findQAEntry(slug) : undefined;

  useEffect(() => {
    document.body.classList.add('feature-body');
    if (entry) document.title = `${entry.question} | The Gains Lab`;
    return () => {
      document.body.classList.remove('feature-body');
      document.title = 'The Gains Lab';
    };
  }, [entry]);

  if (!entry) return <Navigate to="/qa" replace />;

  const related = QA_ENTRIES
    .filter((e) => e.category === entry.category && e.slug !== entry.slug)
    .slice(0, 4);

  return (
    <div className="feature-page">
      <QAHeader signedIn={signedIn} />

      <div className="qa-entry-container" style={{ paddingTop: 36 }}>
        <Link to="/qa" className="feature-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All questions
        </Link>

        <div>
          <span className="qa-entry-category">{QA_CATEGORIES[entry.category]}</span>
        </div>
        <h1 className="qa-entry-title">{entry.question}</h1>

        {renderAnswer(entry.answer)}

        <QACoachCTA signedIn={signedIn} />

        {related.length > 0 && (
          <div className="qa-related">
            <h2>Related questions</h2>
            <div className="qa-question-list">
              {related.map((e) => (
                <Link key={e.slug} to={`/qa/${e.slug}`} className="qa-question-link">
                  <span>{e.question}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
