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
  locale: "en_US", column_count: header.length, beyond_limit: { width: header.length, checked_through: header.length, columns: [], unchecked: false },
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
const SheetsApiErrorRef: { current: (new (code: string) => Error) | null } = { current: null };
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

  it("shows compact source headers without column letters or sample captions, preserving tooltip and picker targets", async () => {
    api(); renderDialog(null); await pickTab();
    const first = screen.getByTitle("First Name");
    expect(first).toHaveTextContent(/^First Name$/);
    expect(first).toHaveClass("truncate");
    expect(first.parentElement).toHaveClass("min-h-9");
    expect(screen.getByTitle("Amt Requested")).toHaveTextContent(/^Amt Requested$/);
    expect(screen.queryByText(/^e\.g\./i)).not.toBeInTheDocument();
    expect(screen.queryByText("Ann", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Field for First Name")).toHaveTextContent("First Name");
    expect(screen.getByLabelText("Field for Amt Requested")).toHaveTextContent("Amt Requested");
    expect(screen.getByText(/1 column won't be imported/)).toBeInTheDocument();
  });

  it("keeps the full long header tooltip, single-line truncation and New indicator for newly discovered columns", async () => {
    api({ headers: () => headersResult(["First Name", "Last Name", "Phone", "History of Heart Attack Stroke Cancer"]) });
    renderDialog(v2Source("enabled", { v: 1, columns: [
      { header: "First Name", target: "first_name" }, { header: "Last Name", target: "last_name" },
      { header: "Phone", target: "phone" },
    ] }));
    const longHeader = await screen.findByTitle("History of Heart Attack Stroke Cancer");
    expect(longHeader).toHaveClass("truncate");
    expect(longHeader).toHaveTextContent(/^History of Heart Attack Stroke Cancer$/);
    expect(longHeader.parentElement).toHaveTextContent("New");
    expect(screen.getByLabelText("Field for History of Heart Attack Stroke Cancer")).toHaveTextContent("Don't import");
    expect(screen.queryByText(/^e\.g\./i)).not.toBeInTheDocument();
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
    expect(zipOption).toHaveTextContent("In use");
    expect(zipOption).toHaveAttribute("title", "Mapped to “Zip”");
    fireEvent.click(zipOption);
    expect(await screen.findByText(/is mapped to “Zip”\. Move it to this column\?/)).toBeInTheDocument();
    expect(screen.getByLabelText("Field for Zip")).toHaveTextContent("ZIP Code");
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("ZIP Code");
    expect(screen.getByLabelText("Field for Zip")).toHaveTextContent("Don't import");
  });

  it("shows a flat A–Z list with missing standard fields mixed in, without category headings", async () => {
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    const items = screen.getAllByRole("option");
    expect(items[0]).toHaveTextContent("Don't import");
    expect(items[items.length - 1]).toHaveTextContent("Create custom field");
    const names = items.slice(1, -1).map((item) => item.querySelector("span.truncate")?.textContent?.trim() ?? "");
    expect(names).not.toContain("");
    const collator = new Intl.Collator("en", { sensitivity: "base" });
    expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
    expect(names).toContain("Address"); // Missing standard field, interleaved alphabetically
    expect(names).toContain("Amt Requested");
    expect(screen.getByRole("option", { name: /Add Address standard field/ })).toBeInTheDocument();
    for (const heading of ["Required", "Contact", "Details", "Agency fields", "My fields", "Unavailable"]) {
      expect(screen.queryByText(heading, { exact: true })).not.toBeInTheDocument();
    }
  });

  it("keeps disabled fields visible, with a compact status and accessible full reason", async () => {
    ctxQuery.data = catalog(true, [{ id: "00000000-0000-4000-8000-000000000099", name: "Tags",
      created_by: "u1", created_at: null, type: "Text", scope: "personal", own: true }]);
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    const reserved = screen.getByRole("option", { name: /Tags/ });
    expect(reserved).toHaveAttribute("aria-disabled", "true");
    expect(reserved).toHaveAttribute("title", "Reserved by AgentFlow");
    expect(reserved).toHaveTextContent("Unavailable");
    fireEvent.click(reserved);
    expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("Don't import");
  });

  it("supports searching and selecting an available field with the keyboard", async () => {
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    const search = await screen.findByPlaceholderText("Search fields…");
    fireEvent.change(search, { target: { value: "Age" } });
    fireEvent.focus(search);
    fireEvent.keyDown(search, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Field for Mailing Address")).toHaveTextContent("Age"));
  });

  it("inline creation: an Agent asking for a standard field is told to ask an Admin (nothing created)", async () => {
    api();
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByLabelText("Field for Mailing Address"));
    fireEvent.click(await screen.findByRole("option", { name: /Add Address standard field/ }));
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
    fireEvent.click(await screen.findByRole("option", { name: /Add Address standard field/ }));
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
    expect("not_importable_ack" in calls("review_preview")[0]).toBe(false);
    await act(async () => undefined);
  });

  it("an owner-edited v2 mapping carries the acknowledgement token to the review preview and apply", async () => {
    sheetsApi.mockResolvedValue({ established: 0, matched: 0, unknown: 0, config_version: 4, snapshot: "x" });
    const v2 = v2Source("enabled", { v: 2, columns: [{ header: "Phone", target: "phone" }], ignored: ["Notes"] });
    render(<SheetReviewDialog source={v2} override={{ identityMode: "source_id", idHeader: "Notes", columns: [{ header: "Phone", target: "phone" }],
      ignored: [], notImportableAck: "d".repeat(64) }} onClose={vi.fn()} onDone={vi.fn()} />);
    await waitFor(() => expect(calls("review_preview")).toHaveLength(1));
    expect(calls("review_preview")[0]).toMatchObject({ not_importable_ack: "d".repeat(64), mapping: { v: 2, ignored: [] } });
    fireEvent.click(await screen.findByRole("button", { name: /resume/i }));
    await waitFor(() => expect(calls("review_apply")).toHaveLength(1));
    expect(calls("review_apply")[0].not_importable_ack).toBe("d".repeat(64));
  });
});

// ---------------------------------------------------------------- correction C: preview gate, header drift, columns past GR
const SIG = "c".repeat(64);
const NI = (o: Record<string, unknown> = {}) => ({ headerless: [], repeated: [], signature: null,
  beyond: { width: 8, checked_through: 8, headers: [], headerless: [], unchecked: false }, ...o });
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const enableBtn = () => screen.getByRole("button", { name: "Enable" });
const ack = () => fireEvent.click(screen.getByLabelText(/won't be imported into AgentFlow/i));
const ALL_MAPPED = { v: 2 as const, ignored: ["Mailing Address"], columns: [{ header: "First Name", target: "first_name" }, { header: "Last Name", target: "last_name" },
  { header: "Phone", target: "phone" }, { header: "City", target: `custom:${CITY}` }, { header: "Zip", target: `custom:${ZIP}` },
  { header: "Amt Requested", target: `custom:${AMT}` }, { header: "Notes", target: "notes" }] };

describe("preview gate: Save / Enable only on a successful preview of exactly this draft", () => {
  it("disabled while the preview loads and after it fails; Retry recovers; nothing is saved meanwhile", async () => {
    const first = deferred<unknown>();
    let n = 0;
    api({ preview: () => (++n === 1 ? first.promise : previewResult) });
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Checking the sheet…", { selector: "[aria-busy] p" }, { timeout: 3000 })).toBeInTheDocument();
    expect(calls("preview")).toHaveLength(1);
    expect(enableBtn()).toBeDisabled();
    first.reject(new (await import("@/lib/google-sheets/api")).SheetsApiError("google_error"));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(enableBtn()).toBeDisabled();
    expect(screen.getByText("The preview didn't load. Retry it before saving.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("1234.50")).toBeInTheDocument();
    expect(enableBtn()).toBeDisabled();   // the acknowledgement is still required
    ack();
    expect(enableBtn()).toBeEnabled();
    expect(calls("save")).toHaveLength(0);
  });

  it("an out-of-order response for an earlier draft is ignored", async () => {
    const slow = deferred<unknown>();
    api({ preview: (b) => ((b.mapping as { ignored: string[] }).ignored.includes("Notes") ? Promise.resolve({ ...previewResult,
      ignored: ["Mailing Address", "Notes"], rows: [{ ...previewResult.rows[0], fields: [{ target: `custom:${CITY}`, value: "NEW-DRAFT" }] }] }) : slow.promise) });
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));          // request 1 (Notes imported) hangs
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByLabelText("Field for Notes"));
    fireEvent.click(await screen.findByRole("option", { name: /Don't import/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));          // request 2 (Notes ignored) answers first
    expect(await screen.findByText("NEW-DRAFT")).toBeInTheDocument();
    await act(async () => { slow.resolve({ ...previewResult, rows: [{ ...previewResult.rows[0], fields: [{ target: `custom:${CITY}`, value: "OLD-DRAFT" }] }] }); });
    expect(screen.queryByText("OLD-DRAFT")).not.toBeInTheDocument();
    expect(screen.getByText("NEW-DRAFT")).toBeInTheDocument();
    ack();
    fireEvent.click(enableBtn());
    await waitFor(() => expect(calls("save")).toHaveLength(1));
    expect(calls("save")[0].payload.mapping.ignored).toEqual(["Mailing Address", "Notes"]);
  });

  it("columns added after mapping block saving; Review columns re-reads the sheet and lists them as not imported", async () => {
    let added = false;
    api({
      headers: () => headersResult(added ? [...HEADER, "Added Later"] : HEADER),
      preview: (b) => ({ ...previewResult, ignored: (b.mapping as { ignored: string[] }).ignored,
        unaccounted_headers: added && !(b.mapping as { ignored: string[] }).ignored.includes("Added Later") ? ["Added Later"] : [] }),
    });
    renderDialog(null);
    await pickTab();
    added = true;                                                                // someone edits the sheet now
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/columns changed since you mapped it: new columns Added Later/)).toBeInTheDocument();
    ack();
    expect(enableBtn()).toBeDisabled();
    expect(screen.getByText("The sheet's columns changed. Review them before saving.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review columns" }));
    expect(await screen.findByLabelText("Field for Added Later")).toHaveTextContent("Don't import");
    expect(calls("headers")).toHaveLength(2);                                    // the picker's read, then this re-read
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("1234.50")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Columns not imported")).getByText("Added Later").parentElement).toHaveTextContent("New");
    expect(enableBtn()).toBeDisabled();                                          // the changed list needs a fresh confirmation
    ack();
    fireEvent.click(enableBtn());
    await waitFor(() => expect(calls("save")).toHaveLength(1));
    expect(calls("save")[0].payload.mapping.ignored).toEqual(["Mailing Address", "Added Later"]);
  });

  it("a save the server refuses (the sheet changed) shows the reason, refreshes the preview and keeps the draft", async () => {
    let refused = false;
    api({
      save: () => { refused = true; throw new (SheetsApiErrorRef.current!)("unacknowledged_columns"); },
      preview: () => ({ ...previewResult, unaccounted_headers: refused ? ["Added Later"] : [] }),
    });
    SheetsApiErrorRef.current = (await import("@/lib/google-sheets/api")).SheetsApiError;
    renderDialog(null);
    await pickTab();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("1234.50");
    ack();
    fireEvent.click(enableBtn());
    expect(await screen.findByText("The sheet's columns changed since the preview. Review them, then save again.")).toBeInTheDocument();
    await waitFor(() => expect(calls("preview")).toHaveLength(2));
    expect(await screen.findByRole("button", { name: "Review columns" })).toBeInTheDocument();
    expect(enableBtn()).toBeDisabled();
    expect(calls("activate")).toHaveLength(0);
  });

  it("an active source: Save waits for the preview; the acknowledgement token goes with the save and with a Lead ID review", async () => {
    const gate = deferred<unknown>();
    api({ preview: () => gate.promise });
    const onSaved = vi.fn(), onNeedsReview = vi.fn();
    renderDialog(v2Source("enabled", ALL_MAPPED), false, { onSaved, onNeedsReview });
    await screen.findByLabelText("Field for Phone");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await act(async () => { gate.resolve({ ...previewResult, not_importable: NI({ repeated: ["Notes"], signature: SIG }) }); });
    expect(await screen.findByText(/Repeated headers \(only unique headers can be imported\): Notes\./)).toBeInTheDocument();
    expect(save).toBeDisabled();
    ack();
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls("save")[0]).toMatchObject({ source_id: "s1", expected_version: 4, not_importable_ack: SIG });
    expect(calls("save")[0].payload.mapping).toEqual(ALL_MAPPED);
    // the Lead ID column changes → identity review, carrying the same acknowledgement
    cleanup(); sheetsApi.mockReset();
    api({ preview: () => ({ ...previewResult, ignored: ["Mailing Address"], not_importable: NI({ repeated: ["Notes"], signature: SIG }) }) });
    renderDialog(v2Source("enabled", ALL_MAPPED), false, { onNeedsReview });
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Lead ID column" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Mailing Address" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("1234.50");
    ack();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onNeedsReview).toHaveBeenCalled());
    expect(onNeedsReview.mock.calls[0][1]).toMatchObject({ identityMode: "source_id", idHeader: "Mailing Address", notImportableAck: SIG });
    expect(calls("save")).toHaveLength(0);
  });
});

describe("columns past GR (the 200-column limit)", () => {
  const wide = (width: number, columns: { letter: string; header: string; has_data: boolean }[], unchecked = false) =>
    ({ ...headersResult(), column_count: width, beyond_limit: { width, checked_through: Math.min(width, 400), columns, unchecked } });

  it("200 columns: no width warning; nothing outside means no extra confirmation", async () => {
    api({ headers: () => wide(200, []) });
    renderDialog(null);
    await pickTab();
    expect(screen.queryByText(/columns wide/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("1234.50");
    expect(screen.queryByText("Can't be imported")).not.toBeInTheDocument();
  });

  it("201 columns with a blank header but data: reported, never called complete, acknowledged with its exact token", async () => {
    api({ headers: () => wide(201, [{ letter: "GS", header: "", has_data: true }]),
      preview: () => ({ ...previewResult, not_importable: NI({ signature: SIG, beyond: { width: 201, checked_through: 201, headers: [], headerless: ["GS"], unchecked: false } }) }) });
    const onSaved = vi.fn();
    renderDialog(null, false, { onSaved });
    await pickTab();
    expect(screen.getByText(/This tab is 201 columns wide\. Only A–GR \(the first 200\) can be imported\. Past GR: data in GS\./)).toBeInTheDocument();
    expect(screen.getByText(/2 columns won't be imported/)).toBeInTheDocument();
    expect(screen.queryByText("Every column is imported.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Past column GR, the 200-column limit: column GS (no header).")).toBeInTheDocument();
    expect(enableBtn()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I understand everything listed here won't be imported into AgentFlow."));
    fireEvent.click(enableBtn());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect([calls("save")[0].not_importable_ack, calls("activate")[0].not_importable_ack]).toEqual([SIG, SIG]);
  });

  it("a scan past GR that could not finish is shown as not checked (never as complete)", async () => {
    api({ headers: () => ({ ...headersResult(), column_count: 260, beyond_limit: { width: 260, checked_through: 200, columns: [], unchecked: true } }) });
    renderDialog(null);
    await pickTab();
    expect(screen.getByText("This tab is 260 columns wide. Only A–GR (the first 200) can be imported. Columns past GR weren't checked.")).toBeInTheDocument();
    expect(screen.getByText(/won't be imported \(columns past the checked range included\)/)).toBeInTheDocument();
  });

  it("450 columns: columns past the checked range are named as unchecked and need the confirmation", async () => {
    api({ headers: () => wide(450, [{ letter: "GS", header: "Spouse", has_data: false }], true),
      preview: () => ({ ...previewResult, not_importable: NI({ signature: SIG, beyond: { width: 450, checked_through: 400, headers: ["Spouse"], headerless: [], unchecked: true } }) }) });
    renderDialog(null);
    await pickTab();
    expect(screen.getByText(/This tab is 450 columns wide\..*Past GR: Spouse\..*Columns past OJ weren't checked\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("This tab is 450 columns wide. Columns past OJ weren't checked; nothing there is imported.")).toBeInTheDocument();
    expect(enableBtn()).toBeDisabled();
  });
});
