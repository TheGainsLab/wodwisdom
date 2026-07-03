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
 * comparison never breaks early, so a match reveals nothing via timing.
 *
 * Digests are precomputed once per process (lazily, on first authorize) so a
 * request costs one hash of the presented key + N constant-time compares, not
 * a rehash of every configured key. The DB-backed consumer_keys registry +
 * rate limiting (the data-service pattern) remain a later phase.
 */

const MIN_KEY_LENGTH = 16; // a shorter "key" is a misconfig, never a live credential

/** Constant-time string compare. Callers pass equal-length hex digests, so the
 *  length check never short-circuits on a real comparison. */
export function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse a `{ "<key>": "<tenant>" | ["<t1>", ...] }` env map. Validates the SHAPE,
 * not just JSON validity: a top-level array or string, a non-string tenant, or a
 * key shorter than MIN_KEY_LENGTH is a misconfiguration — the offending entry is
 * logged and dropped (fail closed), never turned into a live credential. (A bare
 * `["k"]` or `"k"` would otherwise explode via Object.entries into index/char
 * keys like `"0"` that authenticate — the exact hole this guards.)
 */
export function parseConsumerKeys(raw: string | undefined, label: string): Record<string, string[]> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[${label}] consumer keys env is not valid JSON; ignoring it`);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(`[${label}] consumer keys env must be a JSON object { key: tenant|tenant[] }; ignoring it`);
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length < MIN_KEY_LENGTH) {
      console.error(`[${label}] consumer key too short (< ${MIN_KEY_LENGTH} chars) or invalid; skipping one entry`);
      continue;
    }
    let tenants: string[] | null = null;
    if (typeof v === "string") tenants = [v];
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) tenants = v as string[];
    if (!tenants || tenants.length === 0) {
      console.error(`[${label}] consumer key has invalid tenant binding (need string | string[]); skipping one entry`);
      continue;
    }
    out[k] = tenants;
  }
  return out;
}

export interface AuthResult {
  /** "*" = any tenant (service key), or the bound tenant list (consumer key). */
  authz: "*" | string[];
  /** Short, non-reversible fingerprint of the presented key for request logs. */
  fingerprint: string;
}

export interface ConsumerAuth {
  /** True if at least one key (service or consumer) is configured. */
  configured(): boolean;
  /** Resolve a presented key to its authorization + fingerprint, or null (no
   *  match). Constant-time; never breaks early; hashes the presented key once. */
  authorize(presented: string): Promise<AuthResult | null>;
  /** True if `authz` may act on `tenant` (admin, or the tenant is in its bound list). */
  authorizes(authz: "*" | string[], tenant: string): boolean;
}

export function createConsumerAuth(opts: {
  serviceKey: string | undefined;
  consumerKeysRaw: string | undefined;
  label: string;
}): ConsumerAuth {
  const serviceKey = opts.serviceKey;
  const consumerKeys = parseConsumerKeys(opts.consumerKeysRaw, opts.label);

  // Precomputed digests, filled once on first authorize().
  let digests: { serviceHash?: string; consumers: { hash: string; tenants: string[] }[] } | null = null;
  async function ensureDigests() {
    if (digests) return digests;
    const serviceHash = serviceKey ? await sha256Hex(serviceKey) : undefined;
    const consumers: { hash: string; tenants: string[] }[] = [];
    for (const [k, tenants] of Object.entries(consumerKeys)) {
      consumers.push({ hash: await sha256Hex(k), tenants });
    }
    digests = { serviceHash, consumers };
    return digests;
  }

  return {
    configured() {
      return Boolean(serviceKey) || Object.keys(consumerKeys).length > 0;
    },

    async authorize(presented: string): Promise<AuthResult | null> {
      const d = await ensureDigests();
      const presentedHash = await sha256Hex(presented);
      let matched: "*" | string[] | null = null;
      if (d.serviceHash && constantTimeEq(presentedHash, d.serviceHash)) {
        matched = "*";
      }
      for (const c of d.consumers) {
        // matched !== "*" guard: an admin match outranks a consumer match, but we
        // still walk every key so timing is independent of which (if any) matched.
        if (constantTimeEq(presentedHash, c.hash) && matched !== "*") {
          matched = c.tenants;
        }
      }
      if (matched === null) return null;
      return { authz: matched, fingerprint: presentedHash.slice(0, 12) };
    },

    authorizes(authz: "*" | string[], tenant: string): boolean {
      return authz === "*" || authz.includes(tenant);
    },
  };
}
