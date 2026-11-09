import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(__dirname, "../../..");
const payloadPath = process.env.REPORTS_SQL_PAYLOADS;
if (!payloadPath) throw new Error("Set REPORTS_SQL_PAYLOADS to the v3 payload file written by scripts/run_reports_v3_tests.sh.");
const raw = readFileSync(path.resolve(payloadPath), "utf8");
const payloads = JSON.parse(raw);
// The v3 payload file (D1 X9): one synthetic actor, the nine v3 readers for agency, team and personal.
if (payloads.fixture?.source !== "reports_v3_performance.sql scale organization (synthetic)" || payloads.scopeV3?.self_id !== payloads.fixture.actor) {
  throw new Error("Reports visual fixture requires the synthetic v3 payload file and its actor.");
}
const V3_KEYS = ["scopeV3", "summaryV3", "journeyV3", "salesAppointmentsV3", "statesV3", "volumeV3", "dispositionsV3", "campaignsV3", "leadSourcesV3"];
for (const scope of ["agency", "personal", "team"]) {
  const bundle = scope === "agency" ? payloads : payloads.scopes?.[scope];
  for (const name of V3_KEYS) {
    if (bundle?.[name]?.basis_version !== "reports_v3") throw new Error(`Missing native v3 SQL payload: ${scope}/${name}`);
    if (bundle[name].requested_scope !== scope) throw new Error(`SQL scope mismatch: ${scope}/${name}`);
  }
  if (bundle.scopeV3.self_id !== payloads.fixture.actor) throw new Error("SQL scope actor mismatch");
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), {
    name: "isolated-reports-sql-payloads",
    resolveId(id) { if (id === "virtual:reports-sql-payloads") return "\0reports-sql-payloads"; },
    load(id) { if (id === "\0reports-sql-payloads") return `export default ${raw};`; },
  }],
  server: { host: "127.0.0.1", port: 4180, strictPort: true, fs: { allow: [root] } },
  resolve: {
    alias: [
      ...["@/contexts/AuthContext", "@/integrations/supabase/client", "@/lib/report-layout"]
        .map((find) => ({ find, replacement: path.join(__dirname, "stubs.ts") })),
      { find: "@", replacement: path.join(root, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  css: { postcss: root },
});
