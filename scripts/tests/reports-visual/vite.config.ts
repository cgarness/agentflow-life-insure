import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(__dirname, "../../..");
const payloadPath = path.resolve(process.env.REPORTS_SQL_PAYLOADS || path.join(root, "reports-integrity-payloads.json"));
const raw = readFileSync(payloadPath, "utf8");
const payloads = JSON.parse(raw);
if (payloads.scope?.self_id !== "f5000000-0000-0000-0000-000000000002") {
  throw new Error("Reports visual fixture requires the synthetic integrity-test actor.");
}
for (const name of ["scope", "summary", "volume", "dispositions", "campaigns", "leadSources"]) {
  if (!payloads[name]) throw new Error(`Missing native SQL payload: ${name}`);
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
