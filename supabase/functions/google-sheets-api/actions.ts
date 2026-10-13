// google-sheets-api actions. Every action receives the server-derived actor; every write goes through a
// service-role-only wrapper that re-checks ownership, eligibility, versions and connection generation.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LIMITS, type SheetsConfig } from "../_shared/googleSheets/config.ts";
import { DbError, sheetsDb, type ClaimedSource } from "../_shared/googleSheets/db.ts";
import { planRows, runSource } from "../_shared/googleSheets/engine.ts";
import { GoogleApiError } from "../_shared/googleSheets/errors.ts";
import { inspectSpreadsheet, readTab } from "../_shared/googleSheets/google.ts";
import { classifySourceIdRows, identityReview, identityRows } from "../_shared/googleSheets/identity.ts";
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

/**
 * Short-lived Picker token. ACTUAL token scopes are inspected; anything broader is refused. Immediately before the
 * token is returned, the SAME connection must still be current (id, generation, owner, connected, owner eligible):
 * a reconnect, disconnect or permission change during minting returns no token. A stale response never disables
 * the newer connection (no mark_reconnect here). This does not revoke a token Google already minted — it is never
 * returned and expires on its own (at most one hour).
 */
export async function pickerToken(c: Ctx) {
  if (!(await eligible(c))) throw new ActionError(403, "not_permitted");
  const a = await access(c);
  const info = await inspectAccessToken(c.fetchFn, a.token);
  if (info.aud && info.aud !== c.cfg.clientId) throw new ActionError(409, "reconnect_required");
  if (!checkScopes(info.scopes).ok) throw new ActionError(409, "reconnect_required");
  const current = await db(c).connectionCurrent(c.userId, c.orgId, a.connectionId, a.generation);
  if (current !== "current") {
    throw current === "not_permitted" ? new ActionError(403, "not_permitted")
      : new ActionError(409, current === "changed" ? "connection_changed" : "not_connected");
  }
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
  // ID mode: the SAME classifier as processing (missing_id → duplicate_id → repeat → invalid → policy → ready).
  const cls = mode === "source_id" ? classifySourceIdRows(planned) : null;
  const idOutcome = (n: number) => { const k = cls?.get(n); return k && k !== "ok" ? k : null; };
  const importable = (r: (typeof planned)[number]) => r.valid && idOutcome(r.n) === null;
  const sample = planned.filter((r) => !r.empty).slice(0, LIMITS.previewRows);
  const dupFlags: boolean[] = await (async () => {
    const valid = sample.filter(importable);
    if (!valid.length) return [];
    const { data, error } = await c.svc.rpc("google_sheets_preview_duplicates", {
      p_user: c.userId, p_org: c.orgId, p_rows: valid.map((r) => ({ phone: r.lead?.phone ?? "", email: r.lead?.email ?? "" })) });
    if (error) throw new DbError(error.message);
    return data as boolean[];
  })();
  let vi = 0;
  const rows = sample.map((r) => {
    const dup = importable(r) ? dupFlags[vi++] === true : false;
    const idk = idOutcome(r.n);
    return {
      row: r.n, first_name: r.display?.first_name ?? "", last_name: r.display?.last_name ?? "", phone: r.display?.phone ?? "",
      email: r.display?.email ?? "",
      outcome: idk ?? (!r.valid ? "invalid" : dup ? `duplicate_${ctx.duplicate_action}` : "import"),
      reason: idk ? null : r.valid ? null : r.reason,
    };
  });
  const nonEmpty = planned.filter((r) => !r.empty);
  const repeats = nonEmpty.filter((r) => idOutcome(r.n) === "repeat").length;
  const ids = mode === "source_id" ? identityRows(planned, mode).map((r) => r.k).filter((k) => k.startsWith("id:")) : [];
  const { data: prior } = await c.svc.rpc("google_sheets_prior_receipt_count", {
    p_user: c.userId, p_org: c.orgId, p_spreadsheet: spreadsheetId, p_sheet: sheetId,
    p_fps: mode === "row_position" ? nonEmpty.map((r) => r.fp) : [], p_keys: ids });
  return {
    title: tab.title, total_rows: nonEmpty.length, valid_rows: nonEmpty.filter(importable).length,
    invalid_rows: nonEmpty.length - nonEmpty.filter(importable).length - repeats, repeat_rows: repeats,
    imported_before: Number(prior ?? 0), rows,
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

const choice = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);
const version = (v: unknown): number | null => (Number.isInteger(v) ? Number(v) : null);

/**
 * Structural recovery / identity change: classify the current rows under the NEW config (established by Lead ID /
 * content-matched / unmatched), then apply ONLY the reviewed snapshot with the agent's explicit choices. The
 * generation of the refresh token actually used for the read is re-validated in the apply transaction.
 */
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
    p_user: c.userId, p_org: c.orgId, p_source: src.id, p_expected_version: version(body.expected_version),
    p_generation: a.generation, p_identity_mode: mode, p_id_header: idHeader, p_mapping: mapping, p_rows: rows,
    p_import_matched: choice(body.import_matched), p_import_unknown: choice(body.import_unknown),
    p_snapshot: dryRun ? null : str(body.snapshot, 64) || null, p_dry_run: dryRun });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0];
}

/** One fresh read + the owner's ledger → identity review classification (no writes). */
async function identityClassify(c: Ctx, src: Record<string, any>) {
  if (src.identity_mode !== "source_id" || !src.id_header) throw new ActionError(409, "invalid_state");
  const a = await access(c);
  const { planned } = await readPlanned(c, a.token, src.spreadsheet_id, Number(src.sheet_id), mappingOrThrow(src.mapping), src.id_header);
  const state = await db(c).reviewState(c.userId, c.orgId, src.id);
  const cls = identityReview(planned, state.rows ?? [], new Set(state.receipt_ids ?? []));
  const review = { decide: cls.decide.map((d) => ({ k: d.k, n: d.n, f: d.f, s: d.s, hint: d.hint })), retire: cls.retire, kept: cls.kept };
  return { a, planned, cls, review };
}

async function resolveIdentity(c: Ctx, src: Record<string, any>, generation: number, review: unknown, snapshot: string | null,
  decisions: Record<string, string> | null, dryRun: boolean) {
  const { data, error } = await c.svc.rpc("google_sheets_resolve_identity", {
    p_user: c.userId, p_org: c.orgId, p_source: src.id, p_expected_version: src.config_version, p_generation: generation,
    p_review: review, p_snapshot: snapshot, p_decisions: decisions, p_dry_run: dryRun });
  if (error) throw new DbError(error.message, error.code);
  return (data ?? [])[0] as { snapshot: string; config_version: number; decided: number };
}

/** Identity review preview: every row that could be an unaccounted excluded row, each needing a decision. */
export async function identityReviewPreview(c: Ctx, body: Record<string, unknown>) {
  const src = await ownSource(c, str(body.source_id, 64));
  if (version(body.expected_version) !== src.config_version) throw new ActionError(409, "version_conflict");
  const { a, planned, cls, review } = await identityClassify(c, src);
  const r = await resolveIdentity(c, src, a.generation, review, null, null, true);
  const byN = new Map(planned.map((p) => [p.n, p]));
  return {
    snapshot: r.snapshot, config_version: r.config_version, unresolved_rows: cls.unresolvedRows,
    established: cls.established, approved: cls.approved, kept: cls.keptRows,
    rows: cls.decide.map((d) => ({
      key: d.k, row: d.n, lead_id: d.id, hint: d.hint, valid: d.valid, reason: d.reason, rows: d.rows,
      ...(byN.get(d.n)?.display ?? { first_name: "", last_name: "", phone: "", email: "" }),
    })),
  };
}

/** Identity review apply: the fresh classification must equal the previewed snapshot, then decisions commit atomically. */
export async function identityReviewApply(c: Ctx, body: Record<string, unknown>) {
  const src = await ownSource(c, str(body.source_id, 64));
  if (version(body.expected_version) !== src.config_version) throw new ActionError(409, "version_conflict");
  const raw = body.decisions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ActionError(422, "invalid_argument");
  const decisions: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length > 300 || (v !== "import" && v !== "exclude")) throw new ActionError(422, "invalid_argument");
    decisions[k] = v;
  }
  const { a, review } = await identityClassify(c, src);
  const r = await resolveIdentity(c, src, a.generation, review, str(body.snapshot, 64) || null, decisions, false);
  return { config_version: r.config_version, decided: r.decided };
}

export async function disconnect(c: Ctx) {
  const { error } = await c.svc.rpc("google_sheets_disconnect", { p_user: c.userId, p_org: c.orgId });
  if (error) throw new DbError(error.message, error.code);
  return { ok: true };
}
