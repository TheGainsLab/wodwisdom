import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../publicMenu.css';

/**
 * The phone menu for the PUBLIC pages (founder, 2026-11-19: "the site is hard
 * to navigate"). Under 768px both public headers hide their row of links, and
 * until now nothing replaced it — a visitor on a phone had the logo and Sign
 * In. This is the hamburger for that width: one menu, the same on the main
 * page and on the shared header (examples, calculators, research, Q&A).
 *
 * Order is by importance: the Research Library is a product, the calculators
 * are the free hook, then proof (examples, Q&A), then pricing and FAQ.
 *
 * `onLanding`: Pricing and FAQ are sections of the main page, so there they
 * are in-page anchors; elsewhere Pricing is its own page and FAQ is the main
 * page's section. Signed-in visitors get the four content links and a way
 * back into the app.
 */

interface MenuLink { label: string; to: string; anchor?: boolean }

function menuLinks(signedIn: boolean, onLanding: boolean): MenuLink[] {
  const links: MenuLink[] = [
    { label: 'Research Library', to: '/knowledge' },
    { label: 'Test Yourself', to: '/calculators' },
    { label: 'Examples', to: '/examples' },
    { label: 'Coach Q&A', to: '/qa' },
  ];
  if (signedIn) return links;
  return [
    // Off the main page, "Home" leads the menu: the logo also goes there,
    // but the menu is where people look (founder, 2026-11-19).
    ...(onLanding ? [] : [{ label: 'Home', to: '/' }]),
    ...links,
    onLanding ? { label: 'Pricing', to: '#pricing', anchor: true } : { label: 'Pricing', to: '/pricing' },
    onLanding ? { label: 'FAQ', to: '#faq', anchor: true } : { label: 'FAQ', to: '/#faq' },
  ];
}

export default function PublicMenu({ signedIn = false, onLanding = false }: { signedIn?: boolean; onLanding?: boolean }) {
  // Open is remembered against the location it was opened on, so any
  // navigation (a link, the back button) closes it without an effect.
  const { pathname, hash } = useLocation();
  const here = pathname + hash;
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === here;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenAt((typeof next === 'function' ? next(open) : next) ? here : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenAt(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="pm-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="public-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open
            ? <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>
            : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>}
        </svg>
      </button>
      {open && (
        <>
          <div className="pm-backdrop" onClick={close} aria-hidden="true" />
          <nav className="pm-panel" id="public-menu" aria-label="Site">
            {menuLinks(signedIn, onLanding).map((l) => (
              l.anchor
                ? <a key={l.label} className="pm-link" href={l.to} onClick={close}>{l.label}</a>
                : <Link key={l.label} className="pm-link" to={l.to} onClick={close}>{l.label}</Link>
            ))}
            {signedIn
              ? <Link className="pm-cta" to="/" onClick={close}>Open App</Link>
              : <Link className="pm-cta" to="/auth?signup=1&next=/profile" onClick={close}>Get Your Free Evaluation</Link>}
          </nav>
        </>
      )}
    </>
  );
}
