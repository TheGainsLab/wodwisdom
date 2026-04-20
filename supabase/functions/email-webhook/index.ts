import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET");

// Forward-only status ladder for email_sends.status. Higher index "wins".
const STATUS_RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
};

// Once a row hits one of these, further events are ignored — terminal state.
const TERMINAL_STATUSES = new Set(["bounced", "complained", "failed"]);

// Resend event type -> email_sends.status transition target
const EVENT_TO_STATUS: Record<string, string> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // email.sent and email.delivery_delayed intentionally not mapped;
  // 'sent' is set by admin-send-email when we fire the request, and a
  // delivery_delayed event doesn't change the status — it just tells us
  // Resend is still retrying.
};

/**
 * Decide whether an incoming status should overwrite the current one.
 * Terminal statuses can't be overwritten. Otherwise forward-only on the
 * ranked ladder.
 */
function shouldApply(current: string, incoming: string): boolean {
  if (TERMINAL_STATUSES.has(current)) return false;
  if (TERMINAL_STATUSES.has(incoming)) return true;
  const c = STATUS_RANK[current] ?? -1;
  const n = STATUS_RANK[incoming] ?? -1;
  return n > c;
}

/**
 * Svix-style signature verification. Resend sends three headers:
 *   svix-id: unique event id
 *   svix-timestamp: unix seconds
 *   svix-signature: space-separated list of "v1,<base64 sig>" entries
 *
 * The signed payload is `{id}.{timestamp}.{raw body}`. We HMAC it with the
 * webhook secret (base64-decoded after the "whsec_" prefix is stripped).
 * Constant-time comparison on the digest.
 */
async function verifySignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  svixSignature: string,
): Promise<boolean> {
  try {
    const secretBytes = secret.startsWith("whsec_")
      ? base64Decode(secret.slice("whsec_".length))
      : new TextEncoder().encode(secret);

    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${body}`);
    const digest = await crypto.subtle.sign("HMAC", key, signed);
    const expected = arrayBufferToBase64(digest);

    // svix-signature looks like: "v1,abc123 v1,def456" — any match is valid
    for (const token of svixSignature.split(" ")) {
      const [version, sig] = token.split(",");
      if (version === "v1" && constantTimeEq(sig, expected)) return true;
    }
    return false;
  } catch (err) {
    console.error("[email-webhook] signature verify error:", err);
    return false;
  }
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!WEBHOOK_SECRET) {
    console.error("[email-webhook] RESEND_WEBHOOK_SECRET is not set");
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTs = req.headers.get("svix-timestamp") ?? "";
    const svixSig = req.headers.get("svix-signature") ?? "";
    if (!svixId || !svixTs || !svixSig) {
      return new Response(JSON.stringify({ error: "Missing svix headers" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.text();

    const ok = await verifySignature(WEBHOOK_SECRET, svixId, svixTs, body, svixSig);
    if (!ok) {
      console.warn("[email-webhook] signature rejected", { svixId });
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(body) as {
      type?: string;
      created_at?: string;
      data?: { email_id?: string };
    };

    const eventType = payload.type ?? "";
    const messageId = payload.data?.email_id;
    const targetStatus = EVENT_TO_STATUS[eventType];

    if (!targetStatus) {
      // Event type we don't care about (email.sent, delivery_delayed). 200 so
      // Resend doesn't retry.
      console.log(`[email-webhook] ignoring ${eventType}`);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!messageId) {
      console.warn(`[email-webhook] ${eventType} with no email_id`);
      return new Response(JSON.stringify({ ok: true, skipped: "no email_id" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    const { data: row } = await supa
      .from("email_sends")
      .select("id, status")
      .eq("resend_message_id", messageId)
      .maybeSingle();

    if (!row) {
      // Could be an email we didn't log (pre-webhook send, or manual send
      // via Resend dashboard). 200 silently — nothing to update.
      console.log(`[email-webhook] no email_sends row for message ${messageId}`);
      return new Response(JSON.stringify({ ok: true, skipped: "no row" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!shouldApply(row.status, targetStatus)) {
      // Already at or past this state. Just bump last_event_at so the admin
      // can see recent activity even when status doesn't change.
      await supa
        .from("email_sends")
        .update({ last_event_at: new Date().toISOString() })
        .eq("id", row.id);
      return new Response(JSON.stringify({ ok: true, unchanged: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await supa
      .from("email_sends")
      .update({ status: targetStatus, last_event_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) {
      console.error("[email-webhook] update failed:", updErr);
      return new Response(JSON.stringify({ error: "Update failed" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    console.log(`[email-webhook] ${row.id}: ${row.status} -> ${targetStatus}`);
    return new Response(JSON.stringify({ ok: true, status: targetStatus }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[email-webhook] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
