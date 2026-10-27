// Picker token re-check (Finding 2 audit / Amendment B). The REGRESSION case fails on the reviewed head 8b675e5
// (the token minted for an old authorisation generation was returned) and passes on the corrected code.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { ActionError, pickerToken, preview, type Ctx } from "./actions.ts";
import { planRows } from "../_shared/googleSheets/engine.ts";
import { planSourceId } from "../_shared/googleSheets/identity.ts";
import { resolveColumns, validateMapping, type SheetMapping } from "../_shared/googleSheets/mapping.ts";

const CFG = { enabled: true, clientId: "cid.apps.googleusercontent.com", clientSecret: "s", redirectUri: "https://x/cb",
  allowedOrigins: ["https://app.example.test"], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const USER = "11111111-0000-0000-0000-000000000001", ORG = "a0000000-0000-0000-0000-00000000000a";

function fakeCtx(opts: { onMint?: (st: State) => void; scope?: string } = {}) {
  const st: State = {
    conn: { id: "c1", status: "connected", google_email: "a@b.test", google_sub: "sub", auth_generation: 5, has_refresh_token: true,
            last_error_code: null, connected_at: null, user_id: USER, organization_id: ORG },
    eligible: true, markReconnect: 0,
  };
  const svc = {
    from: (_table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: st.conn.status === "disconnected" ? null : { ...st.conn }, error: null }) };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      switch (fn) {
        case "google_sheets_owner_eligible": return { data: st.eligible, error: null };
        case "google_sheets_get_refresh_token":
          return { data: st.conn.status === "connected" ? [{ refresh_token: "rt", auth_generation: st.conn.auth_generation, user_id: USER, organization_id: ORG }] : [], error: null };
        case "google_sheets_mark_reconnect": st.markReconnect++; return { data: true, error: null };
        case "google_sheets_context": return { data: { duplicate_rule: "phone_or_email", duplicate_scope: "all_agents", duplicate_action: "flag",
          default_status: "New", lead_sources: [], has_lead_created_workflows: false, custom_fields: [] }, error: null };
        case "google_sheets_preview_duplicates": return { data: (args.p_rows as unknown[]).map(() => false), error: null };
        case "google_sheets_prior_receipt_count": return { data: 0, error: null };
        case "google_sheets_connection_current": {
          const c = st.conn;
          const v = c.id !== args.p_connection || c.user_id !== args.p_user || c.organization_id !== args.p_org || c.status !== "connected" ? "not_connected"
            : c.auth_generation !== args.p_generation ? "changed" : !st.eligible ? "not_permitted" : "current";
          return { data: v, error: null };
        }
        default: return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
    },
  };
  const fetchFn = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url.includes("/drive/v3/files/")) return r(200, { id: "x", name: "Leads", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    if (url.includes("/values/")) return r(200, { values: SHEET });
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Tab", index: 0, gridProperties: { rowCount: 50, columnCount: 5 } } }] });
    }
    if (url.includes("oauth2.googleapis.com/tokeninfo")) {
      return r(200, { aud: CFG.clientId, scope: opts.scope ?? "openid email https://www.googleapis.com/auth/drive.file", expires_in: 3599 });
    }
    if (url.includes("oauth2.googleapis.com/token")) { opts.onMint?.(st); return r(200, { access_token: "ya29.minted-token", expires_in: 3599 }); }
    return r(404, {});
  };
  const c = { svc, cfg: CFG, fetchFn, userId: USER, orgId: ORG } as unknown as Ctx;
  return { c, st };
}
const MAPPING = { v: 1, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" },
  { header: "Phone", target: "phone" }, { header: "State", target: "state" }] };
const SHEET = [["Lead ID", "First", "Last", "Phone", "State"],
  ["", "Ann", "Lee", "5550001", "CA"],          // missing_id
  ["X", "Bo", "Diaz", "5550002", "CA"],          // duplicate_id (state differs)
  ["X", "Bo", "Diaz", "5550002", "TX"],
  ["Y", "Cy", "Park", "5550003", "NV"],          // ok
  ["Y", "Cy", "Park", "5550003", "NV"],          // repeat
  ["Z", "Di", "", "5550004", ""],                // invalid (missing last name)
  ["W", "Ed", "Moss", "5550005", ""]];          // ok
interface State {
  conn: { id: string; status: string; google_email: string; google_sub: string; auth_generation: number; has_refresh_token: boolean;
          last_error_code: null; connected_at: null; user_id: string; organization_id: string };
  eligible: boolean; markReconnect: number;
}

Deno.test("REGRESSION picker: a reconnect while the token is minted → no token returned, newer connection untouched", async () => {
  const { c, st } = fakeCtx({ onMint: (s) => { s.conn.auth_generation = 6; } });   // same Google account, new generation
  const e = await assertRejects(() => pickerToken(c), ActionError);
  assertEquals([e.status, e.code], [409, "connection_changed"]);
  assertEquals(st.markReconnect, 0, "a stale response never disables the newer connection");
  assertEquals(st.conn.status, "connected");
});

Deno.test("REGRESSION picker: a disconnect while the token is minted → no token returned", async () => {
  const { c } = fakeCtx({ onMint: (s) => { s.conn.status = "disconnected"; } });
  const e = await assertRejects(() => pickerToken(c), ActionError);
  assertEquals([e.status, e.code], [409, "not_connected"]);
});

Deno.test("REGRESSION picker: import permission removed while the token is minted → no token returned", async () => {
  const { c } = fakeCtx({ onMint: (s) => { s.eligible = false; } });
  const e = await assertRejects(() => pickerToken(c), ActionError);
  assertEquals([e.status, e.code], [403, "not_permitted"]);
});

Deno.test("CONTROL picker: unchanged connection → short-lived token after the actual-scope check", async () => {
  const { c } = fakeCtx();
  const t = await pickerToken(c);
  assertEquals(t.access_token, "ya29.minted-token");
  assert(t.expires_in > 0 && t.expires_in <= 3600);
});

Deno.test("CONTROL picker: broader actual scopes are refused", async () => {
  const { c } = fakeCtx({ scope: "openid email https://www.googleapis.com/auth/drive" });
  const e = await assertRejects(() => pickerToken(c), ActionError);
  assertEquals(e.code, "reconnect_required");
});

async function previewAndPlan() {
  const { c } = fakeCtx();
  const p = await preview(c, { spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, mapping: MAPPING, identity_mode: "source_id", id_header: "Lead ID" });
  const m = validateMapping(MAPPING);
  if (!m.ok) throw new Error("mapping");
  const planned = await planRows(SHEET.slice(1), resolveColumns(SHEET[0], m.mapping as SheetMapping, "Lead ID"), new Map());
  return { p, plan: planSourceId(planned, [], new Set()) };
}

Deno.test("REGRESSION F3 preview: the rows the preview calls ready are exactly the rows processing imports", async () => {
  const { p, plan } = await previewAndPlan();
  const ready = p.rows.filter((r: { outcome: string }) => r.outcome === "import").map((r: { row: number }) => r.row);
  assertEquals(ready, plan.candidates.map((x) => x.row.n));
});

Deno.test("preview outcomes use the shared ID classifier (missing_id → duplicate_id → repeat → invalid → ready)", async () => {
  const { p } = await previewAndPlan();
  assertEquals(p.rows.map((r: { row: number; outcome: string }) => [r.row, r.outcome]),
    [[2, "missing_id"], [3, "duplicate_id"], [4, "duplicate_id"], [5, "import"], [6, "repeat"], [7, "invalid"], [8, "import"]]);
  assertEquals([p.total_rows, p.valid_rows, p.invalid_rows, p.repeat_rows], [7, 2, 4, 1]);
});

// ---------------------------------------------------------------- mapping v2 (catalog handshake, write gate, previews)
import { activate, context, headers, review, save } from "./actions.ts";

const AMT = "22222222-2222-4222-8222-222222222222", ZIP = "44444444-4444-4444-8444-444444444444";
interface V2Opts { catalog?: number; values?: string[][]; locale?: string | null; columnCount?: number; overflowRow?: string[]; source?: Record<string, unknown> }
function v2Ctx(o: V2Opts = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const fields = [
    { id: AMT, name: "Amt Requested", created_by: USER, created_at: "2026-08-05T00:00:00Z", type: "Number", required: false, dropdown_options: null,
      scope: "personal", own: true },
    { id: ZIP, name: "ZIP Code", created_by: null, created_at: "2026-10-28T00:00:00Z", type: "Text", required: false, dropdown_options: null,
      scope: "agency", own: false },
  ];
  const ctxData = () => ({ duplicate_rule: "phone_or_email", duplicate_scope: "all_agents", duplicate_action: "flag", default_status: "New",
    lead_sources: [], has_lead_created_workflows: false,
    ...(o.catalog === 2 ? { catalog_version: 2, custom_fields: fields }
      : { custom_fields: fields.map(({ id, name, created_by, created_at }) => ({ id, name, created_by, created_at })) }) });
  const conn = { id: "c1", status: "connected", google_email: "a@b.test", google_sub: "sub", auth_generation: 5, has_refresh_token: true,
    last_error_code: null, connected_at: null };
  const svc = {
    from: (table: string) => {
      const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: table === "google_sheets_sources" ? o.source ?? null : conn, error: null }) };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      switch (fn) {
        case "google_sheets_owner_eligible": return { data: true, error: null };
        case "google_sheets_get_refresh_token": return { data: [{ refresh_token: "rt", auth_generation: 5 }], error: null };
        case "google_sheets_context": return { data: ctxData(), error: null };
        case "google_sheets_preview_duplicates": return { data: (args.p_rows as unknown[]).map(() => false), error: null };
        case "google_sheets_prior_receipt_count": return { data: 0, error: null };
        case "google_sheets_save_source": return { data: [{ source_id: "s1", config_version: 1 }], error: null };
        case "google_sheets_activate": return { data: [{ outcome: "activated", config_version: 2 }], error: null };
        default: return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }
    },
  };
  const values = o.values ?? [["First", "Last", "Phone", "Amt", "Zip", "Address"], ["Ann", "Lee", "5550001111", "$1,234.50", "02134", "1 Main"]];
  const fetchFn = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const r = (s: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.t", expires_in: 3599 });
    if (url.includes("/drive/v3/files/")) return r(200, { id: "x", name: "Leads", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false });
    if (url.includes("/values/")) {
      calls.push({ fn: "google.values", args: { range: decodeURIComponent(url.split("/values/")[1].split("?")[0]) } });
      return r(200, { values: decodeURIComponent(url).includes("!GS1:") ? [o.overflowRow ?? []] : values });
    }
    if (url.includes("sheets.googleapis.com/v4/spreadsheets/")) {
      return r(200, { properties: { title: "Leads", ...(o.locale === null ? {} : { locale: o.locale ?? "en_US" }) },
        sheets: [{ properties: { sheetId: 0, title: "Tab", index: 0, gridProperties: { rowCount: 50, columnCount: o.columnCount ?? 6 } } }] });
    }
    return r(404, {});
  };
  return { c: { svc, cfg: CFG, fetchFn, userId: USER, orgId: ORG } as unknown as Ctx, calls };
}
const V2MAP = { v: 2, columns: [{ header: "First", target: "first_name" }, { header: "Last", target: "last_name" }, { header: "Phone", target: "phone" },
  { header: "Amt", target: `custom:${AMT}` }, { header: "Zip", target: `custom:${ZIP}` }], ignored: ["Address"] };
const PREVIEW = (mapping: unknown) => ({ spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, mapping, identity_mode: "row_position", lead_source_default: "Sheets" });

Deno.test("context: an old catalog advertises v1 only and keeps the exact legacy field shape", async () => {
  const out = await context(v2Ctx().c);
  assertEquals([out.catalog_version, out.mapping_versions], [1, [1]]);
  assertEquals(Object.keys(out.custom_fields[0]).sort(), ["created_at", "created_by", "id", "name"]);
});

Deno.test("context: the typed catalog advertises v2 and passes types, scope and ownership through", async () => {
  const out = await context(v2Ctx({ catalog: 2 }).c);
  assertEquals([out.catalog_version, out.mapping_versions], [2, [1, 2]]);
  assertEquals(out.custom_fields.map((f: Record<string, unknown>) => [f.name, f.type, f.scope, f.own]),
    [["Amt Requested", "Number", "personal", true], ["ZIP Code", "Text", "agency", false]]);
});

Deno.test("v2 write gate: preview, save and review refuse a NEW v2 mapping until the typed catalog exists", async () => {
  const { c, calls } = v2Ctx({ source: { id: "s1", state: "enabled", config_version: 4, mapping: { v: 1, columns: V2MAP.columns },
    spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, identity_mode: "row_position", id_header: null } });
  for (const run of [() => preview(c, PREVIEW(V2MAP)),
    () => review(c, { source_id: "s1", expected_version: 4, mapping: V2MAP, identity_mode: "row_position" }, true),
    () => save(c, { source_id: null, expected_version: null, payload: { spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, display_name: "X", mapping: V2MAP } })]) {
    const e = await assertRejects(run, ActionError);
    assertEquals([e.status, e.code], [422, "mapping_version_unavailable"]);
  }
  assert(!calls.some((x) => x.fn === "google_sheets_save_source" || x.fn === "google_sheets_review"), "nothing written");
  const v1 = await preview(c, PREVIEW({ v: 1, columns: V2MAP.columns }));
  assertEquals(v1.rows[0].fields.find((f: { target: string }) => f.target === `custom:${AMT}`)?.value, "$1,234.50");
});

Deno.test("v2 preview: rows carry the stored values (lossless typed), plus ignored, unaccounted and header issues", async () => {
  const { c } = v2Ctx({ catalog: 2, values: [["First", "Last", "Phone", "Amt", "Zip", "Address", "", "Phone"],
    ["Ann", "Lee", "5550001111", "$1,234.50", "02134", "1 Main", "x", ""], ["Bo", "Ray", "5550002222", "007", "73301", "", "", ""]] });
  const p = await preview(c, PREVIEW({ ...V2MAP, columns: V2MAP.columns.filter((x) => x.target !== "phone").concat({ header: "Phone", target: "phone" }) }))
    .catch((e) => e);
  assertEquals((p as ActionError).code, "header:duplicate:Phone", "a duplicated mapped header is refused, never guessed");
  const { c: c2 } = v2Ctx({ catalog: 2, values: [["First", "Last", "Phone", "Amt", "Zip", "Address", "", "Notes"],
    ["Ann", "Lee", "5550001111", "$1,234.50", "02134", "1 Main", "x", ""], ["Bo", "Ray", "5550002222", "007", "73301", "", "", ""]] });
  const q = await preview(c2, PREVIEW(V2MAP));
  assertEquals(q.rows.map((r: { fields: { target: string; value: string; kept_as_text?: boolean }[] }) => r.fields), [
    [{ target: "lead_source", value: "Sheets" }, { target: `custom:${AMT}`, value: "1234.50" }, { target: `custom:${ZIP}`, value: "02134" }],
    [{ target: "lead_source", value: "Sheets" }, { target: `custom:${AMT}`, value: "007" }, { target: `custom:${ZIP}`, value: "73301" }],
  ]);
  assertEquals([q.mapping_version, q.locale, q.ignored, q.unaccounted_headers], [2, "en_US", ["Address"], ["Notes"]]);
  assertEquals(q.header_issues.map((h: { letter: string; blank: boolean; has_data: boolean }) => [h.letter, h.blank, h.has_data]), [["G", true, true]]);
});

Deno.test("headers: every column flagged with its letter; headers past column 200 are reported, never dropped", async () => {
  const { c, calls } = v2Ctx({ columnCount: 260, overflowRow: ["Spouse", "", "Policy #"] });
  const h = await headers(c, { spreadsheet_id: "SPREADSHEET_123", sheet_id: 0 });
  assertEquals(h.header, ["First", "Last", "Phone", "Amt", "Zip", "Address"], "legacy key unchanged");
  assertEquals(h.columns.map((x: { letter: string; header: string }) => `${x.letter}:${x.header}`), ["A:First", "B:Last", "C:Phone", "D:Amt", "E:Zip", "F:Address"]);
  assertEquals(h.over_limit, { count: 2, headers: ["Spouse", "Policy #"] });
  assertEquals(calls.filter((x) => x.fn === "google.values").map((x) => x.args.range), ["'Tab'!A1:GR10002", "'Tab'!GS1:IZ1"]);
  const { c: narrow, calls: narrowCalls } = v2Ctx({ columnCount: 26 });
  assertEquals((await headers(narrow, { spreadsheet_id: "SPREADSHEET_123", sheet_id: 0 })).over_limit, { count: 0, headers: [] });
  assertEquals(narrowCalls.filter((x) => x.fn === "google.values").length, 1, "no extra Google read for ordinary widths");
});

Deno.test("activate v2: a column added after the preview stops activation with nothing written; accounted columns activate", async () => {
  const src = { id: "s1", state: "draft", config_version: 3, mapping: V2MAP, spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, identity_mode: "row_position",
    id_header: null };
  const { c, calls } = v2Ctx({ catalog: 2, source: src, values: [["First", "Last", "Phone", "Amt", "Zip", "Address", "New Col"], ["Ann", "Lee", "1", "", "", "", ""]] });
  const e = await assertRejects(() => activate(c, { source_id: "s1", expected_version: 3 }), ActionError);
  assertEquals([e.status, e.code], [409, "unacknowledged_columns"]);
  assert(!calls.some((x) => x.fn === "google_sheets_activate"));
  const ok = v2Ctx({ catalog: 2, source: src });
  assertEquals((await activate(ok.c, { source_id: "s1", expected_version: 3 }))?.outcome, "activated");
  const v1 = v2Ctx({ source: { ...src, mapping: { v: 1, columns: V2MAP.columns } }, values: [["First", "Last", "Phone", "Amt", "Zip", "Extra"], ["Ann", "Lee", "1", "", "", ""]] });
  assertEquals((await activate(v1.c, { source_id: "s1", expected_version: 3 }))?.outcome, "activated", "v1 activation is unchanged (no acknowledgement rule)");
});

Deno.test("save v2 with the typed catalog: the mapping (with ignored) reaches the RPC verbatim", async () => {
  const { c, calls } = v2Ctx({ catalog: 2 });
  await save(c, { source_id: null, expected_version: null, payload: { spreadsheet_id: "SPREADSHEET_123", sheet_id: 0, display_name: "X", mapping: V2MAP } });
  assertEquals((calls.find((x) => x.fn === "google_sheets_save_source")?.args.p_payload as Record<string, unknown>).mapping, V2MAP);
});
