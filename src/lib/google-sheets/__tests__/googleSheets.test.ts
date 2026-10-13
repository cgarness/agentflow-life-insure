import { describe, expect, it } from "vitest";
import { autoMap, customFieldOptions } from "../autoMap";
import { sourceDraftSchema, toPayload } from "../schema";
import { resultSummary, sourceStatus, isBusy } from "../status";
import type { SheetSourceRow } from "../schema";
import { splitFullName as sheetsSplit, parseDOB as sheetsParseDOB, normalizeFieldName as sheetsNorm } from "../../../../supabase/functions/_shared/googleSheets/mapping";
import { parseDOB } from "@/utils/dobUtils";
import { normalizeFieldName } from "@/lib/import-field-matching";
import { CONTACTS_PERMISSIONS } from "@/config/permissionDefaults";
import migrationSql from "../../../../supabase/migrations/20261013120000_google_sheets_import_foundation.sql?raw";

const src = (o: Partial<SheetSourceRow>): SheetSourceRow => ({
  id: "s", organization_id: "o", user_id: "u", spreadsheet_id: "x", sheet_id: 0, spreadsheet_name: "", sheet_title: "", display_name: "d",
  mapping: { v: 1, columns: [] }, identity_mode: "row_position", id_header: null, lead_source_default: "Google Sheets", include_existing: false,
  config_version: 1, state: "enabled", health: "ok", review_reason: null, phase: "steady", lease_owner: null, last_checked_at: null,
  last_success_at: null, last_result: null, last_error_code: null, created_at: "", ...o,
});

describe("Google Sheets auto-mapping (CSV detection rules)", () => {
  it("maps standard headers, detects a Lead ID column, never maps a field twice", () => {
    const r = autoMap(["Lead ID", "First Name", "Last Name", "Phone Number", "Cell", "E-mail", "Gender"], [
      { id: "11111111-1111-1111-1111-111111111111", name: "gender", created_by: null, created_at: null }]);
    expect(r.idHeader).toBe("Lead ID");
    expect(r.columns).toEqual([
      { header: "First Name", target: "first_name" }, { header: "Last Name", target: "last_name" },
      { header: "Phone Number", target: "phone" }, { header: "E-mail", target: "email" },
      { header: "Gender", target: "custom:11111111-1111-1111-1111-111111111111" },
    ]);
  });
  it("custom fields shadowing a built-in are not offered", () => {
    expect(customFieldOptions([{ id: "22222222-2222-2222-2222-222222222222", name: "Phone", created_by: null, created_at: null }])).toEqual([]);
  });
});

describe("mapping form schema (Zod)", () => {
  const base = { displayName: "Leads", leadSourceDefault: "Google Sheets", idHeader: null, includeExisting: false };
  it("requires phone and a name", () => {
    expect(sourceDraftSchema.safeParse({ ...base, columns: [{ header: "Name", target: "full_name" }] }).success).toBe(false);
    expect(sourceDraftSchema.safeParse({ ...base, columns: [{ header: "P", target: "phone" }, { header: "F", target: "first_name" }] }).success).toBe(false);
    expect(sourceDraftSchema.safeParse({ ...base, columns: [{ header: "P", target: "phone" }, { header: "N", target: "full_name" }] }).success).toBe(true);
  });
  it("rejects a field mapped twice and an ID column reused as a field", () => {
    expect(sourceDraftSchema.safeParse({ ...base, columns: [{ header: "P", target: "phone" }, { header: "Q", target: "phone" }, { header: "N", target: "full_name" }] }).success).toBe(false);
    expect(sourceDraftSchema.safeParse({ ...base, idHeader: "P", columns: [{ header: "P", target: "phone" }, { header: "N", target: "full_name" }] }).success).toBe(false);
  });
  it("new rows only is the default payload; ID column switches identity mode", () => {
    const p = toPayload({ ...base, idHeader: "Lead ID", columns: [{ header: "P", target: "phone" }, { header: "N", target: "full_name" }] },
      { spreadsheetId: "abc", sheetId: 5, spreadsheetName: "S", sheetTitle: "T" });
    expect(p.include_existing).toBe(false);
    expect(p.identity_mode).toBe("source_id");
  });
});

describe("status and results", () => {
  it("flagged rows are part of imported, not a separate total", () => {
    expect(resultSummary({ imported: 12, flagged: 2, skipped: 3, errors: 1 })).toBe("12 imported (2 flagged) · 3 skipped · 1 error");
    expect(resultSummary(null)).toBe("No checks yet");
  });
  it("reconnect comes from the connection; draft/paused/needs review are preserved", () => {
    expect(sourceStatus(src({ state: "paused" }), null).label).toBe("Paused");
    expect(sourceStatus(src({}), { status: "reconnect_required", google_email: null, connected_at: null, last_error_code: null }).label).toBe("Reconnect");
    const conn = { status: "connected" as const, google_email: null, connected_at: null, last_error_code: null };
    expect(sourceStatus(src({ health: "needs_review" }), conn).label).toBe("Needs review");
    expect(sourceStatus(src({ phase: "initial" }), conn).label).toBe("Importing");
    expect(sourceStatus(src({}), conn).label).toBe("Active");
    expect(isBusy([src({ phase: "initial" })])).toBe(true);
    expect(isBusy([src({ state: "paused", phase: "initial" })])).toBe(false);
  });
});

describe("server parity (Edge mapping port ↔ app modules)", () => {
  it("parseDOB and field-name normalisation match the app", () => {
    for (const v of ["1970-3-4", "03/04/70", "3.4.1970", "25569", "2/30/1980", "abc", "", "1899-12-31", "12/31/2100"]) {
      expect(sheetsParseDOB(v)).toBe(parseDOB(v));
    }
    for (const v of ["  Date  of Birth ", "E-MAIL", "Lead\tSource"]) expect(sheetsNorm(v)).toBe(normalizeFieldName(v));
    expect(sheetsSplit("Mary Ann  Smith")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(sheetsSplit("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });
  it("SQL permission defaults equal the app catalog for every contacts key", () => {
    const block = migrationSql.split("CREATE OR REPLACE FUNCTION public._contacts_permission_default")[1].split("$function$;")[0];
    const rows = [...block.matchAll(/\('([a-z_.]+)',\s*(true|false),\s*(true|false)\)/g)].map((m) => [m[1], m[2] === "true", m[3] === "true"]);
    expect(rows.length).toBe(CONTACTS_PERMISSIONS.length);
    for (const def of CONTACTS_PERMISSIONS) {
      expect(rows.find((r) => r[0] === def.key)).toEqual([def.key, def.agent, def.teamLeader]);
    }
  });
});
