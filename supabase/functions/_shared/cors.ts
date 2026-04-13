export const ALLOWED_ORIGINS = [
  "https://www.thegainslab.com",
  "https://thegainslab.com",
];

const DEV_ORIGINS = ["http://localhost:5173"];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    (Deno.env.get("ENVIRONMENT") === "development" &&
      DEV_ORIGINS.includes(origin));

  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
