import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

// Past-user sync: snapshot every Resend Audience's contacts into
// legacy_contacts so the admin panel can flag app accounts that were
// customers on the previous platforms (matched by normalized email).
//
// Admin-triggered from /admin/ops. Idempotent: contacts are upserted,
// and rows that disappeared from an audience since the last sync are
// removed for that audience. Read paths live in admin RPCs
// (admin_past_user_audiences, admin_legacy_contacts_stats,
// admin_outreach_list.past_user).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface ResendAudience {
  id: string;
  name: string;
}

interface ResendContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
}

async function resendGet(path: string): Promise<any> {
  const resp = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Resend ${path} -> ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

/** All contacts of one audience. Follows `after` cursors when the API
 *  paginates; a response without pagination fields is a single page. */
async function listContacts(audienceId: string): Promise<ResendContact[]> {
  const contacts: ResendContact[] = [];
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    const qs = after ? `?limit=100&after=${encodeURIComponent(after)}` : "?limit=100";
    const json = await resendGet(`/audiences/${audienceId}/contacts${qs}`);
    const batch: ResendContact[] = json?.data ?? [];
    contacts.push(...batch);
    const hasMore = json?.has_more === true && batch.length > 0;
    if (!hasMore) break;
    after = batch[batch.length - 1].id;
  }
  return contacts;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jsonHeaders = { ...cors, "Content-Type": "application/json" };

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500, headers: jsonHeaders });
    }

    // Admin gate — same pattern as admin-send-email.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
    }
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
    }
    const { data: callerProfile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders });
    }

    const runStarted = new Date().toISOString();
    const audiencesJson = await resendGet("/audiences");
    const audiences: ResendAudience[] = audiencesJson?.data ?? [];

    let totalContacts = 0;
    const perAudience: { id: string; name: string; contacts: number }[] = [];

    for (const aud of audiences) {
      const contacts = await listContacts(aud.id);
      // Normalize + dedupe within the audience (the PK is email+audience).
      const rows = new Map<string, Record<string, unknown>>();
      for (const c of contacts) {
        const email = (c.email || "").trim().toLowerCase();
        if (!email) continue;
        rows.set(email, {
          email,
          audience_id: aud.id,
          audience_name: aud.name,
          first_name: c.first_name || null,
          last_name: c.last_name || null,
          unsubscribed: !!c.unsubscribed,
          synced_at: runStarted,
        });
      }
      const batch = [...rows.values()];
      for (let i = 0; i < batch.length; i += 500) {
        const { error: upsertErr } = await supa
          .from("legacy_contacts")
          .upsert(batch.slice(i, i + 500), { onConflict: "email,audience_id" });
        if (upsertErr) throw new Error(`upsert (${aud.name}): ${upsertErr.message}`);
      }
      // Drop contacts that left this audience since the previous sync.
      const { error: delErr } = await supa
        .from("legacy_contacts")
        .delete()
        .eq("audience_id", aud.id)
        .lt("synced_at", runStarted);
      if (delErr) throw new Error(`cleanup (${aud.name}): ${delErr.message}`);

      totalContacts += batch.length;
      perAudience.push({ id: aud.id, name: aud.name, contacts: batch.length });
    }

    return new Response(
      JSON.stringify({ ok: true, audiences: perAudience, total_contacts: totalContacts }),
      { headers: jsonHeaders },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
