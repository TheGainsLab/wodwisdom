import { Link } from 'react-router-dom';
import GainsLogo from './GainsLogo';

/**
 * Shared pieces for the public Q&A library (/qa). The pages render in both
 * the signed-out and signed-in trees, so the header and CTA adapt: visitors
 * get the marketing header + signup CTA, members get a back-to-app link and
 * a straight line to their Coach.
 */

export function QAHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="feature-header">
      <div className="feature-header-inner">
        <Link to={signedIn ? '/' : '/'} className="feature-brand">
          <GainsLogo className="feature-brand-name" />
        </Link>
        <nav className="feature-nav">
          <Link to="/qa">Q&amp;A</Link>
          {!signedIn && <Link to="/features">Features</Link>}
        </nav>
        {signedIn ? (
          <Link to="/" className="feature-signin-btn">Open App</Link>
        ) : (
          <Link to="/auth" className="feature-signin-btn">Sign In</Link>
        )}
      </div>
    </header>
  );
}

export function QACoachCTA({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="qa-cta-card">
      <p className="qa-cta-text">
        {signedIn
          ? 'Your AI Coach knows your lifts, your history, and your goals — ask it anything.'
          : 'This is the general answer. The AI Coach knows your lifts, your history, and your goals — ask it anything. 3 free questions with an account.'}
      </p>
      <Link
        to={signedIn ? '/chat' : '/auth?signup=1&next=/chat'}
        className="feature-cta qa-cta-btn"
      >
        {signedIn ? 'Ask your Coach' : 'Ask the Coach about your own training'}
      </Link>
    </div>
  );
}

/**
 * Render an entry's answer: blank-line paragraph breaks, **bold** segments.
 * Deliberately minimal — the content file promises nothing more.
 */
export function renderAnswer(answer: string) {
  return answer.split(/\n\n+/).map((para, i) => (
    <p key={i} className="qa-answer-para">{renderBold(para)}</p>
  ));
}

function renderBold(text: string) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  // Odd indexes are the captured bold segments.
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}
