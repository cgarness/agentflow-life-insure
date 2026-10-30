/**
 * TEST ONLY — an in-memory stand-in for the supabase-js query builder that EVALUATES the filter
 * chain (eq, gte, gt, lt, is, not is/in, in, or with and(...) / cs.{...}), ordering, limit/range and
 * exact / head counts over fixture rows. Used to prove paging and count arithmetic against a
 * brute-force oracle rather than against recorded call shapes. Every write method is recorded and
 * refused, so a test can assert that a path never writes.
 */
type Row = Record<string, any>;
type Pred = (row: Row) => boolean;

export interface FakeQueryLog {
  table: string;
  head: boolean;
  limit: number | null;
  filters: string[];
  inIds: string[] | null;
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  queries: FakeQueryLog[];
  writes: Array<{ table: string; method: string }>;
  /** Return an error object to fail a query (checked when it is sent). */
  failWhen?: (q: FakeQueryLog) => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables, queries: [], writes: [], rpcCalls: [] };
}

const isDateLike = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const cmp = (a: unknown, b: unknown): number => {
  if (isDateLike(a) && isDateLike(b)) return Date.parse(a as string) - Date.parse(b as string);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

/** Split a PostgREST logic list at top-level commas. */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if ((ch === "(" || ch === "{") && ++depth) cur += ch;
    else if ((ch === ")" || ch === "}") && depth--) cur += ch;
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseTerm(term: string): Pred {
  if (term.startsWith("and(") && term.endsWith(")")) {
    const parts = splitTop(term.slice(4, -1)).map(parseTerm);
    return (row) => parts.every((p) => p(row));
  }
  if (term.startsWith("or(") && term.endsWith(")")) {
    const parts = splitTop(term.slice(3, -1)).map(parseTerm);
    return (row) => parts.some((p) => p(row));
  }
  const [col, op, ...rest] = term.split(".");
  const value = rest.join(".");
  switch (op) {
    case "eq":
      return (row) => String(row[col]) === value;
    case "is":
      return (row) => (value === "null" ? row[col] === null || row[col] === undefined : String(row[col]) === value);
    case "cs": {
      const wanted = value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
      return (row) => Array.isArray(row[col]) && wanted.every((w) => row[col].map(String).includes(w));
    }
    default:
      throw new Error(`fakePostgrest: unsupported or-term ${term}`);
  }
}

export function makeFakeSupabase(db: FakeDb) {
  const from = (table: string) => {
    const preds: Pred[] = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    const log: FakeQueryLog = { table, head: false, limit: null, filters: [], inIds: null };
    let withCount = false;
    let range: [number, number] | null = null;
    const b: any = {};
    const add = (label: string, pred: Pred) => { log.filters.push(label); preds.push(pred); return b; };
    b.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) log.head = true;
      if (opts?.count) withCount = true;
      return b;
    };
    b.eq = (c: string, v: unknown) => add(`eq:${c}=${v}`, (r) => r[c] === v || String(r[c]) === String(v));
    b.neq = (c: string, v: unknown) => add(`neq:${c}=${v}`, (r) => r[c] !== v);
    b.gte = (c: string, v: unknown) => add(`gte:${c}`, (r) => r[c] != null && cmp(r[c], v) >= 0);
    b.gt = (c: string, v: unknown) => add(`gt:${c}`, (r) => r[c] != null && cmp(r[c], v) > 0);
    b.lt = (c: string, v: unknown) => add(`lt:${c}`, (r) => r[c] != null && cmp(r[c], v) < 0);
    b.is = (c: string, v: unknown) => add(`is:${c}=${v}`, (r) => (v === null ? r[c] == null : r[c] === v));
    b.not = (c: string, op: string, v: unknown) => {
      if (op === "is") return add(`not:${c}:is`, (r) => r[c] != null);
      if (op === "in") {
        const list = String(v).replace(/^\(|\)$/g, "").split(",");
        // PostgREST NOT IN: a NULL value is excluded too (three-valued logic).
        return add(`not:${c}:in`, (r) => r[c] != null && !list.includes(String(r[c])));
      }
      throw new Error(`fakePostgrest: unsupported not ${op}`);
    };
    b.in = (c: string, v: unknown[]) => {
      if (c === "id") log.inIds = v.map(String);
      return add(`in:${c}`, (r) => v.map(String).includes(String(r[c])));
    };
    b.or = (expr: string) => {
      const parts = splitTop(expr).map(parseTerm);
      return add(`or:${expr}`, (r) => parts.some((p) => p(r)));
    };
    b.order = (c: string, o?: { ascending?: boolean }) => { orders.push({ col: c, asc: o?.ascending !== false }); return b; };
    b.limit = (n: number) => { log.limit = n; return b; };
    b.range = (a: number, z: number) => { range = [a, z]; return b; };
    b.abortSignal = () => b;
    for (const method of ["update", "insert", "delete", "upsert"]) {
      b[method] = () => { db.writes.push({ table, method }); return b; };
    }
    const run = () => {
      db.queries.push(log);
      const failure = db.failWhen?.(log);
      if (failure) return { data: null, error: failure, count: null };
      let rows = (db.tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      const count = rows.length;
      rows = [...rows].sort((x, y) => {
        for (const { col, asc } of orders) {
          const c = cmp(x[col], y[col]);
          if (c !== 0) return asc ? c : -c;
        }
        return 0;
      });
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (log.limit !== null) rows = rows.slice(0, log.limit);
      if (log.head) return { data: null, error: null, count };
      return { data: rows, error: null, count: withCount ? count : null };
    };
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve().then(run).then(onFulfilled, onRejected);
    return b;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    db.rpcCalls.push({ name, args });
    return Promise.resolve(db.rpc ? db.rpc(name, args) : { data: null, error: { code: "PGRST202", message: "no rpc" } });
  };
  return { from, rpc };
}
