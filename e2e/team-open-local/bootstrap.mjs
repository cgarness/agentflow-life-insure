// TEST-ONLY fixture bootstrap for the isolated LOCAL verification (implementation_plan.md §10).
// Privileged setup ONLY: it uses the LOCAL stack's service key to create synthetic Auth users, then
// loads fixtures.sql into the LOCAL database container. The browser never receives this key.
//
// Usage: node e2e/team-open-local/bootstrap.mjs <workspace>/lv.env.json
//   lv.env.json = { API_URL, SERVICE_ROLE_KEY, DB_CONTAINER, PASSWORD }   (disposable, outside the repo)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = process.argv[2];
const env = JSON.parse(readFileSync(envPath, "utf8"));
const PROD_REF = ["jncvvsvckxhqgqvkppmj"].join("");

// Locality guards: loopback API only, the distinct local project container, no production ref anywhere.
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error(`refusing non-loopback API_URL ${env.API_URL}`);
if (env.DB_CONTAINER !== "supabase_db_agentflow-localverify") throw new Error(`refusing container ${env.DB_CONTAINER}`);
if (JSON.stringify(env).includes(PROD_REF)) throw new Error("refusing: production ref present in local env");
const iss = JSON.parse(Buffer.from(env.SERVICE_ROLE_KEY.split(".")[1], "base64url").toString()).iss;
if (iss !== "supabase-demo") throw new Error(`refusing: service key issuer ${iss} is not the local demo issuer`);

const USERS = {
  admin: "lv.admin@example.test",
  agent1: "lv.agent1@example.test",
  agent2: "lv.agent2@example.test",
  agentb: "lv.agentb@example.test",
};

async function ensureUser(email) {
  const headers = { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const res = await fetch(`${env.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password: env.PASSWORD, email_confirm: true, user_metadata: { first_name: "LV" } }),
  });
  if (res.ok) return (await res.json()).id;
  const list = await (await fetch(`${env.API_URL}/auth/v1/admin/users?per_page=100`, { headers })).json();
  const found = (list.users ?? []).find((u) => u.email === email);
  if (!found) throw new Error(`could not create or find ${email}: ${res.status} ${await res.text()}`);
  return found.id;
}

const ids = {};
for (const [k, email] of Object.entries(USERS)) ids[k] = await ensureUser(email);

const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures.sql"));
const args = ["exec", "-i", env.DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q"];
for (const [k, v] of Object.entries(ids)) args.push("-v", `${k}=${v}`);
args.push("-f", "-");
execFileSync("docker", args, { input: sql, stdio: ["pipe", "inherit", "inherit"] });

writeFileSync(path.join(path.dirname(envPath), "lv.users.json"), JSON.stringify({ ids, emails: USERS }, null, 2));
console.log(JSON.stringify({ ok: true, ids }, null, 2));
