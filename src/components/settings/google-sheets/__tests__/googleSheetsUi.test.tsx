import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

const auth = { user: { id: "u1" }, realProfile: { organization_id: "o1" }, isImpersonating: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));

const sheetsApi = vi.fn();
vi.mock("@/lib/google-sheets/api", async (orig) => {
  const real = await orig<typeof import("@/lib/google-sheets/api")>();
  return { ...real, sheetsApi: (...a: unknown[]) => sheetsApi(...a), startGoogleConnect: vi.fn() };
});
const pickSpreadsheet = vi.fn();
const preparePicker = vi.fn();
vi.mock("@/lib/google-sheets/picker", async (orig) => {
  const real = await orig<typeof import("@/lib/google-sheets/picker")>();
  return { ...real, pickSpreadsheet: (t: string, s?: AbortSignal) => pickSpreadsheet(t, s), preparePicker: () => preparePicker(),
    pickerConfigured: () => true };
});

const gsState: { identityKey: string | null } = { identityKey: "o1:u1" };
vi.mock("@/hooks/useGoogleSheets", () => ({
  useGoogleSheets: () => ({
    ready: true, identityKey: gsState.identityKey, refresh: vi.fn(),
    status: { isLoading: false, isError: false, data: { enabled: true, eligible: true,
      connection: { status: "connected", google_email: "a@b.test", connected_at: null, last_error_code: null } } },
    sources: { isLoading: false, isError: false, data: [] },
    context: { data: { duplicate_action: "flag", default_status: "New", lead_sources: [], has_lead_created_workflows: true, custom_fields: [] } },
  }),
}));

import GoogleSheetsSettings from "../GoogleSheetsSettings";
import AddSheetDialog from "../AddSheetDialog";
import SheetReviewDialog from "../SheetReviewDialog";
import SheetIdentityReviewDialog from "../SheetIdentityReviewDialog";
import SheetSourceRowItem from "../SheetSourceRow";
import { waitForModalRelease } from "../useSheetPick";
import { SheetsApiError } from "@/lib/google-sheets/api";
import { PickerError } from "@/lib/google-sheets/picker";
import type { SheetSourceRow } from "@/lib/google-sheets/schema";

const draftSource: SheetSourceRow = {
  id: "s1", organization_id: "o1", user_id: "u1", spreadsheet_id: "SHEET_ABCDEFGHIJ", sheet_id: 0, spreadsheet_name: "Leads",
  sheet_title: "Tab", display_name: "Leads – Tab",
  mapping: { v: 1, columns: [{ header: "Name", target: "full_name" }, { header: "Phone", target: "phone" }] },
  identity_mode: "row_position", id_header: null, lead_source_default: "Google Sheets", include_existing: false, config_version: 2,
  state: "draft", health: "ok", review_reason: null, phase: "steady", lease_owner: null, last_checked_at: null, last_success_at: null,
  last_result: null, last_error_code: null, created_at: "",
};
const preview = { title: "Tab", total_rows: 3, valid_rows: 2, invalid_rows: 1, imported_before: 0, duplicate_action: "flag",
  has_lead_created_workflows: true, rows: [{ row: 2, first_name: "Ann", last_name: "Lee", phone: "555", email: "", outcome: "import", reason: null }] };

beforeEach(() => {
  sheetsApi.mockReset(); pickSpreadsheet.mockReset(); preparePicker.mockReset().mockResolvedValue(undefined);
  auth.isImpersonating = false; gsState.identityKey = "o1:u1";
  vi.stubEnv("VITE_GOOGLE_SHEETS_ENABLED", "true");
});
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); sessionStorage.clear(); });

describe("Settings → Google Sheets", () => {
  it("View As shows a notice and runs no Sheets requests", () => {
    auth.isImpersonating = true;
    render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    expect(screen.getByText(/isn't available during View As/i)).toBeInTheDocument();
    expect(sheetsApi).not.toHaveBeenCalled();
  });

  it("feature flag off hides the feature", () => {
    vi.stubEnv("VITE_GOOGLE_SHEETS_ENABLED", "false");
    render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });

  it("an identity change closes the open dialog", async () => {
    sheetsApi.mockResolvedValue({ access_token: "x" });
    const view = render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /add sheet/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    gsState.identityKey = "o2:u9";
    view.rerender(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Add / edit dialog", () => {
  it("preview and draft save create nothing; a failed save keeps the draft", async () => {
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "headers") return { header: ["Name", "Phone"] };
      if (action === "preview") return preview;
      if (action === "save") throw new SheetsApiError("version_conflict");
      throw new Error("unexpected " + action);
    });
    render(<AddSheetDialog source={draftSource} context={null} onClose={vi.fn()} onSaved={vi.fn()} onNeedsReview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My edited name" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/2 ready/)).toBeInTheDocument();
    expect(screen.getByLabelText(/also import existing rows/i)).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(await screen.findByText(/changed in another window/i)).toBeInTheDocument();
    expect(sheetsApi.mock.calls.map((c) => c[0])).not.toContain("activate");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("My edited name");
  });

  it("a failed activation retries with the SAME saved source id and version", async () => {
    let activateCalls = 0;
    const onSaved = vi.fn();
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "headers") return { header: ["Name", "Phone"] };
      if (action === "preview") return preview;
      if (action === "save") return { source_id: "s1", config_version: 3 };
      if (action === "activate") { activateCalls++; if (activateCalls === 1) throw new SheetsApiError("busy"); return { outcome: "activated" }; }
      throw new Error("unexpected " + action);
    });
    render(<AddSheetDialog source={draftSource} context={null} onClose={vi.fn()} onSaved={onSaved} onNeedsReview={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText(/2 ready/);
    fireEvent.click(screen.getByLabelText(/also import existing rows/i));
    expect(screen.getByText(/Lead Created workflows will run/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saves = sheetsApi.mock.calls.filter((c) => c[0] === "save").map((c) => c[1] as Record<string, unknown>);
    expect(saves[0]).toMatchObject({ source_id: "s1", expected_version: 2 });
    expect(saves[1]).toMatchObject({ source_id: "s1", expected_version: 3 });
    expect((saves[1].payload as Record<string, unknown>).include_existing).toBe(true);
    const activates = sheetsApi.mock.calls.filter((c) => c[0] === "activate").map((c) => c[1]);
    expect(activates[1]).toEqual({ source_id: "s1", expected_version: 3 });
  });
});

describe("Picker token handling", () => {
  it("the Picker token is used once and never persisted in browser storage or the page", async () => {
    sheetsApi.mockResolvedValue({ access_token: "ya29.SECRET-TOKEN", expires_in: 3599 });
    pickSpreadsheet.mockResolvedValue(null);
    render(<AddSheetDialog source={null} context={null} onClose={vi.fn()} onSaved={vi.fn()} onNeedsReview={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /choose spreadsheet/i })); });
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledWith("ya29.SECRET-TOKEN", expect.any(AbortSignal)));
    await screen.findByRole("button", { name: /choose spreadsheet/i });
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.body.innerHTML;
    expect(stored).not.toContain("ya29");
  });
});

/** A pending pickSpreadsheet that records the page state at the moment the Picker would be shown. */
function deferredPick() {
  const seen: { dialogs: number; bodyPointerEvents: string; focusGuards: number; signal?: AbortSignal }[] = [];
  let finish: (v: { id: string; name: string } | null) => void = () => undefined;
  pickSpreadsheet.mockImplementation((_t: string, signal?: AbortSignal) => {
    seen.push({ dialogs: document.querySelectorAll('[role="dialog"]').length, bodyPointerEvents: document.body.style.pointerEvents,
      focusGuards: document.querySelectorAll("[data-radix-focus-guard]").length, signal });
    return new Promise((r) => { finish = r; });
  });
  return { seen, resolve: (v: { id: string; name: string } | null) => act(async () => { finish(v); }) };
}
const renderAdd = () => render(<AddSheetDialog source={null} context={null} onClose={vi.fn()} onSaved={vi.fn()} onNeedsReview={vi.fn()} />);
const chooseButton = () => screen.getByRole("button", { name: /choose spreadsheet|opening google/i });
let tokens = 0;
const api = (overrides: Record<string, () => unknown> = {}) => sheetsApi.mockImplementation(async (action: string) => {
  if (overrides[action]) return overrides[action]();
  if (action === "picker_token") return { access_token: `ya29.T${++tokens}` };
  if (action === "inspect") return { name: "Facebook Leads", tabs: [{ sheetId: 0, title: "Leads", configured: false }] };
  if (action === "headers") return { header: ["First Name", "Phone"], title: "Leads" };
  throw new Error("unexpected " + action);
});
const calls = (action: string) => sheetsApi.mock.calls.filter((c) => c[0] === action);

describe("Google Picker flow", () => {
  beforeEach(() => { tokens = 0; });

  it("the dialog's modal layer is fully released before the Picker opens; the pick reopens it with tabs", async () => {
    api();
    const pick = deferredPick();
    renderAdd();
    expect(document.body.style.pointerEvents).toBe("none");                     // the modal lock is real in this test
    expect(document.querySelectorAll("[data-radix-focus-guard]").length).toBeGreaterThan(0);
    fireEvent.click(chooseButton());
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledTimes(1));
    expect(pick.seen[0]).toMatchObject({ dialogs: 0, focusGuards: 0 });
    expect(pick.seen[0].bodyPointerEvents).not.toBe("none");
    expect(pick.seen[0].signal?.aborted).toBe(false);
    expect(calls("inspect")).toHaveLength(0);
    await pick.resolve({ id: "SHEET_ABCDEFGHIJ", name: "Facebook Leads" });
    expect(await screen.findByText("Facebook Leads — choose a tab")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(calls("inspect")[0][1]).toEqual({ spreadsheet_id: "SHEET_ABCDEFGHIJ" });
    fireEvent.click(screen.getByRole("button", { name: "Leads" }));
    expect(await screen.findByLabelText("Name")).toHaveValue("Facebook Leads – Leads");   // mapping step
    expect(calls("headers")[0][1]).toEqual({ spreadsheet_id: "SHEET_ABCDEFGHIJ", sheet_id: 0 });
  });

  it("Cancel returns to the dialog with nothing inspected; a retry mints a fresh token", async () => {
    api();
    const pick = deferredPick();
    renderAdd();
    fireEvent.click(chooseButton());
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledTimes(1));
    await pick.resolve(null);
    expect(await screen.findByRole("button", { name: "Choose spreadsheet" })).toBeEnabled();
    expect(calls("inspect")).toHaveLength(0);
    fireEvent.click(chooseButton());
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledTimes(2));
    expect(pickSpreadsheet.mock.calls.map((c) => c[0])).toEqual(["ya29.T1", "ya29.T2"]);
  });

  it("a Google ERROR shows a message, logs only the code, and the retry works", async () => {
    api();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    pickSpreadsheet.mockRejectedValueOnce(new PickerError("picker_error"));
    renderAdd();
    fireEvent.click(chooseButton());
    expect(await screen.findByText(/Google couldn't open the file picker/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("[google-sheets] picker", "picker_error");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ya29");
    const pick = deferredPick();
    fireEvent.click(chooseButton());
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Google couldn't open the file picker/)).not.toBeInTheDocument();
    await pick.resolve({ id: "SHEET_ABCDEFGHIJ", name: "Facebook Leads" });
    expect(await screen.findByText("Facebook Leads — choose a tab")).toBeInTheDocument();
    warn.mockRestore();
  });

  it("a Picker that can't load shows a message and never mints a token", async () => {
    api();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    preparePicker.mockRejectedValueOnce(new PickerError("load_timeout"));
    renderAdd();
    fireEvent.click(chooseButton());
    expect(await screen.findByText(/Couldn't load Google's file picker/)).toBeInTheDocument();
    expect(calls("picker_token")).toHaveLength(0);
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose spreadsheet" })).toBeEnabled();
  });

  it("a token failure keeps the dialog open with the server's message", async () => {
    api({ picker_token: () => { throw new SheetsApiError("reconnect_required"); } });
    renderAdd();
    fireEvent.click(chooseButton());
    expect(await screen.findByText(/Google access expired/)).toBeInTheDocument();
    expect(pickSpreadsheet).not.toHaveBeenCalled();
  });

  it("an identity change while the Picker is open aborts it and drops the late pick", async () => {
    api();
    const pick = deferredPick();
    const view = render(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /add sheet/i }));
    fireEvent.click(chooseButton());
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledTimes(1));
    gsState.identityKey = "o2:u9";
    view.rerender(<MemoryRouter><GoogleSheetsSettings /></MemoryRouter>);
    expect(pick.seen[0].signal?.aborted).toBe(true);
    await pick.resolve({ id: "LATE", name: "Late" });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls("inspect")).toHaveLength(0);
  });
});

describe("waitForModalRelease", () => {
  it("never resolves while a modal layer is still mounted", async () => {
    const node = document.body.appendChild(document.createElement("div"));
    await expect(waitForModalRelease({ current: node }, 60)).rejects.toMatchObject({ code: "page_busy" });
    node.remove();
    const guard = document.body.appendChild(document.createElement("span"));
    guard.setAttribute("data-radix-focus-guard", "");
    await expect(waitForModalRelease({ current: null }, 60)).rejects.toMatchObject({ code: "page_busy" });
    guard.remove();
    document.body.style.pointerEvents = "none";
    await expect(waitForModalRelease({ current: null }, 60)).rejects.toMatchObject({ code: "page_busy" });
    document.body.style.pointerEvents = "";
    await expect(waitForModalRelease({ current: null }, 60)).resolves.toBeUndefined();
  });
});

const activeSource: SheetSourceRow = { ...draftSource, state: "enabled", health: "needs_review", review_reason: "identity_ambiguous",
  identity_mode: "source_id", id_header: "Lead ID", config_version: 7 };
const idPreview = (keys: string[]) => ({ snapshot: "s".repeat(64), config_version: 7, unresolved_rows: [2], established: 1, approved: 0, kept: 0,
  rows: keys.map((k, i) => ({ key: k, row: 3 + i, lead_id: k.startsWith("id:") ? k.slice(3) : null, hint: i === 0 ? "content" : null, valid: true,
    reason: k.startsWith("noid:") ? "missing_id" : null, rows: 1, first_name: "Row", last_name: String(i), phone: "555", email: "" })) });

describe("Review dialogs", () => {
  it("structural review: content matches need an explicit choice; apply is bound to the snapshot", async () => {
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "review_preview") return { established: 2, matched: 3, unknown: 1, config_version: 7, snapshot: "a".repeat(64) };
      if (action === "review_apply") return { config_version: 8 };
      throw new Error("unexpected " + action);
    });
    const onDone = vi.fn();
    render(<SheetReviewDialog source={{ ...activeSource, review_reason: "rows_changed", identity_mode: "row_position", id_header: null }} onClose={vi.fn()} onDone={onDone} />);
    expect(await screen.findByText(/2 rows already imported or left out \(matched by Lead ID\)/)).toBeInTheDocument();
    const resume = screen.getByRole("button", { name: "Resume" });
    expect(resume).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Skip them"));
    expect(resume).toBeDisabled();                       // content-matched rows still undecided
    fireEvent.click(screen.getByLabelText("Keep them out"));
    expect(resume).toBeEnabled();
    fireEvent.click(resume);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = sheetsApi.mock.calls.find((c) => c[0] === "review_apply")?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ snapshot: "a".repeat(64), import_matched: false, import_unknown: false, expected_version: 7 });
  });

  it("structural review: a changed sheet refreshes the preview and keeps the choices", async () => {
    let previews = 0;
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "review_preview") { previews++; return { established: 0, matched: 1, unknown: 1, config_version: 7, snapshot: String(previews).repeat(64) }; }
      if (action === "review_apply") throw new SheetsApiError("review_changed");
      throw new Error("unexpected " + action);
    });
    render(<SheetReviewDialog source={{ ...activeSource, review_reason: "rows_changed" }} onClose={vi.fn()} onDone={vi.fn()} />);
    await screen.findByText(/1 rows are new or changed/);
    fireEvent.click(screen.getByLabelText("Keep them out"));
    fireEvent.click(screen.getByLabelText("Import them as new leads", { selector: "#gs-unknown-import" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText(/changed since you opened this review/)).toBeInTheDocument();
    await waitFor(() => expect(previews).toBe(2));
    expect(screen.getByLabelText("Keep them out")).toBeChecked();
  });

  it("identity review: every row needs an explicit choice; decisions + snapshot are sent", async () => {
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "identity_review_preview") return idPreview(["id:NEWID", "noid:4"]);
      if (action === "identity_review_apply") return { config_version: 8, decided: 2 };
      throw new Error("unexpected " + action);
    });
    const onDone = vi.fn();
    render(<SheetIdentityReviewDialog source={activeSource} onClose={vi.fn()} onDone={onDone} />);
    expect(await screen.findByText(/originally row 2/)).toBeInTheDocument();
    expect(screen.getByText(/Same name, phone and email as a row that was left out/)).toBeInTheDocument();
    expect(screen.getByText(/Could be a left-out row that was edited/)).toBeInTheDocument();
    const resume = screen.getByRole("button", { name: "Resume" });
    expect(resume).toBeDisabled();                       // nothing is preselected
    fireEvent.click(screen.getByLabelText("Import"));
    expect(resume).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Keep out", { selector: "#gs-id-noid_4-exclude" }));
    expect(resume).toBeEnabled();
    fireEvent.click(resume);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sheetsApi.mock.calls.find((c) => c[0] === "identity_review_apply")?.[1]).toEqual({
      source_id: "s1", expected_version: 7, snapshot: "s".repeat(64), decisions: { "id:NEWID": "import", "noid:4": "exclude" } });
  });

  it("identity review: a row arriving before apply refreshes the list, keeps surviving choices, asks about the new row", async () => {
    let previews = 0;
    sheetsApi.mockImplementation(async (action: string) => {
      if (action === "identity_review_preview") { previews++; return previews === 1 ? idPreview(["id:NEWID"]) : idPreview(["id:NEWID", "id:Q1"]); }
      if (action === "identity_review_apply") throw new SheetsApiError("review_changed");
      throw new Error("unexpected " + action);
    });
    render(<SheetIdentityReviewDialog source={activeSource} onClose={vi.fn()} onDone={vi.fn()} />);
    await screen.findByText(/originally row 2/);
    fireEvent.click(screen.getByRole("button", { name: "Keep all out" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText(/changed since you opened this review/)).toBeInTheDocument();
    expect(await screen.findByText(/1 of 2 chosen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  });

  it("source row: Review opens the dialog that resolves the reason; a stale sync is not reported as checked", async () => {
    const onIdentityReview = vi.fn(), onReview = vi.fn(), onEdit = vi.fn();
    const conn = { status: "connected" as const, google_email: null, connected_at: null, last_error_code: null };
    const { unmount } = render(<SheetSourceRowItem source={activeSource} connection={conn} onEdit={onEdit} onReview={onReview}
      onIdentityReview={onIdentityReview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onIdentityReview).toHaveBeenCalled();
    expect(onReview).not.toHaveBeenCalled();
    unmount();
    sheetsApi.mockResolvedValue({ status: "stale", imported: 2 });
    const toastMod = await import("sonner");
    const msg = vi.spyOn(toastMod.toast, "message"), success = vi.spyOn(toastMod.toast, "success");
    render(<SheetSourceRowItem source={{ ...activeSource, health: "ok", review_reason: null }} connection={conn} onEdit={onEdit} onReview={onReview}
      onIdentityReview={onIdentityReview} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(msg).toHaveBeenCalledWith(expect.stringMatching(/Sync stopped because the sheet or its Google connection changed · 2 imported/)));
    expect(success).not.toHaveBeenCalled();
  });

  it("source row: the real-time monitoring line follows the server's status; none when off, out of scope or disconnected", () => {
    const conn = { status: "connected" as const, google_email: null, connected_at: null, last_error_code: null };
    const healthy = { ...activeSource, health: "ok" as const, review_reason: null, last_success_at: new Date().toISOString() };
    const rt = (state: "active" | "setting_up" | "interrupted", mode: "off" | "pilot" | "on" = "pilot") =>
      ({ mode, sources: { [healthy.id]: { state, last_notification_at: null, last_processed_at: null, pending: false } } });
    const row = (realtime: Parameters<typeof SheetSourceRowItem>[0]["realtime"], connection = conn as typeof conn | null) =>
      render(<SheetSourceRowItem source={healthy} connection={connection} realtime={realtime} onEdit={vi.fn()} onReview={vi.fn()}
        onIdentityReview={vi.fn()} onChanged={vi.fn()} />);
    let r = row(rt("active"));
    expect(screen.getByText("Real-time sync active")).toBeInTheDocument();
    expect(screen.getByText(/Last successful sync .* ago/)).toBeInTheDocument();
    r.unmount();
    r = row(rt("setting_up"));
    expect(screen.getByText("Setting up monitoring")).toBeInTheDocument();
    r.unmount();
    r = row(rt("interrupted"));
    expect(screen.getByText("Monitoring interrupted")).toBeInTheDocument();
    r.unmount();
    for (const [realtime, connection] of [[rt("active", "off"), conn], [{ mode: "pilot" as const, sources: {} }, conn], [null, conn],
      [rt("active"), { ...conn, status: "reconnect_required" as const }]] as const) {
      r = row(realtime, connection as typeof conn);
      expect(screen.queryByText(/Real-time sync active|Setting up monitoring|Monitoring interrupted/)).toBeNull();
      r.unmount();
    }
  });
});
