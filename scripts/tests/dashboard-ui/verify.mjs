// LOCAL UI verification of the Dashboard against a mocked Supabase host. No production service,
// account or tenant record is involved; every row below is synthetic.
// Usage: start Vite with the mock env, then `node scripts/tests/dashboard-ui/verify.mjs <outDir>`:
//   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=anon-test \
//   VITE_DASHBOARD_MILESTONE_REVIEWS=true VITE_FIRST_PAYMENT_REMINDERS_START=<YYYY-MM-DD> \
//   VITE_DASHBOARD_ATTENTION_CLEARANCES=true \
//   npx vite --port 5181 --host 127.0.0.1
// DASH_BASE_URL overrides the URL; DASH_KPI_ONLY=1 captures only the KPI cards (used on the base commit
// to prove they are pixel-identical). PLAYWRIGHT_MODULE / CHROMIUM_PATH override module and browser.
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium; // ESM build, or a CommonJS path given by PLAYWRIGHT_MODULE
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.DASH_BASE_URL ?? "http://127.0.0.1:5181";
const OUT = process.argv[2];
const KPI_ONLY = process.env.DASH_KPI_ONLY === "1";
mkdirSync(OUT, { recursive: true });

const USER = "11111111-0000-4000-8000-000000000001";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: USER, role: "authenticated", exp, app_metadata: { organization_id: ORG, role: "Agent" } })}.sig`;
const user = { id: USER, aud: "authenticated", role: "authenticated", email: "agent@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {}, app_metadata: { organization_id: ORG, role: "Agent" } };
const profile = { id: USER, organization_id: ORG, role: "Agent", status: "Active", first_name: "Test", last_name: "Agent",
  email: "agent@example.test", is_super_admin: false, onboarding_complete: true, timezone: "Pacific Time (US & Canada)",
  monthly_call_goal: 300, monthly_policies_goal: 10, monthly_appointment_goal: 20, monthly_premium_goal: 2500 };

// ---- calendar helpers (the browser context runs in UTC; so does this fixture) ----
const DAY = 86_400_000;
const now = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const plus = (n) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
const md = (n, year) => { const d = plus(n); return `${year}-${ymd(d).slice(5)}`; };
const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const uuid = (n) => `cccc0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const clients = [
  { id: uuid(1), first_name: "Riley", last_name: "Stone", phone: "5550000001", created_at: "2025-02-01T12:00:00Z", date_of_birth: md(2, 1960),
    effective_date: null, draft_date: null, primary_policy_id: null, policy_type: "Term", carrier: "", policy_number: "", premium: 0, face_amount: 0, sold_date: null, custom_fields: null },
  { id: uuid(2), first_name: "Sam", last_name: "Ortiz", phone: "5550000002", created_at: "2023-03-01T12:00:00Z", date_of_birth: null,
    effective_date: md(5, now.getUTCFullYear() - 3), draft_date: null, primary_policy_id: "eeee0000-0000-4000-8000-000000000001",
    policy_type: "Final Expense", carrier: "Mutual of Omaha", policy_number: "FE-1001", premium: 58.45, face_amount: 15000, sold_date: md(5, now.getUTCFullYear() - 3),
    custom_fields: { additional_policies: [{ policyId: "eeee0000-0000-4000-8000-000000000002", policyType: "Whole Life", carrier: "Aetna", effectiveDate: md(12, now.getUTCFullYear() - 1) }] } },
  { id: uuid(3), first_name: "Pat", last_name: "Lee", phone: "5550000003", created_at: ymd(plus(-20)) + "T12:00:00Z", date_of_birth: null,
    effective_date: null, draft_date: ymd(plus(2)), primary_policy_id: null, policy_type: "Term", carrier: "", policy_number: "", premium: 0, face_amount: 0, sold_date: null, custom_fields: null },
  { id: uuid(4), first_name: "Jordan", last_name: "Kay", phone: "5550000004", created_at: "2024-06-01T12:00:00Z", date_of_birth: md(0, 1958),
    effective_date: null, draft_date: null, primary_policy_id: null, policy_type: "Term", carrier: "", policy_number: "", premium: 0, face_amount: 0, sold_date: null, custom_fields: null },
];
const leads = [{ id: "dddd0000-0000-4000-8000-000000000001", first_name: "Casey", last_name: "Callback", phone: "5550000009" }];
const at = (h, m = 0) => new Date(startOfDay.getTime() + (h * 60 + m) * 60_000).toISOString();
const schedule = [
  { id: "a1", title: "Policy review", contact_name: "Morgan Diaz", start_time: at(15), type: "Policy Review", status: "Confirmed" },
  { id: "a2", title: "Quote", contact_name: "Avery Brooks", start_time: at(18, 30), type: "Sales Call", status: "Scheduled" },
];
const callbackAppointments = [
  { id: "f1000000-0000-4000-8000-000000000001", contact_id: leads[0].id, contact_name: "Casey Callback", contact_type: null, start_time: new Date(Date.now() - 3_600_000).toISOString(),
    notes: "Asked for a quote on final expense", user_id: USER, created_by: USER, type: "Follow Up", status: "Scheduled", phone: "5550000009" },
];
const missed = [
  { id: "c0110000-0000-4000-8000-000000000001", contact_id: clients[1].id, contact_name: "Sam Ortiz", contact_type: null, contact_phone: "5550000002", created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
    disposition_name: null, direction: "inbound", is_missed: true, missed_reason: "no_answer", outcome: "missed", agent_id: null, answered_by_agent_id: null, voicemail_id: null },
];

function summary(args) {
  const start = new Date(startOfDay);
  if (args.p_period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (args.p_period === "month" || args.p_period === "year") start.setUTCDate(1);
  if (args.p_period === "year") start.setUTCMonth(0);
  const prevStart = new Date(start.getTime() - DAY);
  const totals = (k) => ({ calls: 42 * k, policies: 3 * k, bookings: 5 * k, annual_premium: 4200 * k, monthly_premium: 350 * k, unknown_premiums: 0,
    talk_seconds: 3600 * k, workload: 4 * k, leads: 7 * k, estimated_duration_calls: 0, unknown_duration_calls: 0, conflicting_duration_calls: 0 });
  return { organization_id: ORG, agent_ids: args.p_agent_id ? [args.p_agent_id] : null, scope: "Personal", period: args.p_period, time_zone: "UTC",
    start_at: start.toISOString(), end_at: now.toISOString(), previous_start: prevStart.toISOString(), previous_end: start.toISOString(),
    workload_end: new Date(startOfDay.getTime() + DAY).toISOString(), policy_date_basis: "sold_date", sold_date_from: ymd(start), sold_date_through: ymd(now),
    previous_sold_date_from: ymd(prevStart), previous_sold_date_through: ymd(new Date(start.getTime() - 1)), undated_policies: 0,
    current: totals(1), previous: totals(1) };
}

// ---- stateful fake review and clearance stores (the server derives the occurrence from the source) ----
const reviews = [];
const clearances = [];
const inIds = (q) => q.get("id")?.match(/^in\.\((.*)\)$/)?.[1]?.split(",");
const results = [];
const check = (ok, name) => { results.push(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) console.error("FAIL", name); };

async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const q = url.searchParams;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  const json = (body, status = 200, headers = {}) => r.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
  // Exact counts arrive in Content-Range, which a cross-origin page can read only when it is exposed (as Supabase does).
  const list = (rows) => json(single ? rows[0] ?? null : rows, 200, {
    "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`, "access-control-expose-headers": "Content-Range",
  });
  if (p.startsWith("/auth/v1/user")) return json(user);
  if (p.startsWith("/auth/v1/token")) return json({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user });
  if (p.startsWith("/auth/v1/")) return json({});
  if (p === "/rest/v1/rpc/get_performance_summary") return json(summary(req.postDataJSON()));
  if (p === "/rest/v1/rpc/set_dashboard_milestone_review") {
    const a = req.postDataJSON();
    const row = { id: `ffff0000-0000-4000-8000-${String(reviews.length + 1).padStart(12, "0")}`, milestone_kind: a.p_kind, client_id: a.p_client_id,
      event_key: a.p_event_key, occurrence_year: Number(a.p_occurrence_date.slice(0, 4)), occurrence_date: a.p_occurrence_date, state: a.p_state,
      remind_at: a.p_remind_at ?? null, updated_at: new Date().toISOString() };
    reviews.push(row);
    return json(row);
  }
  if (p === "/rest/v1/rpc/clear_dashboard_attention_item") {
    const a = req.postDataJSON();
    const source = a.p_source_type === "missed_call" ? missed.find((c) => c.id === a.p_source_id)
      : callbackAppointments.find((x) => x.id === a.p_source_id);
    if (!source) return json({ code: "PT404", message: "This item is no longer pending" }, 404);
    const occurrence = a.p_source_type === "missed_call" ? source.created_at : source.start_time;
    if (Date.parse(occurrence) !== Date.parse(a.p_expected_occurrence_at)) return json({ code: "PT409", message: "changed" }, 409);
    const row = { id: `abcd0000-0000-4000-8000-${String(clearances.length + 1).padStart(12, "0")}`, user_id: USER, organization_id: ORG,
      source_type: a.p_source_type, source_id: a.p_source_id, occurrence_at: occurrence, cleared_at: new Date().toISOString() };
    clearances.push(row);
    return json(row);
  }
  if (p === "/rest/v1/rpc/undo_dashboard_attention_clear") {
    const a = req.postDataJSON();
    const i = clearances.findIndex((c) => c.id === a.p_id && c.cleared_at === a.p_expected_cleared_at);
    if (i >= 0) clearances.splice(i, 1);
    return json(i >= 0);
  }
  if (p.startsWith("/rest/v1/rpc/")) return json(null, 400);
  if (p === "/rest/v1/profiles") return json(single ? profile : [profile]);
  if (p === "/rest/v1/organizations") return json(single ? { id: ORG, name: "Test Agency", status: "active" } : [{ id: ORG, name: "Test Agency", status: "active" }]);
  if (p === "/rest/v1/user_preferences") return json(single ? null : []);
  if (p === "/rest/v1/dashboard_milestone_reviews") return list(reviews);
  if (p === "/rest/v1/dashboard_attention_clearances") return list(q.get("id")?.startsWith("gt.") ? [] : clearances);
  if (p === "/rest/v1/clients") {
    const ids = q.get("id")?.match(/^in\.\((.*)\)$/)?.[1]?.split(",");
    if (ids) return list(clients.filter((c) => ids.includes(c.id)));
    if (q.get("id")?.startsWith("gt.")) return list([]);
    return list(clients);
  }
  if (p === "/rest/v1/leads") {
    const ids = q.get("id")?.match(/^in\.\((.*)\)$/)?.[1]?.split(",") ?? [];
    return list(leads.filter((l) => ids.includes(l.id)));
  }
  if (p === "/rest/v1/appointments") {
    const ids = inIds(q);
    if (q.get("type")?.startsWith("in.")) return list(ids ? callbackAppointments.filter((x) => ids.includes(x.id)) : callbackAppointments);
    return list(schedule);
  }
  if (p === "/rest/v1/calls") {
    const ids = inIds(q);
    return list(ids ? missed.filter((c) => ids.includes(c.id)) : missed);
  }
  if (p.startsWith("/rest/v1/")) return list([]);
  if (p.startsWith("/storage/")) return json([]);
  return json({});
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const theme of ["light", "dark"]) {
    const tag = `${vp.name}-${theme}`;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, timezoneId: "UTC", reducedMotion: theme === "dark" ? "reduce" : "no-preference" });
    await ctx.addInitScript(([key, session, mode]) => { localStorage.setItem(key, session); localStorage.setItem("agentflow-theme", mode); },
      ["sb-mock-auth-token", JSON.stringify({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user }), theme]);
    await ctx.route("https://mock.supabase.co/**", route);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // Load evidence printed only if the Dashboard never renders (the CI artifact holds no page state).
    const trail = [];
    page.on("console", (m) => { if (m.type() === "error") trail.push(`console.error: ${m.text()}`); });
    page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) trail.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => { if (r.url().startsWith(BASE)) trail.push(`failed ${r.url()}: ${r.failure()?.errorText}`); });
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) trail.push(`navigated ${f.url()}`); });
    await page.goto(`${BASE}/dashboard`);
    const kpis = page.locator("div.grid").filter({ hasText: "Calls Made Today" }).first();
    await kpis.waitFor({ timeout: 30000 }).catch(async (e) => {
      const body = await page.locator("body").innerText().catch(() => "<no body>");
      console.error(`${tag}: KPI cards never rendered at ${page.url()}\n${[...errors, ...trail].slice(-40).join("\n")}\nbody: ${body.slice(0, 600)}`);
      throw e;
    });
    await page.getByText("$4,200.00").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await kpis.screenshot({ path: `${OUT}/kpi-${tag}.png`, animations: "disabled" });
    if (KPI_ONLY) { await ctx.close(); continue; }

    await page.getByText("Riley Stone").waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/dashboard-${tag}.png`, fullPage: true, animations: "disabled" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${tag}: no horizontal page scroll (${overflow}px)`);
    check(await page.getByRole("img", { name: "Birthday" }).first().isVisible(), `${tag}: birthday icon`);
    check(await page.getByRole("img", { name: "Policy anniversary" }).first().isVisible(), `${tag}: anniversary icon`);
    check(await page.getByRole("img", { name: "First payment" }).first().isVisible(), `${tag}: first payment icon`);
    check((await page.locator("body").innerText()).match(/renewal|expiration/i) === null, `${tag}: no renewal/expiration wording`);

    // Keyboard: Tab to a widget's details button, open it with Enter, Escape closes and returns focus.
    const details = page.getByRole("button", { name: "Open Client Milestones details" });
    await details.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Client Milestones" });
    await dialog.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/milestones-modal-${tag}.png`, animations: "disabled" });
    const box = await dialog.boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= vp.width + 1, `${tag}: milestones modal fits the viewport`);
    // Keyboard-operated row menu inside the modal (Remind later), and a VISIBLE Dismiss button.
    const more = dialog.getByRole("button", { name: "More actions for Riley Stone" });
    await more.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await menu.waitFor({ timeout: 5000 });
    check(await menu.getByRole("menuitem", { name: /Remind later/ }).isVisible(), `${tag}: Remind later reachable by keyboard`);
    await page.screenshot({ path: `${OUT}/milestone-menu-${tag}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden", timeout: 5000 });
    const dismiss = dialog.getByRole("button", { name: "Dismiss birthday for Riley Stone" });
    check(await dismiss.isVisible(), `${tag}: Dismiss is a visible button (no hover, no menu)`);
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await page.getByText(/Dismissed: Riley Stone/).waitFor({ timeout: 5000 });
    check(true, `${tag}: Dismiss reports success with Undo`);
    // The dismissed row leaves the list (and the widget behind reloads): wait for both.
    await dialog.getByText("Riley Stone").waitFor({ state: "detached", timeout: 5000 });
    await page.waitForTimeout(300);
    check(!(await page.getByRole("region", { name: "Client Milestones" }).getByText("Riley Stone").isVisible()),
      `${tag}: the widget behind the modal also drops the dismissed milestone`);
    await dialog.getByRole("button", { name: /^Dismissed \(1\)/ }).click();
    check(await dialog.getByText("Riley Stone").isVisible(), `${tag}: the Dismissed history lists it`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    check(await details.evaluate((el) => el === document.activeElement), `${tag}: focus returns to the details button`);
    reviews.length = 0;

    // Callbacks: Clear from the widget by keyboard; the row leaves only after the server stored it.
    const cbWidget = page.getByRole("region", { name: "Callbacks" });
    const clearCb = cbWidget.getByRole("button", { name: "Clear callback for Casey Callback" });
    await clearCb.waitFor({ timeout: 10000 });
    check(await clearCb.isVisible(), `${tag}: Clear is a visible button on a callback row`);
    await clearCb.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Callback cleared: Casey Callback").waitFor({ timeout: 5000 });
    await cbWidget.getByText("Casey Callback").waitFor({ state: "detached", timeout: 5000 });
    check(await cbWidget.getByText("No pending callbacks").isVisible(), `${tag}: an all-cleared queue is empty, with the exact total`);
    check(await page.evaluate(() => document.activeElement !== document.body), `${tag}: focus is not lost after a row is cleared`);
    await page.screenshot({ path: `${OUT}/callbacks-cleared-${tag}.png`, animations: "disabled" });
    await cbWidget.getByRole("button", { name: /1 cleared/ }).click();
    const cb = page.getByRole("dialog", { name: "Callbacks" });
    await cb.waitFor({ timeout: 10000 });
    await cb.getByText("Casey Callback").waitFor({ timeout: 5000 });
    check(await cb.getByRole("button", { name: "Cleared (1)" }).getAttribute("aria-pressed") === "true", `${tag}: the Cleared view opens from the widget link`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/callbacks-modal-${tag}.png`, animations: "disabled" });
    const dialogOverflow = await cb.evaluate((el) => el.scrollWidth - el.clientWidth);
    check(dialogOverflow <= 1, `${tag}: the Callbacks dialog has no horizontal overflow (${dialogOverflow}px)`);
    await cb.getByRole("button", { name: "Undo clear for Casey Callback" }).click();
    await cbWidget.getByText("Casey Callback").waitFor({ timeout: 5000 });
    check(true, `${tag}: Undo restores the callback to the widget`);
    await page.keyboard.press("Escape");
    await cb.waitFor({ state: "hidden", timeout: 5000 });

    // Missed Calls: Clear a missed call; the call record itself is never written (no write route exists).
    const mcWidget = page.getByRole("region", { name: "Missed Calls" });
    await mcWidget.getByRole("button", { name: "Clear missed call from Sam Ortiz" }).click();
    await page.getByText("Missed call cleared: Sam Ortiz").waitFor({ timeout: 5000 });
    await mcWidget.getByText("All caught up!").waitFor({ timeout: 5000 });
    check(await mcWidget.getByRole("button", { name: /1 cleared/ }).isVisible(), `${tag}: a cleared missed call leaves the queue and is still reachable`);
    clearances.length = 0;

    // A KPI drill-down on the same shell.
    await page.getByText("Calls Made Today").click();
    const calls = page.getByRole("dialog", { name: /Calls Made/ });
    await calls.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/calls-modal-${tag}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");

    check(errors.length === 0, `${tag}: no page errors${errors.length ? ` (${errors[0]})` : ""}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/results.txt`, results.join("\n") + "\n");
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
