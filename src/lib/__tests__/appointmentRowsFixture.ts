/**
 * Test-only: a tiny in-memory evaluator for the PostgREST filters the "Appointments Set" readers emit, so their
 * tests assert ROW OUTCOMES (who is credited for which appointment), not only the query string.
 *
 * Supports `eq`, `gte`, `lt`, `lte`, `in`, `not(col, "in", "(a,b)")` and `or()` over `col.eq.v`, `col.is.null`
 * and nested `and(...)`. Anything else throws, so a reader that starts emitting an unsupported filter fails
 * loudly instead of being silently ignored.
 */
export type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;

function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseTerm(term: string): Pred {
  if (term.startsWith("and(") && term.endsWith(")")) {
    const inner = splitTopLevel(term.slice(4, -1)).map(parseTerm);
    return (row) => inner.every((p) => p(row));
  }
  const [col, op, ...rest] = term.split(".");
  const value = rest.join(".");
  if (op === "eq") return (row) => row[col] != null && String(row[col]) === value;
  if (op === "is" && value === "null") return (row) => row[col] == null;
  throw new Error(`appointmentRowsFixture: unsupported or() term ${term}`);
}

export function parseOrExpression(expr: string): Pred {
  const terms = splitTopLevel(expr).map(parseTerm);
  return (row) => terms.some((p) => p(row));
}

/** Records one query's filters and evaluates them against `rows`. */
export class RecordedQuery {
  readonly calls: Array<[string, ...unknown[]]> = [];
  private preds: Pred[] = [];
  countRequested = false;
  /** True once the query was awaited / resolved (a builder alone sends nothing). */
  executed = false;

  constructor(readonly table: string, private readonly rows: Row[]) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.calls.push(["select", _cols, opts]);
    if (opts?.count === "exact") this.countRequested = true;
    return this;
  }
  eq(col: string, v: unknown) {
    this.calls.push(["eq", col, v]);
    this.preds.push((r) => r[col] === v);
    return this;
  }
  gte(col: string, v: string) {
    this.calls.push(["gte", col, v]);
    this.preds.push((r) => Date.parse(String(r[col])) >= Date.parse(v));
    return this;
  }
  lt(col: string, v: string) {
    this.calls.push(["lt", col, v]);
    this.preds.push((r) => Date.parse(String(r[col])) < Date.parse(v));
    return this;
  }
  lte(col: string, v: string) {
    this.calls.push(["lte", col, v]);
    this.preds.push((r) => Date.parse(String(r[col])) <= Date.parse(v));
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.calls.push(["in", col, vs]);
    this.preds.push((r) => vs.includes(r[col]));
    return this;
  }
  not(col: string, op: string, v: string) {
    this.calls.push(["not", col, op, v]);
    if (op !== "in") throw new Error(`appointmentRowsFixture: unsupported not(${op})`);
    const list = v.replace(/^\(|\)$/g, "").split(",");
    this.preds.push((r) => !list.includes(String(r[col])));
    return this;
  }
  or(expr: string) {
    this.calls.push(["or", expr]);
    this.preds.push(parseOrExpression(expr));
    return this;
  }
  abortSignal() {
    return this;
  }
  matching(): Row[] {
    return this.rows.filter((r) => this.preds.every((p) => p(r)));
  }
  result() {
    const data = this.matching();
    return { data: this.countRequested ? null : data, count: data.length, error: null };
  }
  maybeSingle() {
    this.executed = true;
    return Promise.resolve({ data: this.matching()[0] ?? null, error: null });
  }
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
    this.executed = true;
    return Promise.resolve(this.result()).then(resolve, reject);
  }
}

export const SETTER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ASSIGNEE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const OTHER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * One month of appointments, created on the 10th of `monthStart`'s month (plus one the previous month).
 * Expected "Appointments Set" this month: A = 6 (a1, a3–a7), B = 1 (a2 only), C = 1 (a9).
 */
export function appointmentSetRows(monthStart: Date): Row[] {
  const inMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 10, 12).toISOString();
  const lastMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 20, 12).toISOString();
  const row = (id: string, created_by: string | null, user_id: string | null, status: string, created_at = inMonth) => ({
    id,
    created_by,
    user_id,
    status,
    created_at,
  });
  return [
    row("a1-delegated", SETTER_A, ASSIGNEE_B, "Scheduled"),
    row("a2-legacy", null, ASSIGNEE_B, "Scheduled"),
    row("a3-self", SETTER_A, SETTER_A, "Scheduled"),
    row("a4-cancelled", SETTER_A, SETTER_A, "Cancelled"),
    row("a5-no-show", SETTER_A, OTHER_C, "No Show"),
    row("a6-completed", SETTER_A, SETTER_A, "Completed"),
    row("a7-rescheduled", SETTER_A, SETTER_A, "Rescheduled"),
    row("a8-last-month", SETTER_A, SETTER_A, "Scheduled", lastMonth),
    row("a9-booked-for-a", OTHER_C, SETTER_A, "Scheduled"),
  ];
}
