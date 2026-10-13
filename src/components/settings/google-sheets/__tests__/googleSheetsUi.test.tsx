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
vi.mock("@/lib/google-sheets/picker", () => ({ pickSpreadsheet: (t: string) => pickSpreadsheet(t), pickerConfigured: () => true }));

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
import SheetPickStep from "../SheetPickStep";
import { SheetsApiError } from "@/lib/google-sheets/api";
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
  sheetsApi.mockReset(); pickSpreadsheet.mockReset();
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
    render(<SheetPickStep onPicked={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /choose spreadsheet/i })); });
    expect(pickSpreadsheet).toHaveBeenCalledWith("ya29.SECRET-TOKEN");
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.body.innerHTML;
    expect(stored).not.toContain("ya29");
  });
});
