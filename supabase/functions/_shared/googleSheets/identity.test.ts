import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { classifySourceIdRows, identityReview, identityRows, planRowPosition, planSourceId, type LedgerRow, type PlannedRow } from "./identity.ts";

// sig defaults to the fingerprint (same core ⇒ same content) unless a test sets it explicitly.
const row = (n: number, fp: string, opts: Partial<PlannedRow> = {}): PlannedRow =>
  ({ n, fp, sig: fp, idValue: null, empty: false, valid: true, lead: { first_name: "a", last_name: "b", phone: "1", email: "", state: "", lead_source: "" }, ...opts });
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

Deno.test("ID mode: blank IDs are noid:<n> errors until filled; in-place completion carries; edited completion → review", () => {
  const blank = planSourceId([row(2, "A", { idValue: null })], [], new Set());
  assertEquals(blank.ops, [{ k: "noid:2", n: 2, f: "A", reason: "missing_id" }]);
  const again = planSourceId([row(2, "A", { idValue: null })], [L("noid:2", 2, "A", "pending", "missing_id")], new Set());
  assertEquals(again.newErrors.length, 0, "unchanged missing ID is not recounted");
  const filled = planSourceId([row(2, "A", { idValue: "N1" })], [L("noid:2", 2, "A", "pending", "missing_id")], new Set());
  assertEquals(filled.candidates.map((c) => c.k), ["id:N1"]);
  assert(filled.ops.some((o) => o.k === "noid:2" && "clear" in o));
  const carry = planSourceId([row(2, "A", { idValue: "N2" })], [L("blank:2", 2, "A", "baseline")], new Set());
  assertEquals(carry.candidates.length, 0);
  assertEquals(carry.ops, [{ k: "id:N2", n: 2, f: "A", baseline: true, consume: "blank:2" }]);
  const edited = planSourceId([row(2, "A2", { idValue: "N3" })], [L("blank:2", 2, "A", "baseline")], new Set());
  assertEquals(edited.candidates.length, 0);
  assertEquals(edited.structural, "identity_ambiguous");
  assertEquals(edited.ops.length, 0, "nothing is written while identity is ambiguous");
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

// ------------------------------------------------------------------ excluded blank-ID accounting (Amendment A)
const B = (n: number, f: string) => L(`blank:${n}`, n, f, "baseline");

Deno.test("accounting: blank baseline still in place → fast path; new IDs import, nothing reviewed", () => {
  const p = planSourceId([row(2, "A"), row(3, "N", { idValue: "N1" })], [B(2, "A")], new Set());
  assertEquals(p.structural, null);
  assertEquals(p.candidates.map((c) => c.k), ["id:N1"]);
  assertEquals(p.ops.length, 0);
});

Deno.test("accounting: unaccounted excluded row + ANY unseen ID → review (no content or position match needed)", () => {
  const moved = planSourceId([row(2, "X", { idValue: "X1" }), row(3, "A")], [B(2, "A")], new Set(["id:X1"]));
  assertEquals(moved.structural, null, "moved but nothing new: nothing can be imported wrongly");
  const unrelated = planSourceId([row(2, "X", { idValue: "X1" }), row(3, "A"), row(4, "Z", { idValue: "Z9" })], [B(2, "A")], new Set(["id:X1"]));
  assertEquals(unrelated.structural, "identity_ambiguous");
  assertEquals(unrelated.candidates.length, 0);
  const deleted = planSourceId([row(2, "X", { idValue: "X1" }), row(3, "Z", { idValue: "Z9" })], [B(2, "A")], new Set(["id:X1"]));
  assertEquals(deleted.structural, "identity_ambiguous");
});

Deno.test("accounting: moved excluded rows with nothing new stay silent and are never errors or writes", () => {
  const p = planSourceId([row(2, "C"), row(3, "A")], [B(2, "A"), B(3, "C")], new Set());
  assertEquals(p.structural, null);
  assertEquals(p.ops.length, 0);
  assertEquals(p.newErrors.length, 0);
});

Deno.test("accounting: identical-looking new row next to the excluded twin → review (content cannot tell them apart)", () => {
  const p = planSourceId([row(2, "A"), row(3, "A", { idValue: "N9" })], [B(2, "A")], new Set());
  assertEquals(p.structural, "identity_ambiguous");
});

Deno.test("accounting: in-place completion is trusted only without an identical blank twin or a conflicting ID", () => {
  const twin = planSourceId([row(2, "A", { idValue: "N2" }), row(3, "A")], [B(2, "A")], new Set());
  assertEquals(twin.structural, "identity_ambiguous");
  const conflict = planSourceId([row(2, "A", { idValue: "N2" }), row(3, "Q", { idValue: "N2" })], [B(2, "A")], new Set());
  assertEquals(conflict.structural, "identity_ambiguous");
});

Deno.test("accounting: approved IDs import despite unresolved exclusions and never count as possible excluded rows", () => {
  const ledger = [B(2, "A"), L("approved:N9", 3, "A", "approved")];
  const p = planSourceId([row(2, "X", { idValue: "X1" }), row(3, "A", { idValue: "N9" })], ledger, new Set(["id:X1"]));
  assertEquals(p.structural, null);
  assertEquals(p.candidates.map((c) => c.k), ["id:N9"]);
  const twinApproved = planSourceId([row(2, "A"), row(3, "A", { idValue: "N9" })], [B(2, "A"), L("approved:N9", 3, "A", "approved")], new Set());
  assertEquals(twinApproved.structural, null);
  assertEquals(twinApproved.candidates.map((c) => c.k), ["id:N9"]);
});

Deno.test("accounting: an approval is cleared when its ID leaves the sheet", () => {
  const p = planSourceId([row(2, "A")], [B(2, "A"), L("approved:GONE", 5, "Q", "approved")], new Set());
  assert(p.ops.some((o) => o.k === "approved:GONE" && "clear" in o));
});

Deno.test("accounting RESIDUAL: a different blank row identical to the excluded row's original content at its exact position stands in for it", () => {
  // The excluded row (A at row 2) was edited to E, moved and completed; a new blank row identical to A sits at row 2.
  const p = planSourceId([row(2, "A"), row(3, "E", { idValue: "E1" })], [B(2, "A")], new Set());
  assertEquals(p.structural, null);
  assertEquals(p.candidates.map((c) => c.k), ["id:E1"], "documented residual: the excluded content A is still present and excluded");
});

Deno.test("classifier: missing_id / duplicate_id (any mapped difference) / repeat / ok; empty rows skipped", () => {
  const c = classifySourceIdRows([
    row(2, "A"), row(3, "B", { idValue: "X", sig: "s1" }), row(4, "B", { idValue: "X", sig: "s2" }),
    row(5, "C", { idValue: "Y" }), row(6, "C", { idValue: "Y" }), row(7, "D", { idValue: "Z" }), row(8, "E", { empty: true }),
  ]);
  assertEquals([...c.entries()], [[2, "missing_id"], [3, "duplicate_id"], [4, "duplicate_id"], [5, "ok"], [6, "repeat"], [7, "ok"]]);
});

Deno.test("identityReview: every unseen ID and every non-kept blank row needs a decision; hints are informational", () => {
  const ledger = [B(2, "A"), B(3, "C"), B(6, "K"), L("id:X1", 4, "X", "baseline")];
  const rows = [
    row(2, "C"),                          // excluded C moved up (still blank) → decision, hint content
    row(3, "Q", { idValue: "Q1" }),        // unrelated new ID at an excluded row's position → decision, hint position
    row(4, "X", { idValue: "X1" }),        // established by ID baseline → not offered
    row(5, "A", { idValue: "A7" }),        // excluded A moved and completed → decision, hint content
    row(6, "K"),                          // excluded K still in place → kept
    row(7, "Z", { idValue: "Z1", valid: false, reason: "missing_phone" }), // unrelated, invalid → decision, no hint
  ];
  const r = identityReview(rows, ledger, new Set());
  assertEquals(r.decide.map((d) => [d.k, d.hint]), [["noid:2", "content"], ["id:Q1", "position"], ["id:A7", "content"], ["id:Z1", null]]);
  assertEquals(r.retire, ["blank:2", "blank:3"]);
  assertEquals(r.kept, ["blank:6"]);
  assertEquals(r.unresolvedRows, [2, 3]);
  assertEquals(r.established, 1);
  assertEquals(r.decide.find((d) => d.k === "id:Z1")?.reason, "missing_phone");
});

Deno.test("identityReview: an in-place completion inside an otherwise ambiguous sheet is offered and its baseline retired", () => {
  const r = identityReview([row(2, "A", { idValue: "A1" }), row(3, "Z", { idValue: "Z1" })], [B(2, "A"), B(9, "G")], new Set());
  assertEquals(r.decide.map((d) => [d.k, d.hint]), [["id:A1", "same_row"], ["id:Z1", null]]);
  assertEquals(r.retire, ["blank:2", "blank:9"]);
  assertEquals(r.kept, []);
});

Deno.test("identityReview: nothing unresolved any more → no decisions, every baseline accounted as kept", () => {
  const r = identityReview([row(2, "A"), row(3, "N", { idValue: "N1" })], [B(2, "A")], new Set());
  assertEquals(r.decide, []);
  assertEquals(r.kept, ["blank:2"]);
  assertEquals(r.retire, []);
});
