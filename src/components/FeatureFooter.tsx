import { Link } from 'react-router-dom';
import GainsLogo from './GainsLogo';

const linkStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 500,
};

/**
 * Footer for the public feature pages. The header nav is hidden on mobile,
 * so this is the way off the page for anyone who scrolled to the bottom:
 * logo and Home go to /, plus per-page links (Examples, the other product).
 */
export default function FeatureFooter({ links = [] }: { links?: { to: string; label: string }[] }) {
  return (
    <footer className="feature-footer">
      <Link to="/" aria-label="The Gains Lab home" style={{ color: 'var(--text)', textDecoration: 'none' }}>
        <GainsLogo />
      </Link>
      <div style={{ marginTop: 10, display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/" style={linkStyle}>Home</Link>
        <Link to="/pricing" style={linkStyle}>Pricing</Link>
        {links.map(l => (
          <Link key={l.to} to={l.to} style={linkStyle}>{l.label}</Link>
        ))}
      </div>
    </footer>
  );
}
