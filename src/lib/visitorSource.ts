/**
 * visitorSource — the pure pieces of visit tracking: where a visit came
 * from, what kind of device it is on, and whether the "visitor" is a
 * crawler. No browser globals in here, so it is unit-tested directly
 * (tests/visitorSource.test.ts); visitorEvents.ts and acquisition.ts feed it
 * the real location, referrer and user agent.
 */

export interface VisitSource {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  /** The referring site's HOST only (never a full URL), and only when it is
   *  another site — same-site navigation is not a source. */
  referrer?: string;
}

const clip = (v: string | null | undefined, max = 60): string | undefined => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : undefined;
};

/** UTM tags from the query string plus the external referrer's host. */
export function sourceFrom(search: string, referrer: string, ownHost: string): VisitSource {
  const params = new URLSearchParams(search);
  const out: VisitSource = {
    source: clip(params.get('utm_source')),
    medium: clip(params.get('utm_medium')),
    campaign: clip(params.get('utm_campaign')),
    content: clip(params.get('utm_content')),
  };
  if (referrer) {
    try {
      const host = new URL(referrer).host;
      if (host && host !== ownHost) out.referrer = clip(host);
    } catch { /* unparseable referrer — no source */ }
  }
  return out;
}

export type Device = 'phone' | 'tablet' | 'desktop';

/** Phone, tablet or desktop, from the user agent with the screen as a
 *  tie-breaker (an iPad reports a desktop user agent but has touch). */
export function deviceOf(userAgent: string, viewportWidth: number, hasTouch: boolean): Device {
  const ua = userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'phone';
  if (hasTouch && viewportWidth > 0 && viewportWidth <= 1100 && /Macintosh/i.test(ua)) return 'tablet'; // iPadOS
  return 'desktop';
}

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|facebookexternalhit|whatsapp|telegram|discord|embedly|monitor|pingdom|uptime|scrap|curl|wget|python-requests|httpclient|go-http|node-fetch|axios/i;

/** A crawler or an automated browser. Catches the ones that say so; a bot
 *  that disguises itself as a person is not detectable here. */
export function isLikelyBot(userAgent: string, webdriver: boolean): boolean {
  if (webdriver) return true;
  if (!userAgent) return true;
  return BOT_UA.test(userAgent);
}
