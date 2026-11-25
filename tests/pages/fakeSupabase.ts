/**
 * A stand-in for the Supabase client, for page tests. It serves fixture rows
 * per table through the same chained calls the pages make, so a page loads
 * its data and renders exactly as it would for a member with that data.
 *
 * Deliberately permissive: an unknown table returns no rows, an unknown
 * function returns nothing. A page must survive that too.
 */
type Row = Record<string, unknown>;
export interface FakeData {
  userId: string;
  email?: string;
  tables: Record<string, Row[]>;
  functions?: Record<string, unknown>;
  rpc?: Record<string, unknown>;
}

function builder(rows: Row[], writes: { table: string; op: string; payload: unknown }[], table: string) {
  let out = rows.slice();
  let single: 'one' | 'maybe' | null = null;
  let head = false;
  let wantCount = false;
  let limitN: number | null = null;
  const q: Record<string, unknown> = {};
  const filt = (fn: (r: Row) => boolean) => { out = out.filter(fn); return q; };
  const plain = (c: string) => !c.includes('->') && !c.includes('.') && !c.includes('(');
  Object.assign(q, {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) head = true; if (opts?.count) wantCount = true; return q; },
    eq(c: string, v: unknown) { return plain(c) ? filt((r) => !(c in r) || r[c] === v) : q; },
    neq(c: string, v: unknown) { return plain(c) ? filt((r) => r[c] !== v) : q; },
    in(c: string, vs: unknown[]) { return plain(c) ? filt((r) => !(c in r) || vs.includes(r[c])) : q; },
    is(c: string, v: unknown) { return plain(c) ? filt((r) => (r[c] ?? null) === v) : q; },
    not(c: string, op: string, v: unknown) {
      if (!plain(c)) return q;
      if (op === 'is') return filt((r) => (r[c] ?? null) !== v);
      if (op === 'in') { const list = String(v).replace(/[()"]/g, '').split(','); return filt((r) => !list.includes(String(r[c]))); }
      return q;
    },
    gte(c: string, v: unknown) { return plain(c) ? filt((r) => r[c] == null || String(r[c]) >= String(v)) : q; },
    gt(c: string, v: unknown) { return plain(c) ? filt((r) => r[c] == null || String(r[c]) > String(v)) : q; },
    lte(c: string, v: unknown) { return plain(c) ? filt((r) => r[c] == null || String(r[c]) <= String(v)) : q; },
    lt(c: string, v: unknown) { return plain(c) ? filt((r) => r[c] == null || String(r[c]) < String(v)) : q; },
    like() { return q; }, ilike() { return q; }, or() { return q; }, filter() { return q; }, match() { return q; },
    contains() { return q; }, overlaps() { return q; }, textSearch() { return q; },
    order(c: string, o?: { ascending?: boolean }) {
      if (plain(c)) out = out.slice().sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -1 : String(a[c] ?? '') > String(b[c] ?? '') ? 1 : 0) * (o?.ascending === false ? -1 : 1));
      return q;
    },
    limit(n: number) { limitN = n; return q; },
    range() { return q; },
    single() { single = 'one'; return q; },
    maybeSingle() { single = 'maybe'; return q; },
    insert(payload: unknown) { writes.push({ table, op: 'insert', payload }); out = Array.isArray(payload) ? (payload as Row[]) : [payload as Row]; return q; },
    upsert(payload: unknown) { writes.push({ table, op: 'upsert', payload }); out = Array.isArray(payload) ? (payload as Row[]) : [payload as Row]; return q; },
    update(payload: unknown) { writes.push({ table, op: 'update', payload }); return q; },
    delete() { writes.push({ table, op: 'delete', payload: null }); return q; },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      const list = limitN != null ? out.slice(0, limitN) : out;
      const res = head
        ? { data: null, error: null, count: list.length }
        : single
        ? { data: list[0] ?? null, error: single === 'one' && !list[0] ? { message: 'no rows' } : null }
        : { data: list, error: null, ...(wantCount ? { count: list.length } : {}) };
      return Promise.resolve(res).then(resolve, reject);
    },
  });
  return q;
}

export function fakeSupabase(d: FakeData) {
  const writes: { table: string; op: string; payload: unknown }[] = [];
  const session = { access_token: 'test-token', user: { id: d.userId, email: d.email ?? 'member@example.com' } };
  const channel: Record<string, unknown> = {};
  Object.assign(channel, { on: () => channel, subscribe: () => channel, unsubscribe: () => Promise.resolve() });
  return {
    writes,
    session,
    client: {
      from: (table: string) => builder(d.tables[table] ?? [], writes, table),
      rpc: (name: string) => Promise.resolve({ data: d.rpc?.[name] ?? null, error: null }),
      functions: { invoke: (name: string) => Promise.resolve({ data: d.functions?.[name] ?? null, error: null }) },
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: () => Promise.resolve({ error: null }),
      },
      channel: () => channel,
      removeChannel: () => Promise.resolve(),
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: () => Promise.resolve({ data: null, error: null }) }) },
    },
  };
}
