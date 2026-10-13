// google-sheets-api actions. Every action receives the server-derived actor; every write goes through a
// service-role-only wrapper that re-checks ownership, eligibility, versions and connection generation.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LIMITS, type SheetsConfig } from "../_shared/googleSheets/config.ts";
import { DbError, sheetsDb, type ClaimedSource } from "../_shared/googleSheets/db.ts";
import { planRows, runSource } from "../_shared/googleSheets/engine.ts";
import { GoogleApiError } from "../_shared/googleSheets/errors.ts";
import { inspectSpreadsheet, readTab } from "../_shared/googleSheets/google.ts";
import { identityRows } from "../_shared/googleSheets/identity.ts";
import { resolveColumns, resolveCustomFieldNames, validateMapping, type SheetMapping } from "../_shared/googleSheets/mapping.ts";
import { checkScopes, inspectAccessToken, refreshAccessToken } from "../_shared/googleSheets/oauth.ts";

export interface Ctx { svc: SupabaseClient; cfg: SheetsConfig; fetchFn: typeof fetch; userId: string; orgId: string }
export class ActionError extends Error { constructor(public status: number, public code: string) { super(code); } }

const db = (c: Ctx) => sheetsDb(c.svc);
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function connection(c: Ctx) {
  const { data } = await c.svc.from("google_sheets_connections")
    .select("id, status, google_email, google_sub, auth_generation, has_refresh_token, last_error_code, connected_at")
    .eq("user_id", c.userId).eq("organization_id", c.orgId).maybeSingle();
  return data;
}

/** Fresh access token from the stored refresh token; invalid_grant → reconnect (generation-guarded). */
async function access(c: Ctx): Promise<{ token: string; expiresIn: number; connectionId: string; generation: number }> {
  const conn = await connection(c);
  if (!conn || conn.status !== "connected") throw new ActionError(409, "not_connected");
  const tok = await db(c).refreshToken(conn.id);
  if (!tok) throw new ActionError(409, "not_connected");
  try {
    const r = await refreshAccessToken(c.fetchFn, c.cfg, tok.refresh_token);
    return { token: r.access_token, expiresIn: Number(r.expires_in ?? 0), connectionId: conn.id, generation: tok.auth_generation };
  } catch (e) {
    if (e instanceof GoogleApiError && e.failure === "reconnect") {
      await db(c).markReconnect(conn.id, tok.auth_generation, e.reason);
      throw new ActionError(409, "reconnect_required");
    }
    throw e;
  }
}

async function ownSource(c: Ctx, id: string) {
  const { data } = await c.svc.from("google_sheets_sources").select("*")
    .eq("id", id).eq("user_id", c.userId).eq("organization_id", c.orgId).maybeSingle();
  if (!data) throw new ActionError(404, "not_found");
  return data;
}

async function eligible(c: Ctx): Promise<boolean> {
  const { data, error } = await c.svc.rpc("google_sheets_owner_eligible", { p_user: c.userId, p_org: c.orgId });
  return !error && data === true;
}

function mappingOrThrow(m: unknown): SheetMapping {
  const v = validateMapping(m);
  if (!v.ok) throw new ActionError(422, v.reason);
  return v.mapping;
}

/** One consistent read + column/custom-field resolution + planned rows (no writes). */
async function readPlanned(c: Ctx, token: string, spreadsheetId: string, sheetId: number, mapping: SheetMapping, idHeader: string | null) {
  const tab = await readTab(c.fetchFn, token, spreadsheetId, sheetId);
  if (tab.overflow) throw new ActionError(422, "too_large");
  const cols = resolveColumns(tab.header, mapping, idHeader);
  if (cols.problems.length) throw new ActionError(422, `header:${cols.problems[0]}`);
  const ctx = await db(c).context(c.userId, c.orgId);
  const custom = resolveCustomFieldNames(cols.custom.map((x) => x.customFieldId), ctx.custom_fields ?? []);
  if (custom.unresolved.length) throw new ActionError(422, "custom_field_unavailable");
  return { tab, planned: await planRows(tab.rows, cols, custom.names), ctx };
}

export async function status(c: Ctx) {
  const conn = await connection(c);
  return {
    enabled: c.cfg.enabled, eligible: await eligible(c),
    connection: conn ? { status: conn.status, google_email: conn.google_email, connected_at: conn.connected_at,
                         last_error_code: conn.last_error_code } : null,
  };
}

export async function context(c: Ctx) {
  const ctx = await db(c).context(c.userId, c.orgId);
  return { ...ctx, custom_fields: (ctx.custom_fields ?? []).map((f) => ({ id: f.id, name: f.name, created_by: f.created_by, created_at: f.created_at })) };
}

/** Short-lived Picker token. ACTUAL token scopes are inspected; anything broader is refused. */
export async function pickerToken(c: Ctx) {
  if (!(await eligible(c))) throw new ActionError(403, "not_permitted");
  const a = await access(c);
  const info = await inspectAccessToken(c.fetchFn, a.token);
  if (info.aud && info.aud !== c.cfg.clientId) throw new ActionError(409, "reconnect_required");
  if (!checkScopes(info.scopes).ok) throw new ActionError(409, "reconnect_required");
  const expiresIn = Math.max(0, Math.min(3600, info.expiresIn || 3600, a.expiresIn || 3600));
  return { access_token: a.token, expires_in: expiresIn };
}

export async function inspect(c: Ctx, body: Record<string, unknown>) {
  if (!(await eligible(c))) throw new ActionError(403, "not_permitted");
  const spreadsheetId = str(body.spreadsheet_id, 200);
  const a = await access(c);
  const info = await inspectSpreadsheet(c.fetchFn, a.token, spreadsheetId);
  const { data: existing } = await c.svc.from("google_sheets_sources").select("sheet_id")
    .eq("user_id", c.userId).eq("organization_id", c.orgId).eq("spreadsheet_id", spreadsheetId);
  const configured = new Set((existing ?? []).map((r: { sheet_id: number }) => Number(r.sheet_id)));
  return { name: info.name, tabs: info.tabs.map((t) => ({ ...t, configured: configured.has(t.sheetId) })) };
}

export async function headers(c: Ctx, body: Record<string, unknown>) {
  if (!(await eligible(c))) throw new ActionError(403, "not_permitted");
  const a = await access(c);
  const tab = await readTab(c.fetchFn, a.token, str(body.spreadsheet_id, 200), Number(body.sheet_id));
  return { title: tab.title, spreadsheet_name: tab.spreadsheetName, header: tab.header, row_count: tab.rows.length,
           overflow: tab.overflow, sample: tab.rows.slice(0, 3) };
}

/** Read-only preview: sample outcomes, counts, duplicate classification with the SAME SQL predicate. */
export async function preview(c: Ctx, body: Record<string, unknown>) {
  if (!(await eligible(c))) throw new ActionError(403, "not_permitted");
  const mapping = mappingOrThrow(body.mapping);
  const mode = body.identity_mode === "source_id" ? "source_id" : "row_position";
  const idHeader = mode === "source_id" ? str(body.id_header, 200) || null : null;
  if (mode === "source_id" && !idHeader) throw new ActionError(422, "id_header_required");
  const spreadsheetId = str(body.spreadsheet_id, 200), sheetId = Number(body.sheet_id);
  const a = await access(c);
  const { tab, planned, ctx } = await readPlanned(c, a.token, spreadsheetId, sheetId, mapping, idHeader);
  const sample = planned.filter((r) => !r.empty).slice(0, LIMITS.previewRows);
  const dupFlags: boolean[] = await (async () => {
    const valid = sample.filter((r) => r.valid);
    if (!valid.length) return [];
    const { data, error } = await c.svc.rpc("google_sheets_preview_duplicates", {
      p_user: c.userId, p_org: c.orgId, p_rows: valid.map((r) => ({ phone: r.lead?.phone ?? "", email: r.lead?.email ?? "" })) });
    if (error) throw new DbError(error.message);
    return data as boolean[];
  })();
  let vi = 0;
  const rows = sample.map((r) => {
    const dup = r.valid ? dupFlags[vi++] === true : false;
    return {
      row: r.n, first_name: r.lead?.first_name ?? "", last_name: r.lead?.last_name ?? "", phone: r.lead?.phone ?? "",
      email: r.lead?.email ?? "", outcome: !r.valid ? "invalid" : dup ? `duplicate_${ctx.duplicate_action}` : "import",
      reason: r.valid ? null : r.reason,
    };
  });
  const nonEmpty = planned.filter((r) => !r.empty);
  const ids = mode === "source_id" ? identityRows(planned, mode).map((r) => r.k).filter((k) => k.startsWith("id:")) : [];
  const { data: prior } = await c.svc.rpc("google_sheets_prior_receipt_count", {
    p_user: c.userId, p_org: c.orgId, p_spreadsheet: spreadsheetId, p_sheet: sheetId,
    p_fps: mode === "row_position" ? nonEmpty.map((r) => r.fp) : [], p_keys: ids });
  return {
    title: tab.title, total_rows: nonEmpty.length, valid_rows: nonEmpty.filter((r) => r.valid).length,
    invalid_rows: nonEmpty.filter((r) => !r.valid).length, imported_before: Number(prior ?? 0), rows,
    duplicate_action: ctx.duplicate_action, has_lead_created_workflows: ctx.has_lead_created_workflows,
  };
}

export async function save(c: Ctx, body: Record<string, unknown>) {
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const mapping = mappingOrThrow(payload.mapping);
  const mode = payload.identity_mode === "source_id" ? "source_id" : "row_position";
  const idHeader = mode === "source_id" ? str(payload.id_header, 200) : "";
  if (mode === "source_id" && !idHeader) throw new ActionError(422, "id_header_required");
  if (!str(payload.display_name, 120)) throw new ActionError(422, "display_name_required");
  const { data, error } = await c.svc.rpc("google_sheets_save_source", {
    p_user: c.userId, p_org: c.orgId, p_source: body.source_id ?? null, p_expected_version: body.expected_version ?? null,
    p_payload: {
      spreadsheet_id: str(payload.spreadsheet_id, 200), sheet_id: Number(payload.sheet_id),
      spreadsheet_name: str(payload.spreadsheet_name), sheet_title: str(payload.sheet_title),
      display_name: str(payload.display_name, 120), mapping, identity_mode: mode, id_header: idHeader || null,
      lead_source_default: str(payload.lead_source_default, 120) || "Google Sheets",
      include_existing: payload.include_existing === true,
    },
  });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0];
}

/** Activation: one consistent server read → baseline (or initial import) committed atomically. */
export async function activate(c: Ctx, body: Record<string, unknown>) {
  const src = await ownSource(c, str(body.source_id, 64));
  if (src.state !== "draft") return { outcome: "already_active", config_version: src.config_version };
  if (Number(body.expected_version) !== src.config_version) throw new ActionError(409, "version_conflict");
  const mapping = mappingOrThrow(src.mapping);
  const a = await access(c);
  const { planned } = await readPlanned(c, a.token, src.spreadsheet_id, Number(src.sheet_id), mapping,
    src.identity_mode === "source_id" ? src.id_header : null);
  const rows = identityRows(planned, src.identity_mode);
  const { data, error } = await c.svc.rpc("google_sheets_activate", {
    p_user: c.userId, p_org: c.orgId, p_source: src.id, p_expected_version: src.config_version,
    p_generation: a.generation, p_rows: rows, p_row_count: planned.length });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0];
}

export async function syncNow(c: Ctx, body: Record<string, unknown>) {
  const src = await ownSource(c, str(body.source_id, 64));
  const lease = crypto.randomUUID();
  const claimed: ClaimedSource[] = await db(c).claim(lease, 1, { id: src.id, user: c.userId, org: c.orgId });
  if (!claimed.length) throw new ActionError(409, "busy");
  return await runSource({ db: db(c), cfg: c.cfg, fetchFn: c.fetchFn }, claimed[0], lease, "manual", LIMITS.manualBudgetMs);
}

export async function setState(c: Ctx, body: Record<string, unknown>, action: "pause" | "resume" | "remove") {
  const { data, error } = await c.svc.rpc("google_sheets_set_state", {
    p_user: c.userId, p_org: c.orgId, p_source: str(body.source_id, 64), p_action: action });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0];
}

/** Recovery / identity change: classify the current rows under the NEW config, then apply on request. */
export async function review(c: Ctx, body: Record<string, unknown>, dryRun: boolean) {
  const src = await ownSource(c, str(body.source_id, 64));
  const mapping = mappingOrThrow(body.mapping ?? src.mapping);
  const mode = body.identity_mode === "source_id" ? "source_id" : "row_position";
  const idHeader = mode === "source_id" ? str(body.id_header, 200) || null : null;
  if (mode === "source_id" && !idHeader) throw new ActionError(422, "id_header_required");
  const a = await access(c);
  // When leaving ID mode, keep the old IDs so already-imported IDs are recognised.
  const carryId = mode === "row_position" && src.identity_mode === "source_id" ? src.id_header : null;
  const { planned } = await readPlanned(c, a.token, src.spreadsheet_id, Number(src.sheet_id), mapping, idHeader ?? carryId);
  const rows = identityRows(planned, mode, true);
  const { data, error } = await c.svc.rpc("google_sheets_review", {
    p_user: c.userId, p_org: c.orgId, p_source: src.id, p_expected_version: Number(body.expected_version),
    p_identity_mode: mode, p_id_header: idHeader, p_mapping: mapping, p_rows: rows,
    p_import_unknown: body.import_unknown === true, p_dry_run: dryRun });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0];
}

export async function disconnect(c: Ctx) {
  const { error } = await c.svc.rpc("google_sheets_disconnect", { p_user: c.userId, p_org: c.orgId });
  if (error) throw new DbError(error.message, error.code);
  return { ok: true };
}
