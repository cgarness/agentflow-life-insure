/**
 * Focused regression suite for the CampaignDetail import-history "Retry attachment" action.
 *
 * The defect under test: fetchImportHistory FILTERS on import_history.campaign_id but did not
 * SELECT it, so `row.campaign_id` was undefined on every returned row and the canRetry gate
 * could never pass — the PR-introduced retry action never rendered from this list.
 *
 * HONESTY LYNCHPIN — the supabase mock is projection-faithful for import_history: rows resolve
 * with ONLY the columns present in the captured `.select(...)` string, exactly as PostgREST
 * behaves. A mock that echoed full fixture rows regardless of the projection would let the
 * render assertions pass even against the broken select list.
 *
 * The real `isRetryableImportStatus` / `describeImportCompletion` / `canDialCampaign` are kept;
 * only `retryImportCampaignAttachment` is replaced (recording the exact id it is called with).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import CampaignDetail from "@/pages/CampaignDetail";

const CAMP_ID = "c0000000-0000-4000-8000-00000000000c";
const OTHER_CAMP_ID = "c1111111-1111-4111-8111-00000000000d";
const ADMIN_ID = "a0000000-0000-4000-8000-00000000000a";
const ORG_ID = "0f000000-0000-4000-8000-00000000000f";
const IMP_ID = "de000000-0000-4000-8000-0000000000de";

interface QueryCallRecord {
  table: string;
  select: string;
  filters: string[];
  single: boolean;
}

const { state } = vi.hoisted(() => ({
  state: {
    tableData: {} as Record<string, unknown>,
    calls: [] as { table: string; select: string; filters: string[]; single: boolean }[],
    fromCounts: {} as Record<string, number>,
    retryCalls: [] as string[],
    retryImpl: null as null | ((id: string) => Promise<unknown>),
  },
}));

/** Mirrors PostgREST: a returned row carries only the projected columns. */
function projectRow(row: Record<string, unknown>, select: string): Record<string, unknown> {
  const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.includes("*")) return { ...row };
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    if (c in row) out[c] = row[c];
  }
  return out;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      state.fromCounts[table] = (state.fromCounts[table] ?? 0) + 1;
      const rec: QueryCallRecord = { table, select: "*", filters: [], single: false };
      const b: Record<string, unknown> = {};
      for (const m of [
        "insert", "update", "delete", "upsert", "neq", "is", "not", "gte", "gt",
        "lte", "lt", "like", "ilike", "contains", "order", "limit", "range", "csv",
        "abortSignal",
      ]) {
        b[m] = () => b;
      }
      b.select = (cols?: string) => { rec.select = cols ?? "*"; return b; };
      b.eq = (col: string, val: unknown) => { rec.filters.push(`eq:${col}=${String(val)}`); return b; };
      b.in = (col: string, vals: unknown[]) => { rec.filters.push(`in:${col}=${vals.length}`); return b; };
      b.maybeSingle = () => { rec.single = true; return b; };
      b.single = () => { rec.single = true; return b; };
      (b as { then: unknown }).then = (
        onFulfilled?: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => {
        state.calls.push({ ...rec, filters: [...rec.filters] });
        let data = state.tableData[table] ?? (rec.single ? null : []);
        if (table === "import_history" && Array.isArray(data)) {
          data = data.map((r) => projectRow(r as Record<string, unknown>, rec.select));
        }
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      };
      return b;
    },
    rpc: (name: string) =>
      Promise.resolve({ data: name === "can_dial_campaign" ? false : null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
  },
}));

vi.mock("@/lib/supabase-import-campaign", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase-import-campaign")>();
  return {
    ...actual,
    // Only the retry wrapper is replaced. canDialCampaign stays real and resolves false
    // through the rpc stub above (fail closed), keeping the dial surface out of the way.
    retryImportCampaignAttachment: (id: string) => {
      state.retryCalls.push(id);
      return state.retryImpl
        ? state.retryImpl(id)
        : Promise.reject(new Error("test forgot to set state.retryImpl"));
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: ADMIN_ID },
    profile: { id: ADMIN_ID, organization_id: ORG_ID, role: "Admin", is_super_admin: false },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG_ID }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: Date | string) => new Date(d).toDateString(),
    formatDateTime: (d: Date | string) => new Date(d).toISOString(),
  }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function campaignFixture() {
  return {
    id: CAMP_ID,
    name: "QA Retry Fixture Camp",
    // Draft keeps the header actions to Activate/Delete so the "Complete" status pill
    // asserted below is unambiguous in the DOM.
    type: "Open Pool",
    status: "Draft",
    description: "",
    assigned_agent_ids: [] as string[],
    tags: [] as string[],
    total_leads: 3,
    leads_contacted: 0,
    leads_converted: 0,
    created_by: ADMIN_ID,
    user_id: ADMIN_ID,
    created_at: "2026-08-10T12:00:00.000Z",
  };
}

function importRow(overrides: Record<string, unknown>) {
  return {
    id: IMP_ID,
    file_name: "qa-retry-fixture.csv",
    total_records: 3,
    imported: 3,
    duplicates: 0,
    errors: 0,
    agent_id: null,
    created_at: "2026-08-10T12:00:00.000Z",
    import_completion_status: "campaign_partial",
    undo_status: null,
    campaign_id: CAMP_ID,
    ...overrides,
  };
}

function successEnvelope() {
  return {
    ok: true,
    status: "completed",
    has_campaign: true,
    imported_count: 3,
    attached_count: 3,
    already_present: 0,
    ineligible_count: 0,
    remaining_count: 0,
    newly_attached: 2,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/campaigns/${CAMP_ID}`]}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openImportHistoryTab() {
  renderPage();
  const tab = await screen.findByText("Import History");
  fireEvent.click(tab);
  await waitFor(() =>
    expect(state.calls.some((c) => c.table === "import_history")).toBe(true),
  );
}

function importHistorySelectColumns(): string[] {
  const call = state.calls.filter((c) => c.table === "import_history").pop();
  expect(call, "an import_history query must have been issued").toBeTruthy();
  return (call as QueryCallRecord).select.split(",").map((s) => s.trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  state.tableData = {
    campaigns: campaignFixture(),
    campaign_leads: [],
    leads: [],
    profiles: [],
    import_history: [],
  };
  state.calls = [];
  state.fromCounts = {};
  state.retryCalls = [];
  state.retryImpl = null;

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

describe("CampaignDetail import-history retry (regression: select must include campaign_id)", () => {
  it("(a) the import_history query selects campaign_id", async () => {
    await openImportHistoryTab();
    const cols = importHistorySelectColumns();
    // The anti-regression linchpin: the gate at canRetry reads row.campaign_id, which only
    // exists when the projection includes it. Editing this select list breaks the feature.
    expect(cols).toContain("campaign_id");
  });

  it("(b) a matching retryable (campaign_partial) row renders Retry attachment", async () => {
    state.tableData.import_history = [importRow({})];
    await openImportHistoryTab();
    await screen.findByText("qa-retry-fixture.csv");
    expect(screen.getByText("Partial")).toBeTruthy();
    expect(screen.getByText("Retry attachment")).toBeTruthy();
  });

  it("(c) undone, completed, null-status, and other-campaign rows render no retry control", async () => {
    state.tableData.import_history = [
      importRow({ id: "de000000-0000-4000-8000-0000000000d1", file_name: "undone.csv", undo_status: "undone" }),
      importRow({ id: "de000000-0000-4000-8000-0000000000d2", file_name: "completed.csv", import_completion_status: "completed" }),
      importRow({ id: "de000000-0000-4000-8000-0000000000d3", file_name: "nullstatus.csv", import_completion_status: null }),
      importRow({ id: "de000000-0000-4000-8000-0000000000d4", file_name: "othercamp.csv", campaign_id: OTHER_CAMP_ID }),
    ];
    await openImportHistoryTab();
    await screen.findByText("undone.csv");
    // All four rows rendered…
    expect(screen.getByText("completed.csv")).toBeTruthy();
    expect(screen.getByText("nullstatus.csv")).toBeTruthy();
    expect(screen.getByText("othercamp.csv")).toBeTruthy();
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("Attachment not confirmed")).toBeTruthy();
    // …and none of them offers a retry.
    expect(screen.queryByText("Retry attachment")).toBeNull();
  });

  it("(d+e) clicking retry calls the RPC wrapper with the exact import id, refreshes history/leads/campaign, and the refreshed completed row hides the control", async () => {
    state.tableData.import_history = [importRow({})];
    state.retryImpl = (id) => {
      expect(id).toBe(IMP_ID);
      // The server recomputed to completed; the next import_history fetch must see it.
      state.tableData.import_history = [importRow({ import_completion_status: "completed" })];
      return Promise.resolve(successEnvelope());
    };
    await openImportHistoryTab();
    const button = await screen.findByText("Retry attachment");

    const ihBefore = state.fromCounts["import_history"] ?? 0;
    const clBefore = state.fromCounts["campaign_leads"] ?? 0;
    const cBefore = state.fromCounts["campaigns"] ?? 0;

    fireEvent.click(button);

    await waitFor(() => expect(state.retryCalls).toEqual([IMP_ID]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 more lead(s) attached."));
    await waitFor(() => {
      expect(state.fromCounts["import_history"] ?? 0).toBeGreaterThan(ihBefore);
      expect(state.fromCounts["campaign_leads"] ?? 0).toBeGreaterThan(clBefore);
      expect(state.fromCounts["campaigns"] ?? 0).toBeGreaterThan(cBefore);
    });
    await screen.findByText("Complete");
    expect(screen.queryByText("Retry attachment")).toBeNull();
  });

  it("(f) an unexpected RPC envelope fails loudly: error toast, no refresh, control still offered", async () => {
    state.tableData.import_history = [importRow({})];
    // Exactly what the real wrapper throws when Zod rejects a malformed envelope.
    state.retryImpl = () => Promise.reject(new Error("The server returned an unexpected retry result"));
    await openImportHistoryTab();
    const button = await screen.findByText("Retry attachment");

    const ihBefore = state.fromCounts["import_history"] ?? 0;
    fireEvent.click(button);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The server returned an unexpected retry result"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(state.fromCounts["import_history"] ?? 0).toBe(ihBefore);
    expect(screen.getByText("Retry attachment")).toBeTruthy();
  });
});
