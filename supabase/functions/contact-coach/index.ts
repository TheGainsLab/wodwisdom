/**
 * contact-coach — the "talk to a human coach" relief valve (founder spec,
 * 2026-10-06). The AI chat carries a button; this function turns one tap
 * into ONE email to the coach inbox and nothing else:
 *
 *   - Auth'd user posts { message, include_chat, images[] (≤2, base64 jpeg/png) }.
 *   - Rate limit: 2 accepted sends per rolling 24h (coach_messages rows).
 *   - The email goes via Resend to COACH_INBOX_EMAIL (default
 *     coach@thegainslab.com) with Reply-To set to the USER's email — the
 *     coach replies from his ordinary mailbox and the platform is out of
 *     the loop. No inbound email handling exists or is needed.
 *   - Context rides along so one reply is enough: account header (features,
 *     days/week, admin link) + the user's last 5 AI chat Q&A pairs.
 *   - Every accepted attempt writes a coach_messages row (status
 *     'sent'/'send_failed') — the rate-limit source and the admin-timeline
 *     "Messaged the coach" event (a churn-risk signal worth having).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ADMIN_FROM_EMAIL") || "coach@thegainslab.com";
const COACH_INBOX = Deno.env.get("COACH_INBOX_EMAIL") || "coach@thegainslab.com";
const ADMIN_BASE_URL = "https://www.thegainslab.com";

const DAILY_LIMIT = 2;
const MAX_MESSAGE_CHARS = 2000;
const MAX_IMAGES = 2;
// 4MB binary ≈ 5.6MB base64. Enforced client-side too; this is the backstop.
const MAX_IMAGE_B64_CHARS = 5_800_000;

interface ImagePayload {
  name?: string;
  type?: string;
  /** Raw base64, no data: prefix. */
  data?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function json(cors: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, 405, { error: "POST only" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(cors, 500, { error: "Server not configured" });
  }
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Auth — bearer token, verified in-function (config.toml verify_jwt=false
  // per house convention).
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } = { user: null }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) return json(cors, 401, { error: "Unauthorized" });
  const userEmail = user.email ?? null;
  if (!userEmail) {
    // Reply-To is the whole delivery mechanism — without an email address
    // the coach's reply has nowhere to go.
    return json(cors, 400, { error: "Your account has no email address to reply to." });
  }

  // Body + validation.
  let body: { message?: string; include_chat?: boolean; images?: ImagePayload[] };
  try {
    body = await req.json();
  } catch {
    return json(cors, 400, { error: "Invalid JSON body" });
  }
  const message = (body.message ?? "").trim();
  if (message.length === 0) return json(cors, 400, { error: "Write a message first." });
  if (message.length > MAX_MESSAGE_CHARS) {
    return json(cors, 400, { error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` });
  }
  const includeChat = body.include_chat !== false;
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  for (const img of images) {
    const okType = img?.type === "image/jpeg" || img?.type === "image/png";
    const okData = typeof img?.data === "string" && img.data.length > 0 &&
      img.data.length <= MAX_IMAGE_B64_CHARS;
    if (!okType || !okData) {
      return json(cors, 400, { error: "Attachments must be JPEG/PNG screenshots up to 4MB." });
    }
  }

  // Rate limit — 2 DELIVERED sends per rolling 24h. send_failed rows don't
  // count: "try again in a minute" after a Resend hiccup must not burn the
  // day's quota (two failures would otherwise lock the user out with zero
  // messages delivered).
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: recentCount, error: countErr } = await supa
    .from("coach_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "sent")
    .gte("created_at", since);
  if (countErr) return json(cors, 500, { error: "Could not check your send limit — try again." });
  if ((recentCount ?? 0) >= DAILY_LIMIT) {
    return json(cors, 429, {
      error: "You've reached today's limit — your earlier message is with the coach.",
      code: "LIMIT",
    });
  }

  // Context: account header + recent chat.
  const [{ data: profileRow }, { data: athleteRow }, { data: entRows }] = await Promise.all([
    supa.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supa.from("athlete_profiles").select("days_per_week, goal").eq("user_id", user.id).maybeSingle(),
    supa.from("user_entitlements").select("feature").eq("user_id", user.id)
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
  ]);
  const displayName = (profileRow?.full_name ?? "").trim() || userEmail;
  const features = [...new Set(((entRows ?? []) as Array<{ feature: string }>).map((e) => e.feature))].sort();

  let chatHtml = "";
  if (includeChat) {
    const { data: chatRows } = await supa
      .from("chat_messages")
      .select("question, answer, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const pairs = ((chatRows ?? []) as Array<{ question: string | null; answer: string | null; created_at: string }>)
      .reverse();
    if (pairs.length > 0) {
      chatHtml = `<h3 style="margin:24px 0 8px">Recent AI chat (oldest first)</h3>` + pairs.map((p) => {
        const q = escapeHtml((p.question ?? "").slice(0, 800));
        const a = escapeHtml((p.answer ?? "").slice(0, 800));
        return `<div style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #ccc">` +
          `<div style="color:#555"><strong>They asked:</strong> ${q}</div>` +
          `<div style="color:#888;margin-top:4px"><strong>AI:</strong> ${a}${(p.answer ?? "").length > 800 ? "…" : ""}</div>` +
          `</div>`;
      }).join("");
    } else {
      chatHtml = `<p style="color:#888">(No AI chat history.)</p>`;
    }
  }

  const adminLink = `${ADMIN_BASE_URL}/admin/users/${user.id}`;
  const header =
    `<p style="color:#555;margin:0 0 16px">` +
    `${escapeHtml(displayName)} &lt;${escapeHtml(userEmail)}&gt;` +
    ` · plan: ${features.length ? escapeHtml(features.join(", ")) : "none"}` +
    (athleteRow?.days_per_week ? ` · ${athleteRow.days_per_week} days/week` : "") +
    ` · <a href="${adminLink}">admin page</a></p>`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:640px">` +
    header +
    `<h3 style="margin:0 0 8px">Their message</h3>` +
    `<div style="white-space:pre-wrap;padding:12px 14px;background:#f6f6f6;border-radius:8px">${escapeHtml(message)}</div>` +
    (images.length ? `<p style="color:#888">${images.length} screenshot${images.length > 1 ? "s" : ""} attached.</p>` : "") +
    chatHtml +
    `<p style="color:#aaa;font-size:12px;margin-top:24px">Reply to this email and it goes straight to the athlete.</p>` +
    `</div>`;

  // Send via Resend — Reply-To the user, attachments inline in the payload.
  let status = "sent";
  if (!RESEND_API_KEY) {
    console.error("[contact-coach] RESEND_API_KEY not configured");
    status = "send_failed";
  } else {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `The Gains Lab <${FROM_EMAIL}>`,
          to: COACH_INBOX,
          reply_to: userEmail,
          subject: `Coach request — ${displayName}${displayName === userEmail ? "" : ` (${userEmail})`}`,
          html,
          attachments: images.map((img, i) => ({
            filename: img.name && /^[\w.\- ]{1,80}$/.test(img.name)
              ? img.name
              : `screenshot-${i + 1}.${img.type === "image/png" ? "png" : "jpg"}`,
            content: img.data,
          })),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        console.error(`[contact-coach] Resend ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
        status = "send_failed";
      }
    } catch (e) {
      console.error("[contact-coach] Resend send failed:", e);
      status = "send_failed";
    }
  }

  // Record the attempt either way (rate-limit source + admin timeline).
  const { error: insErr } = await supa.from("coach_messages").insert({
    user_id: user.id,
    message,
    included_chat: includeChat,
    image_count: images.length,
    status,
  });
  if (insErr) console.error("[contact-coach] coach_messages insert failed:", insErr.message);

  if (status !== "sent") {
    return json(cors, 502, { error: "Couldn't deliver your message — please try again in a minute." });
  }
  return json(cors, 200, { ok: true, reply_to: userEmail });
});
