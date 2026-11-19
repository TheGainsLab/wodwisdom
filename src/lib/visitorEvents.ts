import { supabase } from './supabase';
import { deviceOf, isLikelyBot, sourceFrom } from './visitorSource';

/**
 * visitorEvents — usage of the PUBLIC pages, which appEvents cannot see
 * because it is signed-in only.
 *
 * Anonymous: no user id, no IP, no free text. `visit_id` is a random id kept
 * in sessionStorage — it groups one tab's visit and dies with the tab.
 * Table + vocabulary: supabase/migrations/20261118100000_visitor_events.sql
 * and 20261119100000_visitor_traffic.sql (the CHECK there is the source of
 * truth; add an event in both places).
 *
 *   visit_start      { source?, medium?, campaign?, referrer?, landing, device }
 *                                             once per visit: where it came
 *                                             from, what it landed on, and
 *                                             phone / tablet / desktop
 *   page_view        { path }                 which public pages get read
 *   calculator_used  { calculator, result }   which calculators get used
 *
 * Read back by admin_report_traffic() for /admin/reports.
 *
 * Not recorded at all:
 *  - crawlers and automated browsers (isLikelyBot) — the ones that say so;
 *  - a browser an admin has signed in on (markBrowserAsAdmin), so the
 *    founder's own testing does not sit in a small dataset.
 *
 * Visit → account: currentVisitId() rides into the signup metadata beside
 * `acquisition`, so the report can count the accounts a source produced.
 *
 * Fire-and-forget, like appEvents: failures are swallowed and tracking can
 * never break a page.
 */

type VisitorEvent = 'visit_start' | 'page_view' | 'calculator_used';

/** Public surfaces whose signed-out page views are counted. Signed-in page
 *  views are already in app_events. The main page is tracked as exactly "/"
 *  (the signed-out router shows it for any unknown path, which is not
 *  counted). /auth and /checkout are the two doors to an account. */
const TRACKED_PREFIXES = ['/calculators', '/qa', '/knowledge', '/examples', '/pricing', '/features', '/auth', '/checkout'];

export function isTrackedPublicPath(pathname: string): boolean {
  return pathname === '/' || TRACKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const VISIT_KEY = 'gl_visit_id';
const VISIT_STARTED_KEY = 'gl_visit_started';
const NO_TRACK_KEY = 'gl_no_track';

/** Call when an admin is signed in: this browser's visits stop counting,
 *  signed in or out, from now on. */
export function markBrowserAsAdmin(): void {
  try { localStorage.setItem(NO_TRACK_KEY, '1'); } catch { /* storage blocked */ }
}

function excluded(): boolean {
  try {
    if (localStorage.getItem(NO_TRACK_KEY) === '1') return true;
  } catch { /* storage blocked — fall through to the bot check */ }
  try {
    return isLikelyBot(navigator.userAgent, navigator.webdriver === true);
  } catch {
    return true;
  }
}

function visitId(): string | null {
  try {
    let id = sessionStorage.getItem(VISIT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(VISIT_KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: skip tracking rather than break the page
  }
}

/** This tab's visit id, for the signup metadata. Null for an excluded
 *  browser (nothing was recorded under it) or when storage is blocked. */
export function currentVisitId(): string | null {
  return excluded() ? null : visitId();
}

function send(id: string, event: VisitorEvent, props: Record<string, string | number | boolean>): void {
  supabase.auth.getSession().then(({ data: { session } }) => {
    supabase.from('visitor_events')
      .insert({ visit_id: id, event, props, signed_in: !!session })
      .then(() => {}, () => {});
  }, () => {});
}

export function trackVisitor(event: VisitorEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    if (excluded()) return;
    const id = visitId();
    if (!id) return;
    send(id, event, props);
  } catch { /* tracking must never break the app */ }
}

/** A signed-out page view; the first one of a visit also records where the
 *  visit came from. */
export function trackPageView(pathname: string): void {
  try {
    if (excluded()) return;
    const id = visitId();
    if (!id) return;
    if (sessionStorage.getItem(VISIT_STARTED_KEY) !== '1') {
      sessionStorage.setItem(VISIT_STARTED_KEY, '1');
      const src = sourceFrom(window.location.search, document.referrer, window.location.host);
      // Kept short: the table refuses a props object over 400 bytes.
      const start: Record<string, string> = {
        landing: pathname.slice(0, 80),
        device: deviceOf(navigator.userAgent, window.innerWidth, navigator.maxTouchPoints > 0),
      };
      for (const k of ['source', 'medium', 'campaign', 'referrer'] as const) {
        const v = src[k];
        if (v) start[k] = v.slice(0, 40);
      }
      send(id, 'visit_start', start);
    }
    send(id, 'page_view', { path: pathname.slice(0, 120) });
  } catch { /* tracking must never break the app */ }
}
