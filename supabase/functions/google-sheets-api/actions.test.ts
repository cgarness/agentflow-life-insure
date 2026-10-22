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
