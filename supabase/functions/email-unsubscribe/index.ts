/**
 * email-unsubscribe — the opt-out endpoint behind every automated email's
 * unsubscribe link (CAN-SPAM compliance; July '26 review).
 *
 * GET ?u=<user_id>&t=<hmac> — the token is HMAC-SHA256(user_id) under
 * LIFECYCLE_CRON_KEY, minted by _shared/checkout-emails.ts unsubscribeUrl().
 * On a valid token, sets profiles.email_opt_out = true (via the
 * service-role-only set_email_opt_out RPC) and returns a tiny confirmation
 * page. Every candidate RPC and the recovery sender honor the flag.
 *
 * Idempotent; an already-opted-out user just sees the confirmation again.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUnsubscribeToken } from "../_shared/checkout-emails.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#1a1a1a;text-align:center">` +
    `<h2>${title}</h2><p style="color:#5a584f;line-height:1.6">${body}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";

  if (!UUID_RE.test(userId) || !token) {
    return page("Invalid link", "This unsubscribe link is incomplete. Reply to any of our emails and we'll take you off the list by hand.", 400);
  }
  if (!(await verifyUnsubscribeToken(userId, token))) {
    return page("Invalid link", "This unsubscribe link didn't check out. Reply to any of our emails and we'll take you off the list by hand.", 403);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { error } = await supa.rpc("set_email_opt_out", { p_user_id: userId });
  if (error) {
    console.error("[email-unsubscribe] opt-out failed:", error);
    return page("Something went wrong", "We couldn't process that just now. Reply to any of our emails and we'll take you off the list by hand.", 500);
  }

  return page(
    "You're unsubscribed",
    "You won't receive automated emails from The Gains Lab anymore. Account and billing emails (receipts, password resets) still arrive as needed.",
  );
});
