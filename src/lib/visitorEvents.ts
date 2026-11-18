import { supabase } from './supabase';

/**
 * visitorEvents — usage of the PUBLIC pages (calculators, library), which
 * appEvents cannot see because it is signed-in only.
 *
 * Anonymous: no user id, no free text. `visit_id` is a random id kept in
 * sessionStorage — it groups one tab's visit and dies with the tab. Table +
 * vocabulary: supabase/migrations/20261118100000_visitor_events.sql (the
 * CHECK there is the source of truth; add an event in both places).
 *
 *   page_view        { path }                 which public pages get read
 *   calculator_used  { calculator, result }   which calculators get used
 *
 * Fire-and-forget, like appEvents: failures are swallowed and tracking can
 * never break a page.
 */

type VisitorEvent = 'page_view' | 'calculator_used';

/** Public surfaces whose signed-out page views are counted. Signed-in page
 *  views are already in app_events. */
const TRACKED_PREFIXES = ['/calculators', '/qa', '/knowledge'];

export function isTrackedPublicPath(pathname: string): boolean {
  return TRACKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const VISIT_KEY = 'gl_visit_id';

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

export function trackVisitor(event: VisitorEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    const id = visitId();
    if (!id) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      supabase.from('visitor_events')
        .insert({ visit_id: id, event, props, signed_in: !!session })
        .then(() => {}, () => {});
    }, () => {});
  } catch { /* tracking must never break the app */ }
}
