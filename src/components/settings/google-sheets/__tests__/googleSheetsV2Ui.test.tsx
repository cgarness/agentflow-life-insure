import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { installComboboxDomStubs } from "@/test/carrierComboboxTestUtils";

const auth = { user: { id: "u1" }, realProfile: { id: "u1", organization_id: "o1", role: "Agent", is_super_admin: false }, isImpersonating: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(), rpc: (...a: unknown[]) => rpc(...a) } }));
const createField = vi.fn();
vi.mock("@/lib/supabase-settings", () => ({ customFieldsSupabaseApi: { create: (...a: unknown[]) => createField(...a) } }));
const sheetsApi = vi.fn();
vi.mock("@/lib/google-sheets/api", async (orig) => {
  const real = await orig<typeof import("@/lib/google-sheets/api")>();
  return { ...real, sheetsApi: (...a: unknown[]) => sheetsApi(...a), startGoogleConnect: vi.fn() };
});
const pickSpreadsheet = vi.fn();
vi.mock("@/lib/google-sheets/picker", async (orig) => {
  const real = await orig<typeof import("@/lib/google-sheets/picker")>();
  return { ...real, pickSpreadsheet: (t: string, s?: AbortSignal) => pickSpreadsheet(t, s), preparePicker: async () => undefined, pickerConfigured: () => true };
});

const ZIP = "00000000-0000-4000-8000-000000000003", CITY = "00000000-0000-4000-8000-000000000002", AMT = "00000000-0000-4000-8000-000000000004";
const catalog = (v2: boolean, extra: Record<string, unknown>[] = []) => ({
  duplicate_action: "flag", default_status: "New", lead_sources: [], has_lead_created_workflows: false,
  ...(v2 ? { catalog_version: 2, mapping_versions: [1, 2] } : {}),
  custom_fields: [
    { id: CITY, name: "City", created_by: null, created_at: null, type: "Text", scope: "agency", own: false },
    { id: ZIP, name: "ZIP Code", created_by: null, created_at: null, type: "Text", scope: "agency", own: false },
    { id: AMT, name: "Amt Requested", created_by: "u1", created_at: null, type: "Number", scope: "personal", own: true }, ...extra],
});
type Ctx = ReturnType<typeof catalog>;
const ctxQuery = { data: catalog(true) as Ctx | undefined, isFetchedAfterMount: true, isSuccess: true, isError: false,
  refetch: vi.fn(async () => ({ data: ctxQuery.data })) };
const sources: { data: unknown[] } = { data: [] };
vi.mock("@/hooks/useGoogleSheets", () => ({
  useGoogleSheets: () => ({
    ready: true, identityKey: "o1:u1", refresh: vi.fn(),
    status: { isLoading: false, isError: false, data: { enabled: true, eligible: true,
      connection: { status: "connected", google_email: "a@b.test", connected_at: null, last_error_code: null } } },
    sources: { isLoading: false, isError: false, data: sources.data }, context: ctxQuery,
  }),
}));

import GoogleSheetsSettings from "../GoogleSheetsSettings";
import AddSheetDialogV2 from "../AddSheetDialogV2";
import SheetReviewDialog from "../SheetReviewDialog";
import type { SheetSourceRow } from "@/lib/google-sheets/schema";

const HEADER = ["First Name", "Last Name", "Phone", "Mailing Address", "City", "Zip", "Amt Requested", "Notes"];
const SAMPLE = [["Ann", "Lee", "5550001111", "1 Main", "Austin", "02134", "$1,234.50", "x"]];
const headersResult = (header = HEADER) => ({ title: "Leads", spreadsheet_name: "FB", header, row_count: 1, overflow: false, sample: SAMPLE,
  locale: "en_US", column_count: header.length, over_limit: { count: 0, headers: [] },
  columns: header.map((h, i) => ({ index: i, letter: String.fromCharCode(65 + i), header: h, blank: !h, duplicate: false, has_data: true })) });
const previewResult = { title: "Leads", total_rows: 1, valid_rows: 1, invalid_rows: 0, imported_before: 0, duplicate_action: "flag", has_lead_created_workflows: false,
  mapping_version: 2, locale: "en_US", ignored: ["Mailing Address"], unaccounted_headers: [],
  rows: [{ row: 2, first_name: "Ann", last_name: "Lee", phone: "5550001111", email: "", outcome: "import", reason: null,
    fields: [{ target: "lead_source", value: "Google Sheets" }, { target: `custom:${CITY}`, value: "Austin" }, { target: `custom:${ZIP}`, value: "02134" },
      { target: `custom:${AMT}`, value: "1234.50" }] }] };
const api = (over: Record<string, (b: Record<string, unknown>) => unknown> = {}) => sheetsApi.mockImplementation(async (action: string, body: Record<string, unknown>) => {
  if (over[action]) return over[action](body);
  if (action === "picker_token") return { access_token: "ya29.T" };
  if (action === "inspect") return { name: "FB", tabs: [{ sheetId: 0, title: "Leads", configured: false }] };
  if (action === "headers") return headersResult();
  if (action === "preview") return previewResult;
  if (action === "save") return { source_id: "s9", config_version: 1 };
  if (action === "activate") return { outcome: "activated" };
  throw new Error("unexpected " + action);
});
const calls = (a: string) => sheetsApi.mock.calls.filter((c) => c[0] === a).map((c) => c[1] as Record<string, any>);
const v2Source = (state: "draft" | "enabled", mapping: SheetSourceRow["mapping"]): SheetSourceRow => ({
  id: "s1", organization_id: "o1", user_id: "u1", spreadsheet_id: "SHEET_ABCDEFGHIJ", sheet_id: 0, spreadsheet_name: "FB", sheet_title: "Leads",
  display_name: "FB – Leads", mapping, identity_mode: "row_position", id_header: null, lead_source_default: "Google Sheets", include_existing: false,
  config_version: 4, state, health: "ok", review_reason: null, phase: "steady", lease_owner: null, last_checked_at: null, last_success_at: null,
  last_result: null, last_error_code: null, created_at: "" });
const viewer = (admin = false) => ({ id: "u1", canManageAgency: admin, isImpersonating: false, organizationId: "o1" });
const renderDialog = (source: SheetSourceRow | null, admin = false, extra: Partial<React.ComponentProps<typeof AddSheetDialogV2>> = {}) =>
  render(<AddSheetDialogV2 source={source} context={ctxQuery as never} viewer={viewer(admin)} onClose={vi.fn()} onSaved={vi.fn()} onNeedsReview={vi.fn()} {...extra} />);
async function pickTab() {
  pickSpreadsheet.mockResolvedValue({ id: "SHEET_ABCDEFGHIJ", name: "FB" });
  fireEvent.click(screen.getByRole("button", { name: /choose spreadsheet/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Leads" }));
  await screen.findByLabelText("Field for Phone");
}

beforeEach(() => {
  installComboboxDomStubs();
  sheetsApi.mockReset(); rpc.mockReset(); createField.mockReset(); pickSpreadsheet.mockReset();
  ctxQuery.refetch.mockReset().mockImplementation(async () => ({ data: ctxQuery.data }));
  Object.assign(ctxQuery, { data: catalog(true), isFetchedAfterMount: true, isSuccess: true, isError: false });
  Object.assign(auth.realProfile, { role: "Agent", is_super_admin: false }); sources.data = [];
  vi.stubEnv("VITE_GOOGLE_SHEETS_ENABLED", "true");
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("mapping v2 gate", () => {
  it("flag off: Add sheet opens the unchanged legacy editor and never re-reads the catalog", async () => {
    api();
    render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /add sheet/i }));
    await pickTab();
    expect(ctxQuery.refetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/won't be imported|Every column is imported/)).not.toBeInTheDocument();   // v2-only summary
    expect(screen.getByLabelText("Field for Phone").tagName).toBe("BUTTON");
  });

  it("flag on but the server has no mapping v2: the legacy editor runs after the catalog check", async () => {
    vi.stubEnv("VITE_GOOGLE_SHEETS_MAPPING_V2", "true");
    ctxQuery.data = catalog(false);
    api();
    render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /add sheet/i }));
    expect(ctxQuery.refetch).toHaveBeenCalledTimes(1);
    await pickTab();
    expect(screen.queryByText(/won't be imported|Every column is imported/)).not.toBeInTheDocument();
  });

  it("a v2 mapping is never opened by the legacy editor (flag off → notice)", async () => {
    sources.data = [v2Source("draft", { v: 2, columns: [{ header: "Phone", target: "phone" }], ignored: ["Notes"] })];
    api();
    render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /finish setup/i }));
    expect(await screen.findByText(/updated column mapping, which is temporarily unavailable/i)).toBeInTheDocument();
    expect(calls("headers")).toHaveLength(0);
  });
});

describe("mapping v2 editor", () => {
  it("never shows a partial field list: loading, then a blocking error with Retry", async () => {
    Object.assign(ctxQuery, { isFetchedAfterMount: false });
    api();
    const view = renderDialog(v2Source("enabled", { v: 1, columns: [{ header: "Phone", target: "phone" }] }));
    expect(screen.getByText(/Loading your fields/)).toBeInTheDocument();
    Object.assign(ctxQuery, { isFetchedAfterMount: true, isError: true, isSuccess: false, data: undefined });
    view.rerender(<AddSheetDialogV2 source={v2Source("enabled", { v: 1, columns: [{ header: "Phone", target: "phone" }] })} context={ctxQuery as never}
      viewer={viewer()} onClose={vi.fn()} onSaved={vi.fn()} onNeedsReview={vi.fn()} />);
    expect(screen.getByText(/Couldn't load your fields/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Field for Phone")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(ctxQuery.refetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  it("editing re-reads the sheet; a failed read offers Retry and never shows the saved mapping as the sheet", async () => {
    let fail = true;
    api({ headers: () => { if (fail) throw new Error("google down"); return headersResult(); } });
    renderDialog(v2Source("enabled", { v: 1, columns: [{ header: "Phone", target: "phone" }, { header: "First Name", target: "first_name" },
      { header: "Last Name", target: "last_name" }] }));
    expect(await screen.findByText(/Couldn't read the sheet's columns\. Your saved mapping is unchanged/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Field for Phone")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Field for Mailing Address")).toBeInTheDocument();   // a column the saved mapping never had
    expect(screen.getAllByText("New").length).toBeGreaterThan(0);
  });

  it("new sheet: auto-maps address columns, previews stored values, needs the acknowledgement, then saves v2", async () => {
    api();
    const onSaved = vi.fn();
    renderDialog(null, false, { onSaved });
    await pickTab();
    expect(screen.getByLabelText("Field for City")).toHaveTextContent("City");
    expect(screen.getByLabelText("Field for Zip")).toHaveTextContent("ZIP Code");
    expect(screen.getByLabelText("Field for Amt Requested")).toHaveTextContent("Amt Requested");
    expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("Don't import");   // no Address field in this agency
    expect(screen.getByLabelText("Field for Notes")).toHaveTextContent("Notes");
    expect(screen.getByText(/1 column won't be imported/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("1234.50")).toBeInTheDocument();
    expect(screen.getByText("02134")).toBeInTheDocument();
    const enable = screen.getByRole("button", { name: "Enable" });
    expect(enable).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/this column won't be imported/i));
    fireEvent.click(enable);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls("preview")[0].mapping).toMatchObject({ v: 2, ignored: ["Mailing Address"] });
    expect(calls("save")[0].payload.mapping).toEqual({ v: 2, ignored: ["Mailing Address"], columns: expect.arrayContaining([
      { header: "Notes", target: "notes" },
      { header: "City", target: `custom:${CITY}` }, { header: "Zip", target: `custom:${ZIP}` }, { header: "Phone", target: "phone" }]) });
    expect(calls("activate")[0]).toEqual({ source_id: "s9", expected_version: 1 });
  });

  it("the picker searches; choosing a field another column uses asks before moving it", async () => {
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    fireEvent.change(await screen.findByPlaceholderText("Search fields…"), { target: { value: "zip" } });
    const zipOption = await screen.findByRole("option", { name: /ZIP Code/ });
    expect(zipOption).toHaveTextContent(/Used by “Zip”/);
    fireEvent.click(zipOption);
    expect(await screen.findByText(/is mapped to “Zip”\. Move it to this column\?/)).toBeInTheDocument();
    expect(screen.getByLabelText("Field for Zip")).toHaveTextContent("ZIP Code");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("ZIP Code");
    expect(screen.getByLabelText("Field for Zip")).toHaveTextContent("Don't import");
  });

  it("inline creation: an Agent asking for a standard field is told to ask an Admin (nothing created)", async () => {
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    fireEvent.click(await screen.findByRole("option", { name: /Address add standard field/ }));
    const form = screen.getByRole("group", { name: "Create custom field" });
    expect(within(form).getByLabelText("Field name")).toHaveValue("Address");
    fireEvent.click(within(form).getByRole("button", { name: "Add standard field" }));
    expect(await screen.findByText(/Address is a standard field your agency shares\. Ask an Admin/)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(createField).not.toHaveBeenCalled();
  });

  it("inline creation: an Admin adds the standard field for the agency and the column maps to it", async () => {
    api();
    rpc.mockResolvedValue({ data: { status: "complete", fields: [], last_attempt: null }, error: null });
    renderDialog(null, true);
    await pickTab();
    ctxQuery.refetch.mockImplementation(async () => {   // the server now has the agency-wide Address field
      ctxQuery.data = catalog(true, [{ id: "00000000-0000-4000-8000-000000000001", name: "Address", created_by: null, created_at: null, type: "Text", scope: "agency", own: false }]);
      return { data: ctxQuery.data };
    });
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    fireEvent.click(await screen.findByRole("option", { name: /Address add standard field/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add standard field" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("provision_standard_lead_fields", { p_dry_run: false }));
    await waitFor(() => expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("Address"));
  });

  it("inline creation: a personal field uses the shared rules and maps the new id", async () => {
    api();
    createField.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000aa", name: "Notes Extra" });
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Notes"));
    fireEvent.click(await screen.findByRole("option", { name: /Create custom field/ }));
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "Notes Extra" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => expect(createField).toHaveBeenCalledWith(expect.objectContaining({ name: "Notes Extra", type: "Text", appliesTo: ["Leads"] }), "o1", { orgWide: false }));
  });
});

describe("review keeps the stored mapping version", () => {
  it("v2 stays v2 (with its ignored list); v1 payloads are unchanged", async () => {
    sheetsApi.mockResolvedValue({ established: 0, matched: 0, unknown: 0, config_version: 4, snapshot: "x" });
    const v2 = v2Source("enabled", { v: 2, columns: [{ header: "Phone", target: "phone" }], ignored: ["Notes"] });
    render(<SheetReviewDialog source={v2} onClose={vi.fn()} onDone={vi.fn()} />);
    await waitFor(() => expect(calls("review_preview")).toHaveLength(1));
    expect(calls("review_preview")[0].mapping).toEqual({ v: 2, columns: [{ header: "Phone", target: "phone" }], ignored: ["Notes"] });
    cleanup(); sheetsApi.mockClear();
    render(<SheetReviewDialog source={v2Source("enabled", { v: 1, columns: [{ header: "Phone", target: "phone" }] })} onClose={vi.fn()} onDone={vi.fn()} />);
    await waitFor(() => expect(calls("review_preview")).toHaveLength(1));
    expect(calls("review_preview")[0].mapping).toEqual({ v: 1, columns: [{ header: "Phone", target: "phone" }] });
    await act(async () => undefined);
  });
});
