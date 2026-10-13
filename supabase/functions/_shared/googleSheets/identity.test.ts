import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { identityRows, planRowPosition, planSourceId, type LedgerRow, type PlannedRow } from "./identity.ts";

const row = (n: number, fp: string, opts: Partial<PlannedRow> = {}): PlannedRow =>
  ({ n, fp, idValue: null, empty: false, valid: true, lead: { first_name: "a", last_name: "b", phone: "1", email: "", state: "", lead_source: "" }, ...opts });
const L = (k: string, n: number, f: string, kind: LedgerRow["kind"], reason: string | null = null): LedgerRow => ({ k, n, f, kind, reason });

Deno.test("row mode: baseline rows excluded, appended rows are candidates", () => {
  const p = planRowPosition([row(2, "A"), row(3, "B"), row(4, "C")], [L("pos:2", 2, "A", "baseline"), L("pos:3", 3, "B", "baseline")]);
  assertEquals(p.structural, null);
  assertEquals(p.candidates.map((c) => c.k), ["pos:4"]);
});

Deno.test("row mode: an identical-looking appended row is still a candidate (reaches duplicate policy)", () => {
  const p = planRowPosition([row(2, "A"), row(3, "A")], [L("pos:2", 2, "A", "done")]);
  assertEquals(p.candidates.map((c) => c.k), ["pos:3"]);
});

Deno.test("row mode: insertion + compensating deletion above the old tail (last 25 unchanged) → review", () => {
  const before = Array.from({ length: 60 }, (_, i) => row(i + 2, `F${i}`));
  const ledger = before.map((r) => L(`pos:${r.n}`, r.n, r.fp, "done"));
  // insert X at row 5, delete the row at old row 20 → rows 21..61 (incl. the last 25) are unchanged
  const fps = before.map((r) => r.fp);
  fps.splice(18, 1);       // delete old row 20 (index 18)
  fps.splice(3, 0, "X");   // insert at row 5 (index 3)
  const after = fps.map((f, i) => row(i + 2, f));
  assertEquals(after.slice(-25).map((r) => r.fp), before.slice(-25).map((r) => r.fp));
  const p = planRowPosition(after, ledger);
  assertEquals(p.structural, "rows_changed");
  assertEquals(p.candidates.length, 0);
});

Deno.test("row mode: deletion below recorded rows → rows_removed; sort → rows_changed", () => {
  const ledger = [L("pos:2", 2, "A", "done"), L("pos:3", 3, "B", "done")];
  assertEquals(planRowPosition([row(2, "A")], ledger).structural, "rows_removed");
  assertEquals(planRowPosition([row(2, "B"), row(3, "A")], ledger).structural, "rows_changed");
});

Deno.test("row mode: pending rows are exempt, revisited behind newer rows, and counted once", () => {
  const ledger = [L("pos:2", 2, "A", "done"), L("pos:3", 3, "P", "pending", "missing_phone"), L("pos:4", 4, "C", "done")];
  const stillBad = planRowPosition([row(2, "A"), row(3, "P", { valid: false, reason: "missing_phone" }), row(4, "C")], ledger);
  assertEquals(stillBad.structural, null);
  assertEquals(stillBad.newErrors.length, 0);
  assertEquals(stillBad.ops.length, 0);
  assertEquals(stillBad.pendingCount, 1);
  const fixed = planRowPosition([row(2, "A"), row(3, "P2"), row(4, "C")], ledger);
  assertEquals(fixed.candidates.map((c) => c.k), ["pos:3"]);
  const newBad = planRowPosition([row(2, "A"), row(3, "P"), row(4, "C"), row(5, "Q", { valid: false, reason: "missing_name" })], ledger);
  assertEquals(newBad.newErrors, [{ row: 5, reason: "missing_name" }]);
});

Deno.test("row mode: empty gap rows are pending but not errors", () => {
  const p = planRowPosition([row(2, "A"), row(3, "E", { empty: true, valid: false, reason: "empty" }), row(4, "B")], []);
  assertEquals(p.candidates.map((c) => c.k), ["pos:2", "pos:4"]);
  assertEquals(p.newErrors.length, 0);
  assertEquals(p.ops, [{ k: "pos:3", n: 3, f: "E", reason: "empty" }]);
});

Deno.test("ID mode: sorting never re-imports; receipted/baselined IDs skipped", () => {
  const rows = [row(2, "B", { idValue: "L2" }), row(3, "A", { idValue: "L1" }), row(4, "C", { idValue: "L3" })];
  const p = planSourceId(rows, [L("id:L2", 9, "B", "baseline")], new Set(["id:L1"]));
  assertEquals(p.candidates.map((c) => c.k), ["id:L3"]);
});

Deno.test("ID mode: conflicting duplicate IDs are row errors (no first-row-wins); identical copies import once", () => {
  const conflict = planSourceId([row(2, "A", { idValue: "X" }), row(3, "B", { idValue: "X" })], [], new Set());
  assertEquals(conflict.candidates.length, 0);
  assertEquals(conflict.ops.map((o) => o.k).sort(), ["dup:2", "dup:3"]);
  assertEquals(conflict.newErrors.length, 2);
  const same = planSourceId([row(2, "A", { idValue: "Y" }), row(3, "A", { idValue: "Y" })], [], new Set());
  assertEquals(same.candidates.map((c) => c.k), ["id:Y"]);
  const afterReceipt = planSourceId([row(2, "A", { idValue: "Z" }), row(3, "B", { idValue: "Z" })], [], new Set(["id:Z"]));
  assertEquals(afterReceipt.candidates.length, 0);
  assertEquals(afterReceipt.newErrors.length, 2);
});

Deno.test("ID mode: blank IDs pending until filled; blank baseline carries to its new ID; edited baseline flagged", () => {
  const blank = planSourceId([row(2, "A", { idValue: null })], [], new Set());
  assertEquals(blank.ops, [{ k: "blank:2", n: 2, f: "A", reason: "missing_id" }]);
  const filled = planSourceId([row(2, "A", { idValue: "N1" })], [L("blank:2", 2, "A", "pending", "missing_id")], new Set());
  assertEquals(filled.candidates.map((c) => c.k), ["id:N1"]);
  assert(filled.ops.some((o) => o.k === "blank:2" && "clear" in o));
  const carry = planSourceId([row(2, "A", { idValue: "N2" })], [L("blank:2", 2, "A", "baseline")], new Set());
  assertEquals(carry.candidates.length, 0);
  assertEquals(carry.ops, [{ k: "id:N2", n: 2, f: "A", baseline: true, consume: "blank:2" }]);
  const edited = planSourceId([row(2, "A2", { idValue: "N3" })], [L("blank:2", 2, "A", "baseline")], new Set());
  assertEquals(edited.candidates.length, 0);
  assertEquals(edited.ops, [{ k: "id:N3", n: 2, f: "A2", reason: "baseline_changed" }]);
});

Deno.test("ID mode: a corrected invalid row imports even if other rows have receipts", () => {
  const ledger = [L("id:K", 2, "old", "pending", "missing_phone")];
  const p = planSourceId([row(2, "new", { idValue: "K" }), row(3, "Q", { idValue: "J" })], ledger, new Set(["id:J"]));
  assertEquals(p.candidates.map((c) => c.k), ["id:K"]);
});

Deno.test("identityRows: activation/review payloads", () => {
  const rows = [row(2, "A", { idValue: "X" }), row(3, "B"), row(4, "E", { empty: true })];
  assertEquals(identityRows(rows, "source_id").map((r) => r.k), ["id:X", "blank:3"]);
  assertEquals(identityRows(rows, "row_position").map((r) => r.k), ["pos:2", "pos:3", "pos:4"]);
  assertEquals(identityRows(rows, "row_position", true)[0].id, "X");
});
