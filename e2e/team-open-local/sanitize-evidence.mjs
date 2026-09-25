// TEST-ONLY: derive a publishable evidence file from a raw scenarios.mjs `evidence.json`
// (implementation_plan.md §10).
//
// Scenario rows are kept verbatim except for redaction. Network data is summarised:
//   - API/Auth/REST/RPC/Functions endpoint counts for the local gateway;
//   - a count of dev-server module requests;
//   - console errors collapsed to counts.
//
// Redacted: JWT-shaped strings, `apikey=` / `access_token=` query values, and any `Bearer` value.
// The raw file's sha256 is recorded, so the derived file can be traced back to the original run.
//
// Usage: node sanitize-evidence.mjs <raw evidence.json> <out.json> <run label>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [src, out, runLabel] = process.argv.slice(2);
const raw = readFileSync(src);
const redact = (s) =>
  String(s)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>")
    .replace(/eyJ[A-Za-z0-9_-]{8,}/g, "<redacted-jwt>")
    .replace(/(apikey|access_token|refresh_token|token)=[^&\s'"]+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[^\s'"]+/gi, "Bearer <redacted>");
const deep = (v) =>
  Array.isArray(v) ? v.map(deep)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
      : typeof v === "string" ? redact(v) : v;

const d = JSON.parse(raw.toString());
const count = (arr) => arr.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const network = d.network.map((n) => {
  const api = {}; let devServerModuleRequests = 0;
  for (const [k, v] of Object.entries(n.endpoints)) {
    if (k.includes("127.0.0.1:54321")) api[k] = v; else devServerModuleRequests += v;
  }
  return {
    label: n.label,
    hosts: n.hosts,
    websockets: n.websockets,
    blockedNonLoopback: count(n.blockedNonLoopback.map((u) => u.split("?")[0])),
    httpErrors: count(n.httpErrors.map((e) => e.split("?")[0])),
    localApiEndpoints: api,
    devServerModuleRequests,
    consoleErrors: count(n.consoleErrors.map((e) => redact(e).slice(0, 200))),
  };
});
const result = deep({
  run: runLabel,
  derivedFrom: { file: "evidence.json (raw, not published)", sha256: createHash("sha256").update(raw).digest("hex"), bytes: raw.length },
  sanitizer: "e2e/team-open-local/sanitize-evidence.mjs",
  scenarios: d.scenarios,
  network,
});
const text = JSON.stringify(result, null, 2);
if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) throw new Error("JWT-shaped string survived sanitisation");
writeFileSync(out, text + "\n");
console.log(`${out}: ${text.length} bytes (raw ${raw.length})`);
