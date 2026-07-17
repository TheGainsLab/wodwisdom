/**
 * cron-auth — the shared X-Cron-Key gate for pg_cron-invoked functions.
 *
 * pg_cron can't mint a Supabase JWT, so cron endpoints run verify_jwt=false
 * and gate themselves on a shared-secret header. Fail-closed: an unset
 * secret rejects everything. Constant-time compare so the key can't be
 * probed by timing.
 */

/** Returns null when authorized, or the 4xx Response to send back. */
export function requireCronKey(req: Request, key: string | undefined): Response | null {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const presented = req.headers.get("x-cron-key") ?? "";
  if (!key || presented.length !== key.length) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  let r = 0;
  for (let i = 0; i < key.length; i++) r |= key.charCodeAt(i) ^ presented.charCodeAt(i);
  if (r !== 0) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  return null;
}
