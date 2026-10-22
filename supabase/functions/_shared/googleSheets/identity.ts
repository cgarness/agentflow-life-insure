// Row identity and per-sync planning (plan §0.4, corrected in §0.9). Pure: given one consistent read (built
// rows) and the stored ledger, decide structural review, import candidates and pending/clear operations.
//
// Source Lead ID mode: identity = trimmed, case-sensitive ID. Sorting/moving never matters for rows WITH an ID.
// Rows sharing an ID import once only when every mapped value is identical (content signature); otherwise every
// copy is a row error (no first-row-wins). Blank IDs never import: a blank row is either an excluded baseline
// (`blank:<n>`, from activation or a review) or a `missing_id` error (`noid:<n>`) until it gets an ID.
// Excluded blank-ID rows have no stable identity, so each sync accounts for them (accountBlankBaselines): when
// one can no longer be accounted for safely and any unseen Lead ID appears, the sheet needs review and nothing
// is imported (content match and original position are hints, never requirements).
// Row-position mode: identity = position. EVERY baseline/done position must still match its stored core
// fingerprint and the data must not shrink below them; otherwise Needs review and nothing is imported.
// Pending positions are exempt (corrections are expected) and are revisited even behind newer rows.
// Appended rows are never classified by content: a new position is always a candidate.
import type { LeadPayload } from "./mapping.ts";

export interface LedgerRow { k: string; n: number; f: string; kind: "baseline" | "pending" | "done" | "approved"; reason: string | null }
export interface PlannedRow {
  n: number;            // sheet row number (header = 1)
  idValue: string | null;
  empty: boolean;
  valid: boolean;
  reason?: string;
  fp: string;           // core fingerprint (first, last, phone digits, email)
  sig: string;          // content signature over every mapped value (+ Lead ID)
  lead?: LeadPayload;
  display?: { first_name: string; last_name: string; phone: string; email: string };
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

export type IdClass = "missing_id" | "duplicate_id" | "repeat" | "ok";

/**
 * Shared ID classification (planner AND preview, so they always agree). Empty rows are absent from the result.
 * blank ID → missing_id; rows sharing an ID with different content signatures → duplicate_id (every copy);
 * identical copies → first ok, the rest repeat (imported once); otherwise ok.
 */
export function classifySourceIdRows(rows: PlannedRow[]): Map<number, IdClass> {
  const out = new Map<number, IdClass>();
  const groups = new Map<string, PlannedRow[]>();
  for (const r of rows) {
    if (r.empty) continue;
    if (!r.idValue) { out.set(r.n, "missing_id"); continue; }
    const g = groups.get(r.idValue);
    if (g) g.push(r); else groups.set(r.idValue, [r]);
  }
  for (const g of groups.values()) {
    if (new Set(g.map((r) => r.sig)).size > 1) { for (const r of g) out.set(r.n, "duplicate_id"); continue; }
    g.forEach((r, i) => out.set(r.n, i === 0 ? "ok" : "repeat"));
  }
  return out;
}

interface IdView {
  cls: Map<number, IdClass>;
  established: (id: string) => boolean;
  approved: (id: string) => boolean;
  /** A non-empty row with an ID that is neither established (receipt / ID baseline) nor approved. */
  unseen: (r: PlannedRow) => boolean;
}

function idView(rows: PlannedRow[], recs: Map<string, LedgerRow>, receiptKeys: Set<string>): IdView {
  const established = (id: string) => receiptKeys.has(`id:${id}`) || recs.get(`id:${id}`)?.kind === "baseline";
  const approved = (id: string) => recs.get(`approved:${id}`)?.kind === "approved";
  return {
    cls: classifySourceIdRows(rows), established, approved,
    unseen: (r) => !r.empty && !!r.idValue && !established(r.idValue) && !approved(r.idValue),
  };
}

export interface BlankAccounting {
  /** Safely accounted baselines whose row is still blank in place (stay excluded). */
  kept: LedgerRow[];
  /** Safely accounted baselines whose row was completed in place (consumed by a carry to an ID baseline). */
  carries: { base: LedgerRow; row: PlannedRow }[];
  /** Baselines that cannot be accounted for safely (U). */
  unresolved: LedgerRow[];
  /** Row numbers of blank rows anchored to kept baselines. */
  keptRows: Set<number>;
}

/**
 * Accounts for every excluded blank-ID baseline, per core-fingerprint group f:
 *  - anchored: the row at the baseline's exact position has fingerprint f and no established/approved ID;
 *  - the group is safely accounted only if every baseline is anchored, no other row with fingerprint f has an
 *    unseen ID, an in-place completion (anchored row with an ID) has no other blank/unseen row with fingerprint f,
 *    and no completed row's ID is a conflicting duplicate.
 * Anything else is unresolved: the excluded row may have been moved, edited, completed or deleted.
 */
export function accountBlankBaselines(rows: PlannedRow[], ledger: LedgerRow[], v: IdView): BlankAccounting {
  const out: BlankAccounting = { kept: [], carries: [], unresolved: [], keptRows: new Set() };
  const byN = new Map(rows.map((r) => [r.n, r]));
  const open = (r: PlannedRow) => !r.empty && (!r.idValue || v.unseen(r));
  const groups = new Map<string, LedgerRow[]>();
  for (const b of ledger) {
    if (b.kind !== "baseline" || !b.k.startsWith("blank:")) continue;
    const g = groups.get(b.f);
    if (g) g.push(b); else groups.set(b.f, [b]);
  }
  for (const [f, bases] of groups) {
    const anchored = new Map<string, PlannedRow>();
    for (const b of bases) {
      const r = byN.get(b.n);
      if (r && open(r) && r.fp === f) anchored.set(b.k, r);
    }
    const anchoredNs = new Set([...anchored.values()].map((r) => r.n));
    const extras = rows.filter((r) => open(r) && r.fp === f && !anchoredNs.has(r.n));
    const completed = [...anchored.values()].filter((r) => r.idValue);
    const safe = anchored.size === bases.length
      && !extras.some((r) => r.idValue)
      && (completed.length === 0 || extras.length === 0)
      && !completed.some((r) => v.cls.get(r.n) !== "ok");
    if (!safe) { out.unresolved.push(...bases); continue; }
    for (const b of bases) {
      const r = anchored.get(b.k)!;
      if (r.idValue) out.carries.push({ base: b, row: r });
      else { out.kept.push(b); out.keptRows.add(r.n); }
    }
  }
  return out;
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
  const v = idView(rows, recs, receiptKeys);
  const acct = accountBlankBaselines(rows, ledger, v);
  // An excluded row that cannot be accounted for could be ANY unseen-ID row (moved, edited and completed):
  // the whole sheet waits for the agent's review; nothing is written this run (decision 1).
  if (acct.unresolved.length > 0 && rows.some((r) => v.unseen(r))) { plan.structural = "identity_ambiguous"; return plan; }

  const carried = new Set<string>();
  for (const { base, row } of acct.carries) {
    const k = `id:${row.idValue}`;
    plan.ops.push({ k, n: row.n, f: row.fp, baseline: true, consume: base.k });
    carried.add(row.idValue!);
    emitted.add(k);
  }
  const unresolvedFps = new Set(acct.unresolved.map((b) => b.f));
  for (const row of rows) {
    if (row.empty) continue;
    if (!row.idValue) {
      if (acct.keptRows.has(row.n)) continue;          // excluded baseline row, still in place
      if (unresolvedFps.has(row.fp)) continue;          // most likely a moved excluded row; it can never import
      pend(`noid:${row.n}`, row, "missing_id");
      continue;
    }
    const id = row.idValue;
    const c = v.cls.get(row.n);
    if (c === "duplicate_id") { pend(`dup:${row.n}`, row, "duplicate_id"); continue; }
    if (v.established(id) || carried.has(id) || c === "repeat") continue;
    const k = `id:${id}`;
    if (row.valid) { plan.candidates.push({ k, row }); emitted.add(k); continue; }
    pend(k, row, row.reason ?? "invalid");
  }
  const liveIds = new Set(rows.filter((r) => !r.empty && r.idValue && !v.established(r.idValue)).map((r) => r.idValue as string));
  for (const r of ledger) {
    if (r.kind === "pending" && !emitted.has(r.k)) plan.ops.push({ k: r.k, clear: true });
    if (r.kind === "approved" && !liveIds.has(r.k.slice("approved:".length))) plan.ops.push({ k: r.k, clear: true });
  }
  return plan;
}

export type ReviewHint = "same_row" | "content" | "position" | null;
export interface IdentityDecisionRow {
  k: string;            // "id:<X>" (one per unseen ID) or "noid:<n>" (one per blank row)
  n: number;
  f: string;
  s: string;
  id: string | null;
  hint: ReviewHint;
  valid: boolean;
  reason: string | null; // invalid reason, "duplicate_id", or null
  rows: number;          // rows sharing this ID
}
export interface IdentityReview {
  decide: IdentityDecisionRow[];
  retire: string[];      // blank baselines replaced by the agent's decisions
  kept: string[];        // blank baselines still safely in place
  unresolvedRows: number[];
  established: number;
  approved: number;
  keptRows: number;
}

/**
 * Identity review classification (identity_ambiguous). While an excluded row is unaccounted for, EVERY unseen
 * Lead ID and every blank row that is not a kept baseline could be one of the excluded rows, so each needs the
 * agent's explicit decision; hints (same row / content / original position) are informational only.
 */
export function identityReview(rows: PlannedRow[], ledger: LedgerRow[], receiptKeys: Set<string>): IdentityReview {
  const recs = new Map(ledger.map((r) => [r.k, r]));
  const v = idView(rows, recs, receiptKeys);
  const acct = accountBlankBaselines(rows, ledger, v);
  const nonEmpty = rows.filter((r) => !r.empty);
  const base = {
    unresolvedRows: acct.unresolved.map((b) => b.n).sort((a, b) => a - b),
    established: nonEmpty.filter((r) => r.idValue && v.established(r.idValue)).length,
    approved: nonEmpty.filter((r) => r.idValue && !v.established(r.idValue) && v.approved(r.idValue)).length,
  };
  if (acct.unresolved.length === 0) {
    // Nothing unresolved any more: no decisions; completed-in-place rows are carried by the next sync.
    return { decide: [], retire: [], kept: [...acct.kept, ...acct.carries.map((c) => c.base)].map((b) => b.k).sort(),
      ...base, keptRows: acct.keptRows.size };
  }
  const retired = [...acct.unresolved, ...acct.carries.map((c) => c.base)];
  const fps = new Set(retired.map((b) => b.f));
  const ns = new Set(retired.map((b) => b.n));
  const same = new Set(retired.map((b) => `${b.n}|${b.f}`));
  const rank: Record<string, number> = { same_row: 3, content: 2, position: 1 };
  const hintOf = (r: PlannedRow): ReviewHint =>
    same.has(`${r.n}|${r.fp}`) ? "same_row" : fps.has(r.fp) ? "content" : ns.has(r.n) ? "position" : null;
  const decide: IdentityDecisionRow[] = [];
  const byId = new Map<string, PlannedRow[]>();
  for (const r of nonEmpty) {
    if (!r.idValue) {
      if (acct.keptRows.has(r.n)) continue;
      decide.push({ k: `noid:${r.n}`, n: r.n, f: r.fp, s: r.sig, id: null, hint: hintOf(r), valid: false, reason: "missing_id", rows: 1 });
      continue;
    }
    if (!v.unseen(r)) continue;
    const g = byId.get(r.idValue);
    if (g) g.push(r); else byId.set(r.idValue, [r]);
  }
  for (const [id, g] of byId) {
    const first = g[0];
    const hint = g.map(hintOf).reduce<ReviewHint>((a, h) => ((rank[h ?? ""] ?? 0) > (rank[a ?? ""] ?? 0) ? h : a), null);
    const conflict = v.cls.get(first.n) === "duplicate_id";
    decide.push({ k: `id:${id}`, n: first.n, f: first.fp, s: first.sig, id, hint, valid: !conflict && first.valid,
      reason: conflict ? "duplicate_id" : first.valid ? null : (first.reason ?? "invalid"), rows: g.length });
  }
  decide.sort((a, b) => a.n - b.n || (a.k < b.k ? -1 : 1));
  return { decide, retire: retired.map((b) => b.k).sort(), kept: acct.kept.map((b) => b.k).sort(), ...base, keptRows: acct.keptRows.size };
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
