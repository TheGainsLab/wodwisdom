import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ADMIN_FROM_EMAIL") || "coach@thegainslab.com";
const SENDER_NAME = "The Gains Lab";
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

/**
 * Apply `**bold**` and `*italic*` emphasis to already-HTML-escaped text.
 * Bold runs first so remaining single-* pairs become italic. Italic
 * requires non-whitespace on both sides of the content to avoid matching
 * incidental asterisks like "3 * 4 = 12".
 */
function applyEmphasis(s: string): string {
  return s
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*/g, "<em>$1</em>");
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 4;
const VALID_CID = /^[A-Za-z0-9._-]+$/;

interface InboundAttachment {
  cid: string;
  filename: string;
  content_type: string;
  content_base64: string;
}

function renderCustom(subject: string, body: string, name: string, attachments: InboundAttachment[], evalHtml = "", evalHeadline: string | null = null): RenderedTemplate {
  // Body comes from the admin composer as plain-text-with-extras. Four
  // kinds of formatting are supported:
  //   1. Blank-line-separated paragraphs -> <p> blocks
  //   2. Bare http/https URLs -> clickable anchors (auto-link)
  //   3. Markdown links [text](url) -> anchors with custom link text
  //      (http/https/mailto only, sanitized). Emphasis inside the link
  //      text is supported (e.g. [**click here**](url)).
  //   4. **bold** and *italic* emphasis
  //
  // Ordering is tricky: markdown links are extracted first (before HTML
  // escaping) and replaced with opaque sentinel tokens. After escaping +
  // paragraph splitting + {first_name} + emphasis + bare-URL auto-linking,
  // the sentinels are swapped back in. This order guarantees that:
  //   - Neither the escaper nor the bare-URL regex mangles a markdown
  //     link's href / text.
  //   - Emphasis applies to plain text, but not to the auto-linked URL
  //     itself (we emit anchors after emphasis, so <em> can't land
  //     inside <a href="...">).
  const safeName = escapeHtml(name);

  // Map [image:N] tokens to the cid of the matching attachment. Tokens
  // for missing/removed attachments fall through and get stripped.
  const cidByNumber = new Map<string, string>();
  for (const a of attachments) {
    const m = a.cid.match(/^img-(\d+)-/);
    if (m) cidByNumber.set(m[1], a.cid);
  }

  const linkPlaceholders: string[] = [];
  // {eval_headline} -> sentinel before escaping (the sentinel has no HTML-
  // special characters, so it rides through escape/emphasis untouched).
  const bodyWithHeadline = evalHeadline !== null
    ? body.replace(/\{eval_headline\}/g, "\u00a7\u00a7EVHL\u00a7\u00a7")
    : body;
  const MARKDOWN_LINK = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g;
  const bodyWithTokens = bodyWithHeadline.replace(MARKDOWN_LINK, (_, text, url) => {
    const i = linkPlaceholders.length;
    // Emphasis inside the link text: escape the text first, then run
    // emphasis on the escaped string so <strong>/<em> tags are emitted
    // without being re-escaped.
    const safeText = applyEmphasis(escapeHtml(text));
    linkPlaceholders.push(
      `<a href="${escapeHtml(url)}" style="color: #ff3a3a;">${safeText}</a>`,
    );
    return `§§MDL${i}§§`;
  });

  const safeBody = escapeHtml(bodyWithTokens);
  const paragraphs = safeBody
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, "<br/>").trim())
    .filter((p) => p.length > 0);
  const withName = paragraphs.map((p) => p.replace(/\{first_name\}/g, safeName));
  // Emphasis first, then auto-link bare URLs. If we auto-linked first, a
  // URL containing `*` (rare but legal, e.g., query params) would get its
  // middle wrapped in <em>, breaking the anchor.
  const withEmphasis = withName.map((p) => applyEmphasis(p));
  const autoLinked = withEmphasis.map((p) =>
    p.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #ff3a3a;">$1</a>'),
  );
  const withLinks = autoLinked.map((p) =>
    p.replace(/§§MDL(\d+)§§/g, (_, i) => linkPlaceholders[Number(i)] || ""),
  );
  // Replace [image:N] tokens with inline <img src="cid:..."> tags. Tokens
  // for which no attachment exists are stripped silently.
  const IMG_STYLE = "max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; display: block;";
  const withImages = withLinks.map((p) =>
    p.replace(/\[image:(\d+)\]/g, (_match, n: string) => {
      const cid = cidByNumber.get(n);
      if (!cid) return "";
      return `<img src="cid:${escapeHtml(cid)}" alt="" style="${IMG_STYLE}" />`;
    }),
  );
  // Custom messages are 1:1 personal check-ins — no "you're getting this
  // because…" footer. They should read like a regular note from a person.
  // Templated sends (e.g. welcome_back) still carry their own disclosure
  // and, eventually, an unsubscribe link for bulk campaigns.
  // Left-aligned (margin: 0, not auto): a personal note hugs the left edge
  // of the mail client like human-typed email does — a centered column in a
  // wide Gmail window reads as newsletter chrome. Max-width kept for line
  // length.
  // The eval-headline sentinel renders as a pull-quote when it stands as
  // its own paragraph (the draft's layout), or as a plain quoted run when
  // someone embeds the token mid-sentence.
  const QUOTE_STYLE = "border-left: 3px solid #ff3a3a; padding-left: 14px; font-style: italic; font-weight: 600; color: #333;";
  const safeHeadline = evalHeadline !== null ? escapeHtml(evalHeadline) : "";
  const finalParas = withImages.map((p) => {
    if (p.trim() === "\u00a7\u00a7EVHL\u00a7\u00a7") {
      return `<p style="${QUOTE_STYLE}">&ldquo;${safeHeadline}&rdquo;</p>`;
    }
    // Function replacement: a `$` in the headline must not trigger
    // String.replace's substitution patterns.
    const inline = p.replace(/\u00a7\u00a7EVHL\u00a7\u00a7/g, () => `&ldquo;${safeHeadline}&rdquo;`);
    return `<p>${inline}</p>`;
  });
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0; color: #1a1a1a; line-height: 1.6;">
      ${finalParas.join("\n      ")}${evalHtml}
    </div>
  `.trim();
  return {
    subject: subject.trim() || "A note from The Gains Lab",
    html,
  };
}

/** The one-sentence coach's verdict for the {eval_headline} token.
 *  Structured rows store it directly; older markdown-only rows fall back
 *  to the first prose block (skipping headings and bullet groups). */
function extractEvalHeadline(
  structured: StructuredEvaluation | null,
  analysis: string | null,
): string | null {
  const h = structured?.headline_takeaway?.trim();
  if (h) return h;
  if (!analysis) return null;
  for (const block of analysis.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.split("\n").every((l) => l.trim().startsWith("- "))) continue;
    // First prose block; keep it quote-sized.
    const flat = t.replace(/\s+/g, " ");
    return flat.length > 220 ? flat.slice(0, 217).trimEnd() + "\u2026" : flat;
  }
  return null;
}

interface StructuredEvaluation {
  headline_takeaway?: string;
  detailed_analysis?: string;
  strengths?: string[];
  weaknesses_and_priorities?: string[];
  recommendations?: string[];
}

/** The recipient's evaluation, rendered inline below the personal note —
 *  the founder's "attach the eval" flow, as email text rather than a PDF.
 *  Prefers the typed structured_evaluation; older rows fall back to a
 *  minimal render of the markdown `analysis` prose. */
function renderEvaluationHtml(
  structured: StructuredEvaluation | null,
  analysis: string | null,
  createdAt: string,
): string {
  const esc = (t: string) => applyEmphasis(escapeHtml(t));
  const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const parts: string[] = [];
  parts.push('<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 28px 0;" />');
  parts.push(`<p style="font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 16px;">Your Evaluation &middot; ${escapeHtml(dateStr)}</p>`);

  const section = (title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return;
    parts.push(`<p style="margin: 20px 0 8px;"><strong>${title}</strong></p>`);
    parts.push(`<ul style="padding-left: 20px; margin: 0;">${items.map((i) => `<li style="margin-bottom: 8px;">${esc(i)}</li>`).join("")}</ul>`);
  };

  if (structured?.headline_takeaway) {
    parts.push(`<p><strong>${esc(structured.headline_takeaway)}</strong></p>`);
    for (const para of (structured.detailed_analysis ?? "").split(/\n\s*\n/)) {
      if (para.trim()) parts.push(`<p>${esc(para.trim()).replace(/\n/g, "<br/>")}</p>`);
    }
    section("Strengths", structured.strengths);
    section("Priorities", structured.weaknesses_and_priorities);
    section("Recommendations", structured.recommendations);
  } else if (analysis) {
    // Markdown fallback: paragraphs, "### " headings, "- " bullet groups.
    for (const block of analysis.split(/\n\s*\n/)) {
      const t = block.trim();
      if (!t) continue;
      if (t.startsWith("### ")) {
        parts.push(`<p style="margin: 20px 0 8px;"><strong>${esc(t.slice(4))}</strong></p>`);
      } else if (t.split("\n").every((l) => l.trim().startsWith("- "))) {
        const items = t.split("\n").map((l) => l.trim().slice(2));
        parts.push(`<ul style="padding-left: 20px; margin: 0;">${items.map((i) => `<li style="margin-bottom: 8px;">${esc(i)}</li>`).join("")}</ul>`);
      } else {
        parts.push(`<p>${esc(t).replace(/\n/g, "<br/>")}</p>`);
      }
    }
  } else {
    return "";
  }

  // The natural moment for the ask: they just re-read their own evaluation.
  parts.push(renderCtaBlock());
  return "\n      " + parts.join("\n      ");
}

/** The closing escape hatch — one small grey line, always the email's
 *  last element, no divider (founder revision, 2026-10-02). The buy CTAs
 *  moved into the body copy as text links, so this block no longer
 *  carries buttons: an email should end on exactly one exit, after every
 *  purchase option, in lower visual weight. */
function renderCtaBlock(): string {
  return `<p style="font-size: 12.5px; color: #888; margin: 28px 0 0;">Not ready? <a href="${SITE_URL}/examples" style="color: #ff3a3a;">See real evaluations, programs, and Engine analytics \u2192</a></p>`;
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
    const { user_id, template_key, subject, body: customBody, campaign_key, attachments: rawAttachments, include_evaluation, include_cta } = body || {};
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

    // Validate attachments (custom template only). Reject anything
    // outside the image whitelist or above size/count limits.
    const attachments: InboundAttachment[] = [];
    if (template_key === "custom" && Array.isArray(rawAttachments)) {
      if (rawAttachments.length > MAX_IMAGES) {
        return new Response(
          JSON.stringify({ error: `Max ${MAX_IMAGES} images per email` }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      for (const a of rawAttachments) {
        if (
          !a || typeof a.cid !== "string" || !VALID_CID.test(a.cid) ||
          typeof a.filename !== "string" ||
          typeof a.content_type !== "string" ||
          !ALLOWED_IMAGE_TYPES.includes(a.content_type) ||
          typeof a.content_base64 !== "string"
        ) {
          return new Response(
            JSON.stringify({ error: "Invalid attachment" }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
        // Approximate decoded size from base64 length: bytes ≈ (len * 3) / 4
        const approxBytes = Math.floor((a.content_base64.length * 3) / 4);
        if (approxBytes > MAX_IMAGE_BYTES) {
          return new Response(
            JSON.stringify({ error: `Image ${a.filename} exceeds 4MB limit` }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
        attachments.push({
          cid: a.cid,
          filename: a.filename,
          content_type: a.content_type,
          content_base64: a.content_base64,
        });
      }
    }

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
      let evalHtml = "";
      let evalHeadline: string | null = null;
      const wantsHeadline = customText.includes("{eval_headline}");
      if (include_evaluation === true || wantsHeadline) {
        const { data: evalRow } = await supa
          .from("profile_evaluations")
          .select("structured_evaluation, analysis, created_at")
          .eq("user_id", user_id)
          .eq("status", "complete")
          .eq("visible", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!evalRow) {
          return new Response(
            JSON.stringify({ error: wantsHeadline && include_evaluation !== true
              ? "This user has no completed evaluation for the {eval_headline} quote"
              : "This user has no completed evaluation to include" }),
            { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
          );
        }
        if (wantsHeadline) {
          evalHeadline = extractEvalHeadline(
            evalRow.structured_evaluation as StructuredEvaluation | null,
            evalRow.analysis,
          );
          if (!evalHeadline) {
            return new Response(
              JSON.stringify({ error: "This user's evaluation has no headline to quote" }),
              { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
            );
          }
        }
        if (include_evaluation === true) {
          evalHtml = renderEvaluationHtml(
            evalRow.structured_evaluation as StructuredEvaluation | null,
            evalRow.analysis,
            evalRow.created_at,
          );
        }
      }
      if (!evalHtml && include_cta === true) {
        evalHtml = "\n      " + renderCtaBlock();
      }
      rendered = renderCustom(customSubject, customText, recipientName, attachments, evalHtml, evalHeadline);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown template_key: ${template_key}` }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Send via Resend. Inline images use content_id so the rendered
    // <img src="cid:..."> tags resolve in the recipient's mail client.
    const resendPayload: Record<string, unknown> = {
      from: `${SENDER_NAME} <${FROM_EMAIL}>`,
      to: [recipientProfile.email],
      subject: rendered.subject,
      html: rendered.html,
      reply_to: FROM_EMAIL,
    };
    if (attachments.length > 0) {
      resendPayload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content: a.content_base64,
        content_type: a.content_type,
        content_id: a.cid,
      }));
    }
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
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
