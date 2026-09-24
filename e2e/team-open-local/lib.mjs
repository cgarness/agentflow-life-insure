// TEST-ONLY Playwright helpers for the isolated LOCAL verification (implementation_plan.md §10).
// Browser isolation (defence in depth; the server-side controls live in isolation.sh):
//   1. Chromium resolves NO hostname except localhost/127.0.0.1 (--host-resolver-rules).
//   2. --no-proxy-server: the sandbox egress proxy is never used by the browser.
//   3. A context route guard aborts and records every HTTP(S) request whose host is not loopback.
//   4. A context WebSocket guard (routeWebSocket) closes and records every non-loopback WebSocket.
//      It was added after the recorded 2026-09-24 run. In that run, WebSockets were only recorded via
//      page.on("websocket"), and all recorded WebSocket hosts were loopback.
// Scenario page routes must use route.fallback() (not continue()), so this guard still applies to them.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright");

export const APP = "http://127.0.0.1:8089";
export const DB_CONTAINER = "supabase_db_agentflow-localverify";
const LOOPBACK = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

export function sql(query) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|"], {
    input: query,
  }).toString().trim();
}

export async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--no-proxy-server",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
}

/** One isolated browser context per signed-in user (separate storage = separate Auth session). */
export async function session(browser, label, email, password, evidence) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["microphone"] });
  const net = { label, requests: [], blocked: [], ws: [], httpErrors: [] };
  const consoleErrors = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (LOOPBACK.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    net.blocked.push(url.slice(0, 160));
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (LOOPBACK.test(ws.url())) return ws.connectToServer();
    net.blocked.push(`ws: ${ws.url().slice(0, 160)}`);
    return ws.close();
  });
  const page = await context.newPage();
  page.on("request", (r) => {
    const u = new URL(r.url());
    net.requests.push(`${r.method()} ${u.host}${u.pathname}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) { const u = new URL(r.url()); net.httpErrors.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 120)}`); }
  });
  page.on("websocket", (ws) => net.ws.push(new URL(ws.url()).host + new URL(ws.url()).pathname));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(`${APP}/login`);
  await page.getByPlaceholder("you@agency.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  evidence.sessions.push({ label, net, consoleErrors });
  return { context, page, net, consoleErrors };
}

export function evidenceStore(dir) {
  mkdirSync(dir, { recursive: true });
  const ev = { sessions: [], scenarios: [] };
  ev.shot = async (page, name) => {
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return path.basename(file);
  };
  ev.record = (row) => { ev.scenarios.push(row); console.log(`[${row.result}] ${row.id} ${row.title}`); };
  ev.save = () => {
    const summary = ev.sessions.map((s) => ({
      label: s.label,
      consoleErrors: s.consoleErrors,
      blockedNonLoopback: s.net.blocked,
      hosts: [...new Set(s.net.requests.map((r) => r.split(" ")[1].split("/")[0]))],
      websockets: [...new Set(s.net.ws)],
      httpErrors: s.net.httpErrors,
      endpoints: summarize(s.net.requests),
    }));
    writeFileSync(path.join(dir, "evidence.json"), JSON.stringify({ scenarios: ev.scenarios, network: summary }, null, 2));
  };
  return ev;
}

function summarize(reqs) {
  const counts = {};
  for (const r of reqs) {
    const k = r.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
