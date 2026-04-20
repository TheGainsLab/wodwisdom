import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ADMIN_FROM_EMAIL") || "coach@thegainslab.com";
const SENDER_NAME = "Matt — The Gains Lab";
const SITE_URL = Deno.env.get("SITE_URL") || "https://thegainslab.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName: string | null | undefined, email: string): string {
  if (fullName && fullName.trim()) return fullName.trim().split(/\s+/)[0];
  return email.split("@")[0];
}

interface RenderedTemplate {
  subject: string;
  html: string;
}

function renderWelcomeBack(name: string): RenderedTemplate {
  const ctaUrl = `${SITE_URL}/auth?next=/`;
  const safeName = escapeHtml(name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
      <p>Hey ${safeName},</p>
      <p>You signed up for The Gains Lab AI Platform during our early testing period — thanks for being in early.</p>
      <p>We made a few adjustments — you can now use the AI Coach without completing a profile.</p>
      <p>Ask about training, nutrition, recovery, mobility, programming, or any combination. The coach is trained on the methodology and reinforced with biochemistry and physiology, so you'll get real answers, not generic fitness advice.</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${ctaUrl}" style="display: inline-block; background: #ff3a3a; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Start Chatting →</a>
      </p>
      <p>If you do fill out a profile, the AI Coach will personalize every answer and generate a free, detailed analysis you can keep or take to your own coach. Totally optional.</p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 28px 0;" />
      <p><strong>When you want more:</strong></p>
      <ul style="padding-left: 20px;">
        <li><strong>Year of the Engine</strong> — access to 8 conditioning programs, switch anytime. Every session calibrated to your recent performance. Comprehensive analytics on energy systems, pace holds, recovery, and work-to-rest ratios. Includes unlimited AI Coach access.</li>
        <li><strong>AI Programming</strong> — personalized training built from your goals and current fitness. Each session comes with cues, common faults, and an embedded AI Coach. Ask the coach to adjust your program and the analytics pick it up immediately.</li>
      </ul>
      <p>No rush on those. You already have an account — <a href="${ctaUrl}" style="color: #ff3a3a;">start with the free chat</a>.</p>
      <p>— Matt<br/>The Gains Lab</p>
      <p style="font-size: 11px; color: #888; margin-top: 32px;">You're getting this because you signed up for The Gains Lab.</p>
    </div>
  `.trim();
  return {
    subject: "Just checking in",
    html,
  };
}

function renderCustom(subject: string, body: string, name: string): RenderedTemplate {
  // Body comes from the admin composer as plain text. We escape HTML, then
  // convert blank-line-separated paragraphs to <p> blocks and bare URLs to
  // anchors. Keeps the email simple and predictable.
  const safeName = escapeHtml(name);
  const safeBody = escapeHtml(body);
  const paragraphs = safeBody
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, "<br/>").trim())
    .filter((p) => p.length > 0);
  const linked = paragraphs.map((p) =>
    p.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #ff3a3a;">$1</a>'),
  );
  // Substitute {first_name} if the admin used it in the body.
  const withName = linked.map((p) => p.replace(/\{first_name\}/g, safeName));
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
      ${withName.map((p) => `<p>${p}</p>`).join("\n      ")}
      <p style="font-size: 11px; color: #888; margin-top: 32px;">You're getting this because you signed up for The Gains Lab.</p>
    </div>
  `.trim();
  return {
    subject: subject.trim() || "A note from The Gains Lab",
    html,
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Admin gate
    const { data: callerProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, template_key, subject, body: customBody, campaign_key } = body || {};
    if (!user_id || !template_key) {
      return new Response(
        JSON.stringify({ error: "user_id and template_key are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Look up the recipient's email and name
    const { data: recipientProfile } = await supa
      .from("profiles")
      .select("email, full_name")
      .eq("id", user_id)
      .maybeSingle();
    if (!recipientProfile?.email) {
      return new Response(
        JSON.stringify({ error: "Recipient has no email on file" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const recipientName = firstName(recipientProfile.full_name, recipientProfile.email);

    // Render the template
    let rendered: RenderedTemplate;
    if (template_key === "welcome_back") {
      rendered = renderWelcomeBack(recipientName);
    } else if (template_key === "custom") {
      const customSubject = typeof subject === "string" ? subject : "";
      const customText = typeof customBody === "string" ? customBody : "";
      if (!customText.trim()) {
        return new Response(
          JSON.stringify({ error: "Custom message body is required" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      rendered = renderCustom(customSubject, customText, recipientName);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown template_key: ${template_key}` }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Send via Resend
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${FROM_EMAIL}>`,
        to: [recipientProfile.email],
        subject: rendered.subject,
        html: rendered.html,
        reply_to: FROM_EMAIL,
      }),
    });

    if (!resendResp.ok) {
      const err = await resendResp.json().catch(() => ({}));
      console.error("[admin-send-email] Resend error:", err);
      // Log a failed send too — useful for debugging the admin history view
      await supa.from("email_sends").insert({
        user_id,
        template_key,
        subject: rendered.subject,
        campaign_key: campaign_key ?? null,
        status: "failed",
      });
      return new Response(
        JSON.stringify({ error: err?.message || "Email send failed" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const resendData = await resendResp.json();
    const messageId: string | null = resendData?.id ?? null;

    // Log the successful send
    const { data: logRow, error: logErr } = await supa
      .from("email_sends")
      .insert({
        user_id,
        template_key,
        subject: rendered.subject,
        campaign_key: campaign_key ?? null,
        resend_message_id: messageId,
        status: "sent",
      })
      .select("id")
      .single();

    if (logErr) {
      console.error("[admin-send-email] DB log insert failed:", logErr);
      // Email already went out — return success but flag the log issue
      return new Response(
        JSON.stringify({ ok: true, message_id: messageId, log_warning: logErr.message }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message_id: messageId, send_id: logRow?.id }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[admin-send-email] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
