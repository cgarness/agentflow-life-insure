import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTypeScriptLogs, normalizeDiagnosticPositions } from "../compare-typescript-logs.mjs";

const diagnostic = "src/example.tsx(10,2): error TS2322: Type 'number' is not assignable to type 'string'.\n  Type '(12,34)' retains its complete explanation.\n";
const moved = diagnostic.replace("(10,2)", "(200,44)");

test("line and column movement is accepted without changing diagnostic content", () => {
  assert.deepEqual(compareTypeScriptLogs(diagnostic, moved, 2, 2), { beforeCount: 1, afterCount: 1 });
  assert.match(normalizeDiagnosticPositions(moved), /Type '\(12,34\)'/);
});
test("matching clean compiler runs are accepted", () => {
  assert.deepEqual(compareTypeScriptLogs("", "", 0, 0), { beforeCount: 0, afterCount: 0 });
});
for (const [name, changed] of [
  ["new error code", diagnostic.replace("TS2322", "TS9999")],
  ["changed path", diagnostic.replace("example.tsx", "other.tsx")],
  ["changed message with the same count", diagnostic.replace("number", "boolean")],
  ["changed continuation line", diagnostic.replace("complete explanation", "different explanation")],
  ["duplicate diagnostic", diagnostic + diagnostic],
  ["removed diagnostic", ""],
  ["extra non-diagnostic output", diagnostic + "Unexpected tool failure\n"],
]) {
  test(`rejects ${name}`, () => assert.throws(() => compareTypeScriptLogs(diagnostic, changed, 2, 2)));
}
test("compiler crashes cannot pass as equal inherited errors", () => {
  assert.throws(() => compareTypeScriptLogs("Cannot run compiler\n", "Cannot run compiler\n", 1, 1));
});
test("different exit status fails even with identical diagnostic text", () => {
  assert.throws(() => compareTypeScriptLogs(diagnostic, diagnostic, 2, 1));
});
test("invalid or signal-like statuses are refused", () => {
  for (const status of [-1, 256, NaN, 1.5, null]) {
    assert.throws(() => compareTypeScriptLogs(diagnostic, diagnostic, status, status));
  }
});
