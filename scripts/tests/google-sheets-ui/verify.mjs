// LOCAL UI verification of Settings → Google Sheets against a mocked Supabase host and a fake Google
// Picker script. No production service, Google account or real lead is involved.
// Usage: start Vite with the mock env shown below, then `node scripts/tests/google-sheets-ui/verify.mjs <outDir>`.
//   VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=anon-test VITE_GOOGLE_SHEETS_ENABLED=true \
//   VITE_GOOGLE_PICKER_API_KEY=test-picker-key VITE_GOOGLE_CLOUD_PROJECT_NUMBER=87346168200 npx vite --port 5179 --host 127.0.0.1
// PLAYWRIGHT_MODULE / CHROMIUM_PATH override the module and browser locations.
// GS_MAPPING_V2=1 verifies the mapping v2 editor instead (start Vite with VITE_GOOGLE_SHEETS_MAPPING_V2=true too; the fake
// server then reports catalog_version 2). Without it the legacy run is exactly as before.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const BASE = process.env.GS_BASE_URL ?? "http://127.0.0.1:5179";
const OUT = process.argv[2];
const V2 = process.env.GS_MAPPING_V2 === "1";
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
  if (V2 && V2_API[body.action]) return V2_API[body.action](body);
  const conn = state.connected ? { status: "connected", google_email: "agent.sheets@example.test", connected_at: now(), last_error_code: null } : null;
  switch (body.action) {
    case "status": return { enabled: true, eligible: true, connection: conn, realtime: { mode: "pilot", sources: Object.fromEntries(
      state.sources.filter((x) => x.state === "enabled" && x.health === "ok").map((x) => [x.id,
        { state: "active", last_notification_at: null, last_processed_at: null, pending: false }])) } };
    case "context": return { duplicate_action: "flag", default_status: "New", lead_sources: ["Facebook"], has_lead_created_workflows: true,
      custom_fields: [{ id: "33333333-3333-3333-3333-333333333333", name: "Coverage Amount", created_by: null, created_at: null }] };
    case "picker_token": return { access_token: "ya29.fake-local-token", expires_in: 3599 };
    case "inspect": return { name: "Facebook Leads", tabs: [
      { sheetId: 0, title: "Leads", rowCount: 100, columnCount: 6, index: 0, configured: false },
      { sheetId: 7, title: "Archive", rowCount: 100, columnCount: 6, index: 1, configured: state.sources.some((s) => s.sheet_id === 7) }] };
    case "headers": return { title: "Leads", spreadsheet_name: "Facebook Leads", header: ["Lead ID", "First Name", "Last Name", "Phone", "Email", "Coverage Amount"], row_count: 3, overflow: false, sample: [] };
    case "preview": return { title: "Leads", total_rows: 7, valid_rows: 2, invalid_rows: 4, repeat_rows: 1, imported_before: 0, duplicate_action: "flag",
      has_lead_created_workflows: true, rows: [
        { row: 2, first_name: "Ann", last_name: "Lee", phone: "(555) 010-2000", email: "ann@example.test", outcome: "import", reason: null },
        { row: 3, first_name: "Bo", last_name: "Diaz", phone: "555-010-3000", email: "", outcome: "duplicate_flag", reason: null },
        { row: 4, first_name: "Cy", last_name: "", phone: "", email: "", outcome: "invalid", reason: "missing_phone" },
        { row: 5, first_name: "Dee", last_name: "Ray", phone: "555-010-5000", email: "", outcome: "missing_id", reason: null },
        { row: 6, first_name: "Eli", last_name: "Fox", phone: "555-010-6000", email: "", outcome: "duplicate_id", reason: null },
        { row: 7, first_name: "Eli", last_name: "Fox", phone: "555-010-6000", email: "", outcome: "duplicate_id", reason: null },
        { row: 8, first_name: "Gia", last_name: "Hu", phone: "555-010-8000", email: "", outcome: "repeat", reason: null }] };
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
      state.syncs = (state.syncs ?? 0) + 1;
      // the second check is interrupted by a concurrent change (finish released): committed imports only, no success time
      if (state.syncs === 2) return { sourceId: s.id, status: "stale", imported: 1, flagged: 0, skipped: 0, errors: 0, backlog: false, finalized: "released" };
      s.last_success_at = now(); s.last_checked_at = now(); s.phase = "steady";
      s.last_result = { imported: 2, flagged: 1, skipped: 0, errors: 1, pending: 1 };
      return { sourceId: s.id, status: "ok", imported: 2, flagged: 1, skipped: 0, errors: 1, backlog: false }; }
    case "identity_review_preview": {
      state.previews = (state.previews ?? 0) + 1;
      return { snapshot: "s".repeat(63) + state.previews, config_version: 9, unresolved_rows: [2], established: 1, approved: 0, kept: 0, rows: [
        { key: "id:NEWID", row: 3, lead_id: "NEWID", hint: "content", valid: true, reason: null, rows: 1, first_name: "Ann", last_name: "Lee", phone: "(555) 010-2000", email: "" },
        ...(state.previews > 1 ? [{ key: "id:Q1", row: 4, lead_id: "Q1", hint: null, valid: true, reason: null, rows: 1, first_name: "Quin", last_name: "New", phone: "555-010-4000", email: "" }] : [])] };
    }
    case "identity_review_apply": {
      state.applies = (state.applies ?? 0) + 1;
      if (state.applies === 1) return { error: "review_changed" };   // a row arrived after the preview
      state.lastDecisions = body.decisions; state.lastSnapshot = body.snapshot;
      const s = state.sources.find((x) => x.id === body.source_id); s.health = "ok"; s.review_reason = null; s.config_version++;
      return { config_version: s.config_version, decided: Object.keys(body.decisions).length };
    }
    case "pause": { const s = state.sources.find((x) => x.id === body.source_id); s.state = "paused"; return { state: "paused" }; }
    case "resume": { const s = state.sources.find((x) => x.id === body.source_id); s.state = "enabled"; return { state: "enabled" }; }
    case "remove": state.sources = state.sources.filter((x) => x.id !== body.source_id); return { state: "removed" };
    case "disconnect": state.connected = false; return { ok: true };
    default: return { error: "unknown_action" };
  }
}

// ---- mapping v2 fake server: typed catalog, the current sheet's columns (one blank-header column with data), typed preview ----
const F = { city: "44444444-4444-4444-4444-444444444441", zip: "44444444-4444-4444-4444-444444444442", cov: "33333333-3333-3333-3333-333333333333" };
const V2_HEADER = ["Lead ID", "First Name", "Last Name", "Phone", "Email", "Mailing Address", "City", "Zip", "Coverage Amount", ""];
const V2_API = {
  context: () => ({ duplicate_action: "flag", default_status: "New", lead_sources: ["Facebook"], has_lead_created_workflows: true,
    catalog_version: 2, mapping_versions: [1, 2], custom_fields: [
      { id: F.city, name: "City", created_by: null, created_at: null, type: "Text", required: false, dropdown_options: [], scope: "agency", own: false },
      { id: F.zip, name: "ZIP Code", created_by: null, created_at: null, type: "Text", required: false, dropdown_options: [], scope: "agency", own: false },
      { id: F.cov, name: "Coverage Amount", created_by: null, created_at: null, type: "Number", required: false, dropdown_options: [], scope: "agency", own: false }] }),
  headers: () => ({ title: "Leads", spreadsheet_name: "Facebook Leads", header: V2_HEADER, row_count: 3, overflow: false, sample: [], locale: "en_US",
    column_count: V2_HEADER.length, over_limit: { count: 0, headers: [] },
    columns: V2_HEADER.map((h, i) => ({ index: i, letter: String.fromCharCode(65 + i), header: h, blank: !h, duplicate: false, has_data: true })) }),
  preview: (body) => ({ title: "Leads", total_rows: 1, valid_rows: 1, invalid_rows: 0, imported_before: 0, duplicate_action: "flag",
    has_lead_created_workflows: true, mapping_version: 2, locale: "en_US", ignored: body.mapping.ignored, unaccounted_headers: [], rows: [
      { row: 2, first_name: "Ann", last_name: "Lee", phone: "(555) 010-2000", email: "ann@example.test", outcome: "import", reason: null, fields: [
        { target: "email", value: "ann@example.test" }, { target: "lead_source", value: "Facebook" }, { target: `custom:${F.city}`, value: "Austin" }, { target: `custom:${F.zip}`, value: "02134" },
        { target: `custom:${F.cov}`, value: "250000.00" }] }] }),
};

// ---- fake Google Picker, shaped like the real one: a backdrop and a dialog holding an iframe, appended straight to
// <body>, that answers only to real clicks inside the iframe (or reports an error when __pickerMode = "error"). It records
// the page state at the moment it is shown, so a Picker opened under a modal layer is caught. ----
function pickerStub() {
  window.__picker = {}; window.__pickerShows = []; window.__pickerDisposed = 0; window.__pickerMode = "pick";
  window.google = { picker: {
    ViewId: { SPREADSHEETS: "spreadsheets" }, DocsViewMode: { LIST: "list" },
    Action: { PICKED: "picked", CANCEL: "cancel", ERROR: "error" },
    Response: { ACTION: "action", DOCUMENTS: "docs" }, Document: { ID: "id", NAME: "name" },
    DocsView: function () { this.setMimeTypes = () => this; this.setMode = (m) => { window.__picker.mode = m; return this; }; },
    PickerBuilder: function () {
      const b = this; let cb;
      ["setAppId", "setDeveloperKey", "setOAuthToken", "setOrigin", "addView"].forEach((m) => b[m] = (v) => { window.__picker[m] = v; return b; });
      b.setCallback = (f) => { cb = f; return b; };
      b.build = () => {
        let nodes = []; let onMsg = null;
        const remove = () => { nodes.forEach((n) => n.remove()); nodes = []; if (onMsg) window.removeEventListener("message", onMsg); };
        return {
          setVisible: () => {
            window.__pickerShows.push({ bodyPointerEvents: document.body.style.pointerEvents, dialogs: document.querySelectorAll('[role="dialog"]').length,
              focusGuards: document.querySelectorAll("[data-radix-focus-guard]").length });
            const bg = document.createElement("div"); bg.className = "picker-dialog-bg";
            bg.setAttribute("style", "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.4)");
            const dlg = document.createElement("div"); dlg.className = "picker-dialog";
            dlg.setAttribute("style", "position:fixed;left:5%;top:10%;width:90%;height:70%;z-index:1001;background:#fff");
            const fr = document.createElement("iframe"); fr.className = "picker-frame"; fr.title = "Google Picker";
            fr.setAttribute("style", "width:100%;height:100%;border:0");
            fr.srcdoc = "<input id='q' aria-label='Search'><p>Facebook Leads</p><button id='sel' onclick=\"parent.postMessage('gp:pick','*')\">Select</button>"
              + " <button id='cancel' onclick=\"parent.postMessage('gp:cancel','*')\">Cancel</button>";
            dlg.appendChild(fr); document.body.append(bg, dlg); nodes = [bg, dlg];
            onMsg = (e) => {
              if (e.data === "gp:pick") { remove(); cb({ action: "picked", docs: [{ id: "SHEET_ABCDEFGHIJKL", name: "Facebook Leads" }] }); }
              if (e.data === "gp:cancel") { remove(); cb({ action: "cancel" }); }
            };
            window.addEventListener("message", onMsg);
            setTimeout(() => cb({ action: "loaded" }), 10);
            if (window.__pickerMode === "error") setTimeout(() => cb({ action: "error" }), 150);
          },
          dispose: () => { window.__pickerDisposed++; remove(); },
        };
      };
    },
  } };
  window.gapi = { load: (n, cfg) => (typeof cfg === "function" ? cfg : cfg.callback)() };
}

/** Clicks a button inside the Picker iframe at its screen position, as a person would, and reports what was hit. */
async function humanClick(page, selector) {
  const box = await page.frameLocator("iframe.picker-frame").locator(selector).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.className ?? null, [x, y]);
  await page.mouse.click(x, y);
  return hit;
}

/** Mapping v2 in a real browser: auto-mapping, the searchable picker, header issues, typed preview, acknowledgement, edit. */
async function v2Flow(page, vp) {
  await page.getByRole("button", { name: "Add sheet" }).click();
  await page.getByRole("button", { name: "Choose spreadsheet" }).click();
  await page.locator("iframe.picker-frame").waitFor();
  check(await humanClick(page, "#sel") === "picker-frame", `${vp.name} v2: Picker Select is clickable`);
  await page.getByRole("button", { name: /^Leads$/ }).click();
  await page.getByLabel("Field for Phone").waitFor();
  const field = (h) => page.getByLabel(`Field for ${h}`).textContent();
  check((await field("City")).includes("City") && (await field("Zip")).includes("ZIP Code") && (await field("Coverage Amount")).includes("Coverage Amount"),
        `${vp.name} v2: City, Zip and Coverage Amount auto-mapped to their fields`);
  check((await field("Mailing Address")).includes("Don't import"), `${vp.name} v2: Mailing Address is never auto-mapped to Email`);
  check(await page.getByText(/Columns without a header have data: J\./).isVisible(), `${vp.name} v2: blank-header column with data is reported`);
  check(state.calls.includes("context") && state.calls.includes("headers"), `${vp.name} v2: catalog re-read and current headers read`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-v2-1-mapping.png`, fullPage: true });

  await page.getByLabel("Field for Mailing Address").click();
  await page.getByPlaceholder("Search fields…").fill("zip");
  const zip = page.getByRole("option", { name: /ZIP Code/ });
  await zip.waitFor();
  check((await zip.textContent()).includes("Used by “Zip”"), `${vp.name} v2: picker search finds ZIP Code and says which column uses it`);
  const pop = await page.locator("[cmdk-root]").boundingBox();
  check(pop && pop.x >= 0 && pop.x + pop.width <= vp.width + 1, `${vp.name} v2: field picker fits the viewport`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-v2-2-picker.png`, fullPage: false });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText("02134").waitFor();
  check(await page.getByText("250000.00").isVisible() && await page.getByText("Austin").isVisible() && await page.getByText("ann@example.test").isVisible(),
        `${vp.name} v2: preview shows optional values as stored`);
  const enable = page.getByRole("button", { name: "Enable" });
  check(await enable.isDisabled(), `${vp.name} v2: Enable waits for the ignored-columns acknowledgement`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-v2-3-preview.png`, fullPage: true });
  await page.getByLabel(/won't be imported into AgentFlow/).click();
  await enable.click();
  await page.getByText("Facebook Leads → Leads").waitFor();
  const m = state.sources[0]?.mapping;
  check(m?.v === 2 && m.ignored.includes("Mailing Address") && m.columns.some((c) => c.header === "Zip" && c.target === `custom:${F.zip}`),
        `${vp.name} v2: saved as mapping v2 with the acknowledged ignored columns`);

  const headerReads = state.calls.filter((c) => c === "headers").length;
  await page.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit mapping" }).click();
  await page.getByLabel("Field for Mailing Address").waitFor();
  check(state.calls.filter((c) => c === "headers").length === headerReads + 1 && (await field("Zip")).includes("ZIP Code"),
        `${vp.name} v2: editing re-reads the sheet's current columns and keeps the saved choices`);
  await page.keyboard.press("Escape");
  await page.getByLabel("Field for Mailing Address").waitFor({ state: "detached" });
}

// CHROMIUM_PATH selects a preinstalled browser; otherwise Playwright's own installed Chromium is used (CI).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
const check = (ok, name) => { results.push(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) console.error("FAIL", name); };

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  Object.assign(state, { connected: true, sources: [], calls: [], syncs: 0, previews: 0, applies: 0, lastDecisions: null, lastSnapshot: null });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(([key, session]) => { localStorage.setItem(key, session); },
    ["sb-mock-auth-token", JSON.stringify({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp, user })]);
  await ctx.route("https://apis.google.com/js/api.js", (route) => route.fulfill({ contentType: "application/javascript",
    body: `(${pickerStub.toString()})();` }));
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
  await page.screenshot({ path: `${OUT}/gs-${vp.name}${V2 ? "-v2" : ""}-1-connected.png`, fullPage: true });
  if (V2) {
    await v2Flow(page, vp);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${vp.name} v2: no horizontal page scroll`);
    check(errors.length === 0, `${vp.name} v2: no page errors ${errors.join(" | ").slice(0, 200)}`);
    await ctx.close();
    continue;
  }

  // Add sheet → Picker. The dialog closes before the Picker shows, so nothing modal sits over or under it.
  await page.getByRole("button", { name: "Add sheet" }).click();
  const choose = page.getByRole("button", { name: "Choose spreadsheet" });
  // 1) Cancel inside the Picker → back to the dialog, nothing inspected, Picker removed
  await choose.click();
  await page.locator("iframe.picker-frame").waitFor();
  check(await humanClick(page, "#cancel") === "picker-frame", `${vp.name}: Picker Cancel is clickable (nothing covers it)`);
  await choose.waitFor();
  check(!state.calls.includes("inspect") && await page.locator(".picker-dialog").count() === 0,
        `${vp.name}: Cancel reopens the dialog; nothing inspected; Picker removed`);
  // 2) Google reports an error → message in the reopened dialog, Picker disposed, retry available
  await page.evaluate(() => { window.__pickerMode = "error"; });
  await choose.click();
  await page.getByText("Google couldn't open the file picker. Try again. If it keeps happening, tell your admin.").waitFor();
  check(await page.locator(".picker-dialog").count() === 0 && await choose.isEnabled(), `${vp.name}: Google error → message, Picker disposed, retry enabled`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-1b-picker-error.png`, fullPage: true });
  await page.evaluate(() => { window.__pickerMode = "pick"; });
  // 3) Retry; a click on the closing dialog's backdrop must not abandon the flow; then pick with a real click
  const heading = await page.locator("h1").first().boundingBox();       // inert text outside the dialog box
  await choose.click();
  await page.locator('[role="dialog"][data-state="closed"]').waitFor({ state: "attached", timeout: 5000 }).catch(() => undefined);
  await page.mouse.click(heading.x + 8, heading.y + heading.height / 2);
  await page.locator("iframe.picker-frame").waitFor();
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-1c-picker-open.png`, fullPage: true });
  const shows = await page.evaluate(() => window.__pickerShows);
  check(shows.length === 3 && shows.every((s) => s.dialogs === 0 && s.focusGuards === 0 && s.bodyPointerEvents !== "none"),
        `${vp.name}: every Picker opened only after the dialog's pointer lock and focus trap were gone`);
  const searchHit = await humanClick(page, "#q");
  await page.keyboard.type("Leads");
  await page.waitForTimeout(150);                                       // a focus trap would pull focus back by now
  check(searchHit === "picker-frame" && await page.frameLocator("iframe.picker-frame").locator("#q").inputValue() === "Leads"
        && await page.evaluate(() => document.activeElement?.className === "picker-frame"), `${vp.name}: keyboard focus stays in the Picker (search typing works)`);
  check(await humanClick(page, "#sel") === "picker-frame", `${vp.name}: Picker Select is clickable`);
  await page.getByRole("button", { name: /^Leads$/ }).click();
  await page.getByLabel("Name", { exact: true }).waitFor();
  const picker = await page.evaluate(() => window.__picker);
  check(picker?.setAppId === "87346168200" && picker?.setDeveloperKey === "test-picker-key", `${vp.name}: Picker appId = project number, developer key set`);
  check(picker?.mode === "list", `${vp.name}: Picker uses the list view (drive.file has no thumbnail access)`);
  check(state.calls.filter((c) => c === "picker_token").length === 3 && state.calls.filter((c) => c === "inspect").length === 1,
        `${vp.name}: a fresh token per attempt; one inspect, after the pick`);
  check(await page.evaluate(() => window.__pickerDisposed) === 3 && await page.locator(".picker-dialog").count() === 0,
        `${vp.name}: every finished Picker disposed`);
  const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  check(!stored.includes("ya29.fake-local-token"), `${vp.name}: Picker token not in browser storage`);
  check(await page.getByLabel("Field for First Name").textContent().then((t) => t.includes("First Name")), `${vp.name}: auto-mapped First Name`);
  check(await page.getByLabel("Field for Coverage Amount").textContent().then((t) => t.includes("Coverage Amount")), `${vp.name}: auto-mapped custom field`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-2-mapping.png`, fullPage: true });

  // Preview (read-only) → new rows default → Enable
  const before = state.calls.length;
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByText(/2 ready · 4 need fixes · 1 repeat$/).waitFor();
  check(await page.getByText("No Lead ID", { exact: true }).isVisible() && await page.getByText("Lead ID conflict").first().isVisible()
        && await page.getByText("Repeat · imported once").isVisible(), `${vp.name}: preview shows the shared ID classifier outcomes`);
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
  await page.getByText("Real-time sync active").waitFor({ timeout: 10000 });
  check(await page.getByText(/Last successful sync .* ago/).isVisible(), `${vp.name}: real-time monitoring line and last successful sync shown`);
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-4-active.png`, fullPage: true });

  // A check interrupted by a concurrent change (stale finish) is never reported as "Checked"
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByText(/Sync stopped because the sheet or its Google connection changed · 1 imported before it stopped/).waitFor({ timeout: 10000 });
  check(true, `${vp.name}: interrupted sync reported truthfully with committed count`);

  // Identity review: excluded blank-ID rows can't be located → every candidate row needs an explicit decision
  Object.assign(state.sources[0], { health: "needs_review", review_reason: "identity_ambiguous", identity_mode: "source_id", id_header: "Lead ID" });
  await page.reload();
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByText(/originally row 2/).waitFor();
  check(await page.getByText("Same name, phone and email as a row that was left out").isVisible(), `${vp.name}: identity review shows why a row is listed`);
  const resume = page.getByRole("button", { name: "Resume" });
  check(await resume.isDisabled(), `${vp.name}: identity review has no preselected decision`);
  await page.getByRole("button", { name: "Keep all out" }).click();
  await page.screenshot({ path: `${OUT}/gs-${vp.name}-5-identity-review.png`, fullPage: true });
  await resume.click();
  await page.getByText(/changed since you opened this review/).waitFor();
  await page.getByText(/1 of 2 chosen/).waitFor();
  check(await resume.isDisabled(), `${vp.name}: a row arriving before apply needs its own decision; earlier choice kept`);
  await page.getByRole("radiogroup", { name: "Row 4" }).getByLabel("Import").click();
  await resume.click();
  await page.getByRole("button", { name: "Sync now" }).waitFor();
  check(JSON.stringify(state.lastDecisions) === JSON.stringify({ "id:NEWID": "exclude", "id:Q1": "import" }) && state.lastSnapshot?.endsWith("2"),
        `${vp.name}: decisions applied to the refreshed snapshot only`);
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
