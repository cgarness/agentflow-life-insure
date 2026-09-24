// TEST-ONLY: write the disposable local credentials file for the harness (implementation_plan.md §10).
// It reads `npx supabase status --workdir <ws> -o json` from stdin and writes <ws>/lv.env.json OUTSIDE
// the repository. The fixture password is generated fresh at runtime; no reusable credential is ever
// committed. It refuses any non-loopback API URL or non-local-demo key.
//
// Usage: npx supabase status --workdir $WS -o json | node local-env.mjs $WS
import { readFileSync, writeFileSync, chmodSync, existsSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isInsideRepo(p, repo) {
  // Resolve symlinks through the nearest existing ancestor, then treat only ".." / "../…" as outside.
  let probe = path.resolve(p); const tail = [];
  while (!existsSync(probe) && path.dirname(probe) !== probe) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
  const real = path.join(realpathSync(probe), ...tail);
  const rel = path.relative(realpathSync(repo), real);
  return rel === "" || !(rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel));
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ws = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || isInsideRepo(ws, REPO)) throw new Error("refusing to write credentials inside the repository");
const s = JSON.parse(readFileSync(0, "utf8"));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(s.API_URL)) throw new Error(`refusing non-loopback API_URL ${s.API_URL}`);
for (const k of ["ANON_KEY", "SERVICE_ROLE_KEY"]) {
  const iss = JSON.parse(Buffer.from(s[k].split(".")[1], "base64url").toString()).iss;
  if (iss !== "supabase-demo") throw new Error(`refusing ${k}: issuer ${iss} is not the local demo issuer`);
}
const file = path.join(ws, "lv.env.json");
writeFileSync(file, JSON.stringify({
  API_URL: s.API_URL,
  ANON_KEY: s.ANON_KEY,
  SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
  DB_CONTAINER: "supabase_db_agentflow-localverify",
  PASSWORD: `Lv-${randomBytes(12).toString("base64url")}`,
}));
chmodSync(file, 0o600);
console.log(`wrote ${file} (mode 600)`);
