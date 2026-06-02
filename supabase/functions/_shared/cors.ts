export const ALLOWED_ORIGINS = [
  "https://www.thegainslab.com",
  "https://thegainslab.com",
  // Vite dev server. CORS is not an auth boundary — functions still verify the
  // bearer token + role — so allowlisting localhost only lets a developer's own
  // machine iterate against deployed functions. Kept unconditional (rather than
  // gated on an ENVIRONMENT var prod doesn't set) so local dev works against
  // the prod project, which is the actual dev workflow.
  "http://localhost:5173",
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // The allow-origin header varies by request Origin — tell caches not to
    // serve one origin's response to another.
    "Vary": "Origin",
  };
}
