/**
 * memory-supa — a small in-memory stand-in for the Supabase client, for tests
 * of code that reads and writes a handful of tables (2026-11-23). TEST ONLY.
 *
 * Supports what the weekly-programming code uses: select / insert / update /
 * upsert / delete with eq, in, lt, gte, is, order, limit, single, maybeSingle,
 * and `insert(...).select()`. A `fail` hook can refuse any call, and every
 * call is recorded in `calls`.
 */
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";

export interface MemoryDb {
  tables: Record<string, Row[]>;
  calls: Array<{ table: string; op: Op; payload?: any }>;
  // deno-lint-ignore no-explicit-any
  supa: any;
}

export function memorySupa(
  initial: Record<string, Row[]>,
  opts: { fail?: (table: string, op: Op, payload: any) => string | null | undefined } = {},
): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(initial)) tables[t] = rows.map((r) => ({ ...r }));
  const calls: MemoryDb["calls"] = [];
  let nextId = 1;

  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: Op = "select";
    let payload: any = null;
    let conflictKeys: string[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let mode: "many" | "single" | "maybeSingle" = "many";

    const run = () => {
      calls.push({ table, op, payload });
      const refused = opts.fail?.(table, op, payload);
      if (refused) return { data: null, error: { message: refused } };
      const rows = tables[table];
      let out: Row[] = [];
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: r.id ?? `${table}-${nextId++}`, ...r }));
        rows.push(...list);
        out = list;
      } else if (op === "upsert") {
        for (const r of (Array.isArray(payload) ? payload : [payload]) as Row[]) {
          const hit = conflictKeys.length ? rows.find((x) => conflictKeys.every((k) => x[k] === r[k])) : undefined;
          if (hit) { Object.assign(hit, r); out.push(hit); }
          else { const n = { id: r.id ?? `${table}-${nextId++}`, ...r }; rows.push(n); out.push(n); }
        }
      } else {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
        if (op === "update") for (const r of hit) Object.assign(r, payload);
        out = hit;
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitN != null) out = out.slice(0, limitN);
      if (mode === "many") return { data: out.map((r) => ({ ...r })), error: null };
      if (out.length === 0) return mode === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: { ...out[0] }, error: null };
    };

    const chain: any = {
      select() { return chain; },
      insert(p: any) { op = "insert"; payload = p; return chain; },
      update(p: any) { op = "update"; payload = p; return chain; },
      upsert(p: any, o?: { onConflict?: string }) { op = "upsert"; payload = p; conflictKeys = (o?.onConflict ?? "").split(",").map((k) => k.trim()).filter(Boolean); return chain; },
      delete() { op = "delete"; return chain; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return chain; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return chain; },
      lt(c: string, v: any) { filters.push((r) => r[c] < v); return chain; },
      gte(c: string, v: any) { filters.push((r) => r[c] >= v); return chain; },
      is(c: string, v: any) { filters.push((r) => (r[c] ?? null) === v); return chain; },
      order(col: string, o?: { ascending?: boolean }) { orderBy = { col, asc: o?.ascending !== false }; return chain; },
      limit(n: number) { limitN = n; return chain; },
      single() { mode = "single"; return Promise.resolve(run()); },
      maybeSingle() { mode = "maybeSingle"; return Promise.resolve(run()); },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
    };
    return chain;
  };

  // `tables` is one object for the life of the fake (a delete replaces a
  // table's array inside it), so tests always read the live rows.
  return { tables, calls, supa: { from } };
}
