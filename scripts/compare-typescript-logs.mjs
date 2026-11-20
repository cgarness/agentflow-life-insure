// Preserve exact-base diagnostics; only source line/column positions may move.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function normalizeDiagnosticPositions(text) {
  return text.replace(/^(.*)\(\d+,\d+\)(: error TS\d+:)/gm, "$1(LINE,COLUMN)$2");
}

export function compareTypeScriptLogs(before, after, beforeStatus, afterStatus) {
  for (const status of [beforeStatus, afterStatus]) {
    assert(Number.isInteger(status) && status >= 0 && status <= 255, "Invalid compiler exit status");
  }
  assert.equal(afterStatus, beforeStatus, "Application compiler exit status changed");
  const count = (text) => (text.match(/^.*(?:\(\d+,\d+\): |^)error TS\d+:/gm) || []).length;
  const beforeCount = count(before), afterCount = count(after);
  if (beforeStatus !== 0) {
    assert(beforeCount > 0 && afterCount > 0, "Compiler failed without recognizable TypeScript diagnostics");
  }
  assert.equal(normalizeDiagnosticPositions(after), normalizeDiagnosticPositions(before),
    "Application diagnostic content changed (only source positions may differ)");
  return { beforeCount, afterCount };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [beforeFile, afterFile, beforeStatus, afterStatus, ...extra] = process.argv.slice(2);
    assert(beforeFile && afterFile && beforeStatus !== undefined && afterStatus !== undefined && !extra.length,
      "Usage: node scripts/compare-typescript-logs.mjs BASE_LOG HEAD_LOG BASE_EXIT HEAD_EXIT");
    assert(/^\d+$/.test(beforeStatus) && /^\d+$/.test(afterStatus), "Compiler statuses must be integers");
    const result = compareTypeScriptLogs(readFileSync(beforeFile, "utf8"), readFileSync(afterFile, "utf8"),
      Number(beforeStatus), Number(afterStatus));
    console.log(`App TypeScript exact-base match: base=${result.beforeCount}, candidate=${result.afterCount}; positions normalized only`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
