// Row identity and per-sync planning (plan §0.4). Pure: given one consistent read (built rows) and the
// stored ledger, decide structural review, import candidates and pending/clear operations.
//
// Source Lead ID mode: identity = trimmed, case-sensitive ID. Sorting/moving never matters. Conflicting
// duplicate IDs are row errors (no first-row-wins). Blank IDs are pending until filled.
// Row-position mode: identity = position. EVERY baseline/done position must still match its stored core
// fingerprint and the data must not shrink below them; otherwise Needs review and nothing is imported.
// Pending positions are exempt (corrections are expected) and are revisited even behind newer rows.
// Appended rows are never classified by content: a new position is always a candidate.
import type { LeadPayload } from "./mapping.ts";

export interface LedgerRow { k: string; n: number; f: string; kind: "baseline" | "pending" | "done"; reason: string | null }
export interface PlannedRow {
  n: number;            // sheet row number (header = 1)
  idValue: string | null;
  empty: boolean;
  valid: boolean;
  reason?: string;
  fp: string;
  lead?: LeadPayload;
}
export type PendingOp =
  | { k: string; n: number; f: string; reason: string }
  | { k: string; clear: true }
  | { k: string; n: number; f: string; baseline: true; consume: string };

export interface Plan {
  structural: string | null;
  candidates: { k: string; row: PlannedRow }[];
  ops: PendingOp[];
  newErrors: { row: number; reason: string }[];
  pendingCount: number;
}

const changed = (rec: LedgerRow | undefined, f: string, reason: string) =>
  !rec || rec.kind !== "pending" || rec.f !== f || (rec.reason ?? "") !== reason;

export function planRowPosition(rows: PlannedRow[], ledger: LedgerRow[]): Plan {
  const recs = new Map(ledger.map((r) => [r.k, r]));
  const plan: Plan = { structural: null, candidates: [], ops: [], newErrors: [], pendingCount: 0 };
  const lastRow = rows.length + 1;
  const fixed = ledger.filter((r) => r.kind === "baseline" || r.kind === "done");
  const maxFixed = fixed.reduce((m, r) => Math.max(m, r.n), 0);
  if (maxFixed > lastRow) { plan.structural = "rows_removed"; return plan; }
  for (const r of fixed) {
    if (rows[r.n - 2]?.fp !== r.f) { plan.structural = "rows_changed"; return plan; }
  }
  const emitted = new Set<string>();
  for (const row of rows) {
    const k = `pos:${row.n}`;
    const rec = recs.get(k);
    if (rec && rec.kind !== "pending") continue;
    if (row.valid) { plan.candidates.push({ k, row }); emitted.add(k); continue; }
    const reason = row.reason ?? "invalid";
    emitted.add(k);
    if (reason !== "empty") plan.pendingCount++;
    if (changed(rec, row.fp, reason)) {
      plan.ops.push({ k, n: row.n, f: row.fp, reason });
      if (reason !== "empty") plan.newErrors.push({ row: row.n, reason });
    }
  }
  for (const r of ledger) if (r.kind === "pending" && !emitted.has(r.k)) plan.ops.push({ k: r.k, clear: true });
  return plan;
}

export function planSourceId(rows: PlannedRow[], ledger: LedgerRow[], receiptKeys: Set<string>): Plan {
  const recs = new Map(ledger.map((r) => [r.k, r]));
  const plan: Plan = { structural: null, candidates: [], ops: [], newErrors: [], pendingCount: 0 };
  const emitted = new Set<string>();
  const pend = (k: string, row: PlannedRow, reason: string) => {
    emitted.add(k);
    plan.pendingCount++;
    if (changed(recs.get(k), row.fp, reason)) {
      plan.ops.push({ k, n: row.n, f: row.fp, reason });
      plan.newErrors.push({ row: row.n, reason });
    }
  };
  const groups = new Map<string, PlannedRow[]>();
  for (const row of rows) {
    if (row.empty) continue;
    if (!row.idValue) {
      const bk = `blank:${row.n}`;
      const base = recs.get(bk);
      if (base?.kind === "baseline" && base.f === row.fp) continue; // excluded baseline row, unchanged
      pend(bk, row, base?.kind === "baseline" ? "baseline_changed" : "missing_id");
      continue;
    }
    groups.set(row.idValue, [...(groups.get(row.idValue) ?? []), row]);
  }
  for (const [id, group] of groups) {
    const k = `id:${id}`;
    const conflict = new Set(group.map((r) => r.fp)).size > 1;
    const done = receiptKeys.has(k) || recs.get(k)?.kind === "baseline";
    if (conflict) { for (const r of group) pend(`dup:${r.n}`, r, "duplicate_id"); continue; }
    if (done) continue;
    const row = group[0]; // identical copies import once
    const blankBase = recs.get(`blank:${row.n}`);
    if (blankBase?.kind === "baseline") {
      if (blankBase.f === row.fp) {
        plan.ops.push({ k, n: row.n, f: row.fp, baseline: true, consume: `blank:${row.n}` });
        emitted.add(k);
      } else {
        pend(k, row, "baseline_changed");
      }
      continue;
    }
    if (row.valid) { plan.candidates.push({ k, row }); emitted.add(k); continue; }
    pend(k, row, row.reason ?? "invalid");
  }
  for (const r of ledger) if (r.kind === "pending" && !emitted.has(r.k)) plan.ops.push({ k: r.k, clear: true });
  return plan;
}

/** Rows for activation baselines / reviews: every data row under the given identity. */
export function identityRows(rows: PlannedRow[], mode: "source_id" | "row_position", withId = false): { k: string; n: number; f: string; id?: string }[] {
  if (mode === "row_position") {
    return rows.map((r) => ({ k: `pos:${r.n}`, n: r.n, f: r.fp, ...(withId && r.idValue ? { id: r.idValue } : {}) }));
  }
  return rows.filter((r) => !r.empty).map((r) => ({
    k: r.idValue ? `id:${r.idValue}` : `blank:${r.n}`, n: r.n, f: r.fp, ...(r.idValue ? { id: r.idValue } : {}),
  }));
}
