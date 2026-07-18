/**
 * acquisition — first-touch source capture (capture list item B, July '26).
 *
 * On every page load, captureAcquisition() looks for UTM parameters and an
 * external referrer and stashes the FIRST set seen in localStorage (a later
 * visit never overwrites the original source — first-touch attribution).
 * At signup, getAcquisition() rides into supabase.auth.signUp's user
 * metadata, landing in auth.users.raw_user_meta_data.acquisition — no
 * schema change, queryable by the digest via SECURITY DEFINER.
 *
 * Forward-only by nature: existing users stay unlabeled; every signup from
 * deploy day onward is attributable.
 */

const KEY = 'acquisition_v1';

export interface Acquisition {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  referrer?: string;
  landing?: string;
  captured_at: string;
}

export function captureAcquisition(): void {
  try {
    if (localStorage.getItem(KEY)) return; // first touch wins

    const params = new URLSearchParams(window.location.search);
    const source = params.get('utm_source') ?? undefined;
    const medium = params.get('utm_medium') ?? undefined;
    const campaign = params.get('utm_campaign') ?? undefined;
    const content = params.get('utm_content') ?? undefined;

    // External referrer only — same-site navigation is noise.
    let referrer: string | undefined;
    if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.host !== window.location.host) referrer = ref.host;
      } catch { /* unparseable referrer — skip */ }
    }

    // Nothing to record for a direct, untagged visit — leave the slot open
    // so a later tagged/referred visit can still claim first touch.
    if (!source && !referrer) return;

    const acq: Acquisition = {
      source, medium, campaign, content, referrer,
      landing: window.location.pathname,
      captured_at: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(acq));
  } catch { /* storage unavailable (private mode) — attribution is best-effort */ }
}

export function getAcquisition(): Acquisition | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as Acquisition : null;
  } catch {
    return null;
  }
}
