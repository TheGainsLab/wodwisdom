/**
 * engine-class/auth.ts — decode a gateway-verified Supabase JWT for its user id.
 * The functions run verify_jwt=true, so the gateway already verified the signature;
 * we only extract claims here (same pattern as engine-join).
 */
export function decodeJwtSub(token: string): string | null {
  try {
    const b64 = token.split(".")[1];
    if (!b64) return null;
    const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
