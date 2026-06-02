/**
 * TurnstileWidget — Cloudflare Turnstile CAPTCHA for the auth forms.
 *
 * Renders the Turnstile challenge and hands the resulting single-use token to
 * the parent via onToken. The token is passed to Supabase auth calls as
 * `captchaToken`; Supabase verifies it server-side (once CAPTCHA is enabled in
 * the dashboard with the matching secret).
 *
 * Gated on VITE_TURNSTILE_SITE_KEY: when unset, TURNSTILE_ENABLED is false, the
 * widget renders nothing, and the auth flows behave exactly as before — so this
 * is inert until the key is configured. IMPORTANT rollout order: set the site
 * key (this env var) and deploy FIRST, then enable CAPTCHA + paste the secret
 * in the Supabase dashboard. Enabling it dashboard-side without the client
 * sending tokens would break every auth call.
 */

import { useEffect, useRef } from 'react';

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';
export const TURNSTILE_ENABLED = !!SITE_KEY;

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function TurnstileWidget({
  onToken,
  onExpire,
  resetKey,
}: {
  onToken: (token: string) => void;
  onExpire?: () => void;
  /** Bump to force a fresh challenge (Turnstile tokens are single-use). */
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Keep the latest callbacks without re-rendering the widget.
  const cbs = useRef({ onToken, onExpire });
  cbs.current = { onToken, onExpire };

  useEffect(() => {
    if (!TURNSTILE_ENABLED) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => cbs.current.onToken(token),
          'expired-callback': () => cbs.current.onExpire?.(),
          'error-callback': () => cbs.current.onExpire?.(),
        });
      })
      .catch(() => {
        /* script blocked/offline — leave token empty; parent gates on it */
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* noop */ }
        widgetId.current = null;
      }
    };
  }, []);

  // Reset on demand (after a consumed/expired token) so the user can retry.
  useEffect(() => {
    if (widgetId.current && window.turnstile) {
      try { window.turnstile.reset(widgetId.current); } catch { /* noop */ }
    }
  }, [resetKey]);

  if (!TURNSTILE_ENABLED) return null;
  return <div ref={containerRef} style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }} />;
}
