// LOCAL UI verification of Settings → Google Sheets against a mocked Supabase host and a fake Google
// Picker script. No production service, Google account or real lead is involved.
// Usage: start Vite with the mock env shown below, then `node scripts/tests/google-sheets-ui/verify.mjs <outDir>`.
//   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=anon-test VITE_GOOGLE_SHEETS_ENABLED=true \
//   VITE_GOOGLE_PICKER_API_KEY=test-picker-key VITE_GOOGLE_CLOUD_PROJECT_NUMBER=87346168200 npx vite --port 5179 --host 127.0.0.1
// PLAYWRIGHT_MODULE / CHROMIUM_PATH override the module and browser locations.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = "http://127.0.0.1:5179";
const OUT = process.argv[2];
const USER = "11111111-0000-0000-0000-000000000001";
const ORG = "a0000000-0000-0000-0000-00000000000a";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const JWT = `${b64({ alg: "HS256" })}.${b64({ sub: USER, role: "authenticated", exp, app_metadata: { organization_id: ORG, role: "Agent" } })}.sig`;
const user = { id: USER, aud: "authenticated", role: "authenticated", email: "agent@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z", user_metadata: {}, app_metadata: { organization_id: ORG, role: "Agent" } };
const profile = { id: USER, organization_id: ORG, role: "Agent", status: "Active", first_name: "Test", last_name: "Agent",
  email: "agent@example.test", is_super_admin: false, onboarding_complete: true, timezone: "Pacific Time (US & Canada)" };

// ---- stateful fake backend ----
const state = { connected: true, sources: [], calls: [] };
const now = () => new Date().toISOString();
function apiResponse(body) {
  state.calls.push(body.action);
  const conn = state.connected ? { status: "connected", google_email: "agent.sheets@example.test", connected_at: now(), last_error_code: null } : null;
  switch (body.action) {
    case "status": return { enabled: true, eligible: true, connection: conn };
    case "context": return { duplicate_action: "flag", default_status: "New", lead_sources: ["Facebook"], has_lead_created_workflows: true,
      custom_fields: [{ id: "33333333-3333-3333-3333-333333333333", name: "Coverage Amount", created_by: null, created_at: null }] };
    case "picker_token": return { access_token: "ya29.fake-local-token", expires_in: 3599 };
    case "inspect": return { name: "Facebook Leads", tabs: [
      { sheetId: 0, title: "Leads", rowCount: 100, columnCount: 6, index: 0, configured: false },
      { sheetId: 7, title: "Archive", rowCount: 100, columnCount: 6, index: 1, configured: state.sources.some((s) => s.sheet_id === 7) }] };
    case "headers": return { title: "Leads", spreadsheet_name: "Facebook Leads", header: ["Lead ID", "First Name", "Last Name", "Phone", "Email", "Coverage Amount"], row_count: 3, overflow: false, sample: [] };
    case "preview": return { title: "Leads", total_rows: 3, valid_rows: 2, invalid_rows: 1, imported_before: 0, duplicate_action: "flag",
      has_lead_created_workflows: true, rows: [
        { row: 2, first_name: "Ann", last_name: "Lee", phone: "(555) 010-2000", email: "ann@example.test", outcome: "import", reason: null },
        { row: 3, first_name: "Bo", last_name: "Diaz", phone: "555-010-3000", email: "", outcome: "duplicate_flag", reason: null },
        { row: 4, first_name: "Cy", last_name: "", phone: "", email: "", outcome: "invalid", reason: "missing_phone" }] };
    case "save": {
      const p = body.payload;
      let s = state.sources.find((x) => x.id === body.source_id);
      if (!s) { s = { id: "src-" + (state.sources.length + 1), organization_id: ORG, user_id: USER, state: "draft", health: "ok", phase: "steady",
        config_version: 1, lease_owner: null, last_checked_at: null, last_success_at: null, last_result: null, last_error_code: null,
        review_reason: null, created_at: now() }; state.sources.push(s); }
      else s.config_version++;
      Object.assign(s, { spreadsheet_id: p.spreadsheet_id, sheet_id: p.sheet_id, spreadsheet_name: p.spreadsheet_name, sheet_title: p.sheet_title,
        display_name: p.display_name, mapping: p.mapping, identity_mode: p.identity_mode, id_header: p.id_header,
        lead_source_default: p.lead_source_default, include_existing: p.include_existing });
      return { source_id: s.id, config_version: s.config_version };
    }
    case "activate": { const s = state.sources.find((x) => x.id === body.source_id); s.state = "enabled"; s.config_version++;
      s.phase = s.include_existing ? "initial" : "steady"; return { outcome: "activated", config_version: s.config_version, baselined: 3 }; }
    case "sync_now": { const s = state.sources.find((x) => x.id === body.source_id);
      s.last_success_at = now(); s.last_checked_at = now(); s.phase = "steady";
      s.last_result = { imported: 2, flagged: 1, skipped: 0, errors: 1, pending: 1 };
      return { sourceId: s.id, status: "ok", imported: 2, flagged: 1, skipped: 0, errors: 1, backlog: false }; }
    case "pause": { const s = state.sources.find((x) => x.id === body.source_id); s.state = "paused"; return { state: "paused" }; }
    case "resume": { const s = state.sources.find((x) => x.id === body.source_id); s.state = "enabled"; return { state: "enabled" }; }
    case "remove": state.sources = state.sources.filter((x) => x.id !== body.source_id); return { state: "removed" };
    case "disconnect": state.connected = false; return { ok: true };
    default: return { error: "unknown_action" };
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const results = [];
const check = (ok, name) => { results.push(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) console.error("FAIL", name); };

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  state.connected = true; state.sources = []; state.calls = [];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(([key, session]) => { localStorage.setItem(key, session); },
    ["sb-mock-auth-token", JSON.stringify({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user })]);
  await ctx.route("https://apis.google.com/js/api.js", (route) => route.fulfill({ contentType: "application/javascript", body: `
    window.google = { picker: {
      ViewId: { SPREADSHEETS: "spreadsheets" }, Action: { PICKED: "picked", CANCEL: "cancel" },
      Response: { ACTION: "action", DOCUMENTS: "docs" }, Document: { ID: "id", NAME: "name" },
      DocsView: function () { this.setMimeTypes = () => this; },
      PickerBuilder: function () { const b = this; let cb;
        ["setAppId","setDeveloperKey","setOAuthToken","setOrigin","addView"].forEach((m) => b[m] = (v) => { window.__picker = window.__picker || {}; window.__picker[m] = v; return b; });
        b.setCallback = (f) => { cb = f; return b; };
        b.build = () => ({ setVisible: () => setTimeout(() => cb({ action: "picked", docs: [{ id: "SHEET_ABCDEFGHIJKL", name: "Facebook Leads" }] }), 50) });
      } } };
    window.gapi = { load: (n, cb) => cb() };` }));
  await ctx.route("https://mock.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/auth/v1/user")) return json(user);
    if (p.startsWith("/auth/v1/token")) return json({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user });
    if (p.startsWith("/auth/v1/")) return json({});
    if (p === "/functions/v1/google-sheets-api") {
      const body = req.postDataJSON();
      const res = apiResponse(body);
      return res?.error ? json(res, 400) : json(res);
    }
    if (p === "/functions/v1/google-sheets-oauth-start") return json({ url: "about:blank" });
    if (p.startsWith("/functions/v1/")) return json({});
    if (p === "/rest/v1/profiles") return json(single ? profile : [profile]);
    if (p === "/rest/v1/google_sheets_sources") return json(state.sources.map((s) => ({ ...s })));
    if (p === "/rest/v1/organizations") return json(single ? { id: ORG, name: "Test Agency", status: "active" } : [{ id: ORG, name: "Test Agency", status: "active" }]);
    if (p.startsWith("/rest/v1/rpc/")) return json(null);
    if (p.startsWith("/rest/v1/")) return json(single ? null : []);
    if (p.startsWith("/storage/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/settings?section=google-sheets`);
  await page.getByText("Google account").waitFor({ timeout: 20000 });
  check(await page.getByText("agent.sheets@example.test").isVisible(), `${vp.name}: connected account shown from server status`);
  check(await page.getByText("No sheets yet.").isVisible(), `${vp.name}: empty state`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-1-connected.png`, fullPage: true });

  // Add sheet → Picker → tab → mapping
  await page.getByRole("button", { name: "Add sheet" }).click();
  await page.getByRole("button", { name: "Choose spreadsheet" }).click();
  await page.getByRole("button", { name: /^Leads$/ }).click();
  await page.getByLabel("Name", { exact: true }).waitFor();
  const picker = await page.evaluate(() => window.__picker);
  check(picker?.setAppId === "87346168200" && picker?.setDeveloperKey === "test-picker-key", `${vp.name}: Picker appId = project number, developer key set`);
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  check(!stored.includes("ya29.fake-local-token"), `${vp.name}: Picker token not in browser storage`);
  check(await page.getByLabel("Field for First Name").textContent().then((t) => t.includes("First Name")), `${vp.name}: auto-mapped First Name`);
  check(await page.getByLabel("Field for Coverage Amount").textContent().then((t) => t.includes("Coverage Amount")), `${vp.name}: auto-mapped custom field`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-2-mapping.png`, fullPage: true });

  // Preview (read-only) → new rows default → Enable
  const before = state.calls.length;
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText(/2 ready/).waitFor();
  check(!state.calls.slice(before).some((c) => c === "save" || c === "activate"), `${vp.name}: preview makes no save/activate call`);
  check(!(await page.getByLabel("Also import existing rows").isChecked()), `${vp.name}: "Also import existing rows" unchecked by default`);
  check(await page.getByText("Only rows added after you enable this sheet are imported.").isVisible(), `${vp.name}: new-rows-only copy`);
  await page.getByLabel("Also import existing rows").click();
  check(await page.getByText("Lead Created workflows will run for these leads.").isVisible(), `${vp.name}: workflow warning when importing existing rows`);
  await page.getByLabel("Also import existing rows").click();
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-3-preview.png`, fullPage: true });
  await page.getByRole("button", { name: "Enable" }).click();
  await page.getByText("Facebook Leads → Leads").waitFor();
  check(state.sources[0]?.include_existing === false && state.sources[0]?.state === "enabled", `${vp.name}: enabled with new rows only`);

  // Manage: Sync now → results; Pause/Resume; Remove
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByText(/2 imported \(1 flagged\) · 1 error/).waitFor({ timeout: 10000 });
  check(true, `${vp.name}: Sync now shows imported (flagged subset) and errors`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-4-active.png`, fullPage: true });
  await page.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Pause" }).click();
  await page.getByText("Paused", { exact: true }).first().waitFor();
  check(true, `${vp.name}: pause`);
  await page.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Sync now" }).waitFor();
  check(true, `${vp.name}: resume`);
  await page.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  check(await page.getByText("New rows stop importing. Leads already imported stay.").isVisible(), `${vp.name}: remove confirmation copy`);
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByText("No sheets yet.").waitFor();
  check(true, `${vp.name}: removed`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, `${vp.name}: no horizontal page scroll`);
  check(errors.length === 0, `${vp.name}: no page errors ${errors.join(" | ").slice(0, 200)}`);
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
