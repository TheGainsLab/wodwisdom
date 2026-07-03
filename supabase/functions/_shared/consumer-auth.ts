/**
 * consumer-auth — the constant-time, tenant-bound consumer-key authorizer.
 *
 * Extracted from engine-generate so the Wholesale Grants API (and any future
 * server-to-server surface) reuses ONE implementation instead of copying a
 * third variant (BILLING_MECHANICS_SPEC §7 / ENGINE_API_CONTRACT.md auth).
 *
 * Shape: an admin/service key authorizes ANY tenant ("*"); optional per-consumer
 * keys (a JSON `{ key: tenant | tenant[] }` map) authorize ONLY their bound
 * tenant(s). Keys are compared in constant time over SHA-256 digests and the
 * comparison never breaks early, so a match reveals nothing via timing. The
 * DB-backed consumer_keys registry + rate limiting (the data-service pattern)
 * remain a later phase; this is the env-var-configured v1 both surfaces share.
 */

/** Constant-time string compare. Callers pass equal-length hex digests, so the
 *  length check never short-circuits on a real comparison. */
export function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse a `{ "<key>": "<tenant>" | ["<t1>", ...] }` env map. Invalid JSON is
 *  logged and treated as "no consumer keys" (fail closed to the service key). */
export function parseConsumerKeys(raw: string | undefined, label: string): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string | string[]>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = (Array.isArray(v) ? v : [v]).map(String);
    }
    return out;
  } catch {
    console.error(`[${label}] consumer keys env is not valid JSON; ignoring it`);
    return {};
  }
}

export interface ConsumerAuth {
  /** True if at least one key (service or consumer) is configured. */
  configured(): boolean;
  /** Resolve a presented key to its authorization: "*" (any tenant), a bound
   *  tenant list, or null (no match). Constant-time; never breaks early. */
  authorizeKey(presented: string): Promise<"*" | string[] | null>;
  /** Short, non-reversible fingerprint of a key for request logs (never the key). */
  fingerprint(presented: string): Promise<string>;
  /** True if `authz` may act on `tenant` (admin, or the tenant is in its bound list). */
  authorizes(authz: "*" | string[], tenant: string): boolean;
}

/**
 * Build a ConsumerAuth from a service key + a raw consumer-keys JSON string.
 * Both are read from env by the caller (so the caller owns which env var names
 * it uses — ENGINE_SERVICE_KEY vs WHOLESALE_SERVICE_KEY, etc.).
 */
export function createConsumerAuth(opts: {
  serviceKey: string | undefined;
  consumerKeysRaw: string | undefined;
  label: string;
}): ConsumerAuth {
  const serviceKey = opts.serviceKey;
  const consumerKeys = parseConsumerKeys(opts.consumerKeysRaw, opts.label);

  return {
    configured() {
      return Boolean(serviceKey) || Object.keys(consumerKeys).length > 0;
    },

    async authorizeKey(presented: string): Promise<"*" | string[] | null> {
      const presentedHash = await sha256Hex(presented);
      let matched: "*" | string[] | null = null;
      if (serviceKey && constantTimeEq(presentedHash, await sha256Hex(serviceKey))) {
        matched = "*";
      }
      for (const [key, tenants] of Object.entries(consumerKeys)) {
        // matched !== "*" guard: an admin match outranks a consumer match, but we
        // still walk every key so timing is independent of which (if any) matched.
        if (constantTimeEq(presentedHash, await sha256Hex(key)) && matched !== "*") {
          matched = tenants;
        }
      }
      return matched;
    },

    async fingerprint(presented: string): Promise<string> {
      return (await sha256Hex(presented)).slice(0, 12);
    },

    authorizes(authz: "*" | string[], tenant: string): boolean {
      return authz === "*" || authz.includes(tenant);
    },
  };
}
