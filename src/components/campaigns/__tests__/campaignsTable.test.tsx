/**
 * Campaigns management table (desktop, xl+) — rendered directly with props.
 * Invariants pinned here:
 *   - header follows visibleColumns(layout); Campaign / Actions / chevron are fixed;
 *   - aria-sort on the active sort header only; Agents / Tags are not sortable;
 *   - metrics: loading → skeleton (never "0"), failed → "—" + "Metrics unavailable",
 *     omitted by the RPC (D1-B) → stored Total/Called, "—" for Contacted/Converted,
 *     genuine 0 → "0"; the progress cell is never labelled "Untouched" / "Completed";
 *   - the chevron toggles details (aria-expanded / aria-controls) and never navigates;
 *   - Duplicate eligibility and the agency lock gate the overflow menu;
 *   - Agents cell: leadership identities vs. counts; Open Pool → "Open to agency".
 */
import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import CampaignsTable from "@/components/campaigns/CampaignsTable";
import {
  COLUMN_IDS, DEFAULT_COLUMN_LAYOUT, visibleColumns, type ColumnId,
} from "@/lib/campaigns-table/columns";
import {
  resolveCampaignMetrics,
  type CampaignMetrics, type CampaignRow, type CampaignSort, type DuplicateEligibility, type StatsView,
} from "@/lib/campaigns-table/model";
import type { CampaignCardStats } from "@/lib/campaign-card-stats";
import { formatExactTimestamp, type AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";
import type { LastDialedView } from "@/components/campaigns/CampaignCells";
import type { LoadStatus } from "@/hooks/useCampaignsTableData";

// jsdom shims Radix needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(window as any).ResizeObserver = (window as any).ResizeObserver || RO;

(Element.prototype as any).hasPointerCapture = (Element.prototype as any).hasPointerCapture || (() => false);

(Element.prototype as any).setPointerCapture = (Element.prototype as any).setPointerCapture || (() => {});

(Element.prototype as any).releasePointerCapture = (Element.prototype as any).releasePointerCapture || (() => {});

(Element.prototype as any).scrollIntoView = (Element.prototype as any).scrollIntoView || (() => {});
// jsdom has no PointerEvent; MouseEvent carries the button/coords semantics Radix checks

(window as any).PointerEvent = (window as any).PointerEvent || MouseEvent;

/* ─── Fixtures ─── */

const NOW_MS = Date.UTC(2026, 9, 9, 12, 0, 0);
const TEAM_LAST_DIALED = "2026-10-09T11:30:00.000Z";

function makeRow(overrides: Partial<CampaignRow> & Pick<CampaignRow, "id" | "name" | "type">): CampaignRow {
  return {
    status: "Active",
    description: null,
    assigned_agent_ids: [],
    tags: [],
    user_id: null,
    created_by: null,
    created_at: "2026-01-01T10:00:00Z",
    organization_id: "org-1",
    retry_interval_minutes: null,
    retry_interval_hours: null,
    max_attempts: null,
    calling_hours_start: null,
    calling_hours_end: null,
    ring_timeout_seconds: null,
    total_leads: null,
    leads_called: null,
    ...overrides,
  };
}

const PERSONAL = makeRow({
  id: "c-personal",
  name: "Personal Camp",
  type: "Personal",
  status: "Paused",
  user_id: "u-owner",
  created_by: "u-owner",
  description: "Follow-ups for warm leads",
  tags: ["warm", "q4"],
  created_at: "2026-03-01T10:00:00Z",
  retry_interval_hours: 2,
  max_attempts: null,
  calling_hours_start: "08:00:00",
  calling_hours_end: "20:30:00",
  ring_timeout_seconds: 30,
  // Stored trigger-maintained counts: used only when the RPC omits this campaign (D1-B).
  total_leads: 40,
  leads_called: 12,
});

const TEAM = makeRow({
  id: "c-team",
  name: "Team Camp",
  type: "Team",
  status: "Active",
  assigned_agent_ids: ["u-1", "u-2"],
  description: "   ",
  tags: [],
  created_at: "2026-02-05T10:00:00Z",
  retry_interval_minutes: 90,
  max_attempts: 3,
  calling_hours_start: "09:00:00",
  calling_hours_end: "18:00:00",
  ring_timeout_seconds: null,
  // Stored values that must lose to the RPC when the RPC returned the campaign.
  total_leads: 999,
  leads_called: 999,
});

const OPEN = makeRow({
  id: "c-open",
  name: "Open Camp",
  type: "Open Pool",
  status: "Completed",
  assigned_agent_ids: [],
  created_at: "2026-01-05T10:00:00Z",
});

const ROWS: CampaignRow[] = [PERSONAL, TEAM, OPEN];

const STATS: Record<string, CampaignCardStats> = {
  "c-team": { total: 100, called: 25, contacted: 10, converted: 0, policiesSold: 3 },
  "c-open": { total: 50, called: 50, contacted: 20, converted: 7, policiesSold: 9 },
  // "c-personal" omitted: other users' Personal campaigns are not returned to Admin callers.
};

const SETTLED: StatsView = { status: "ready", map: STATS };
const LOADING: StatsView = { status: "loading", map: {} };
const FAILED: StatsView = { status: "error", map: {} };

function metricsFor(view: StatsView, rows: CampaignRow[] = ROWS): Record<string, CampaignMetrics> {
  return Object.fromEntries(rows.map((r) => [r.id, resolveCampaignMetrics(r, view)]));
}

const PROFILES: AssigneeProfileMap = {
  "u-1": { id: "u-1", displayName: "Ada Lovelace", avatarUrl: null },
  "u-2": { id: "u-2", displayName: "Grace Hopper", avatarUrl: null },
  "u-owner": { id: "u-owner", displayName: "Olive Owner", avatarUrl: null },
};
const ASSIGNEES_READY: { status: LoadStatus; map: AssigneeProfileMap } = { status: "ready", map: PROFILES };
const ASSIGNEES_LOADING: { status: LoadStatus; map: AssigneeProfileMap } = { status: "loading", map: {} };

const LAST_DIALED_READY: LastDialedView = { status: "ready", map: { "c-team": TEAM_LAST_DIALED, "c-personal": null } };
const LAST_DIALED_LOADING: LastDialedView = { status: "loading", map: null };
const LAST_DIALED_ERROR: LastDialedView = { status: "error", map: null };

const DEFAULT_COLUMNS = visibleColumns(DEFAULT_COLUMN_LAYOUT);
const ALL_COLUMNS: ColumnId[] = [...COLUMN_IDS];
const DEFAULT_SORT_STATE: CampaignSort = { key: "created", dir: "desc" };

const formatDate = (d: string | null | undefined) => (d ? `fmt:${d.slice(0, 10)}` : "—");

/* ─── Render helpers ─── */

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/campaigns"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider>
        {children}
        <LocationProbe />
      </TooltipProvider>
    </MemoryRouter>
  );
}

interface Opts {
  rows?: CampaignRow[];
  columns?: ColumnId[];
  sort?: CampaignSort;
  stats?: StatsView;
  expandedId?: string | null;
  duplicate?: DuplicateEligibility | ((row: CampaignRow) => DuplicateEligibility);
  orgLocked?: boolean;
  lastDialed?: LastDialedView;
  assignees?: { status: LoadStatus; map: AssigneeProfileMap } | null;
}

function buildProps(o: Opts) {
  const rows = o.rows ?? ROWS;
  const dup = o.duplicate ?? "allowed";
  const handlers = { onSort: vi.fn(), onToggle: vi.fn(), onOpen: vi.fn(), onDuplicate: vi.fn() };
  const props = {
    rows,
    metricsById: metricsFor(o.stats ?? SETTLED, rows),
    duplicateFor: typeof dup === "function" ? dup : () => dup,
    sort: o.sort ?? DEFAULT_SORT_STATE,
    expandedId: o.expandedId ?? null,
    columns: o.columns ?? DEFAULT_COLUMNS,
    orgLocked: o.orgLocked ?? false,
    lastDialed: o.lastDialed ?? LAST_DIALED_READY,
    assignees: o.assignees === undefined ? ASSIGNEES_READY : o.assignees,
    nowMs: NOW_MS,
    formatDate,
    ...handlers,
  };
  return { props, handlers };
}

function renderTable(o: Opts = {}) {
  const { props, handlers } = buildProps(o);
  const utils = render(<CampaignsTable {...props} />, { wrapper: Wrapper });
  return { ...utils, props, handlers };
}

/** Owns expansion like CampaignsPageContent does, while recording onToggle calls. */
function renderInteractiveTable(o: Opts = {}) {
  const { props, handlers } = buildProps(o);
  function Harness() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    return (
      <CampaignsTable {...props} expandedId={expandedId}
        onToggle={(id) => { handlers.onToggle(id); setExpandedId((cur) => (cur === id ? null : id)); }} />
    );
  }
  const utils = render(<Harness />, { wrapper: Wrapper });
  return { ...utils, props, handlers };
}

const rowFor = (id: string) => screen.getByTestId(`campaign-row-${id}`);

/** Cell order: chevron, Campaign, ...configurable columns, Actions. */
function cellFor(id: string, column: ColumnId, columns: ColumnId[] = DEFAULT_COLUMNS): HTMLElement {
  const idx = columns.indexOf(column);
  if (idx < 0) throw new Error(`column ${column} is not visible`);
  return within(rowFor(id)).getAllByRole("cell")[idx + 2];
}

const headerLabels = () =>
  screen.getAllByRole("columnheader").map((th) => (th.textContent ?? "").trim());

function headerFor(label: string): HTMLElement {
  const th = screen.getAllByRole("columnheader").find((h) => (h.textContent ?? "").trim() === label);
  if (!th) throw new Error(`no header ${label}`);
  return th;
}

function detailValue(details: HTMLElement, label: string): HTMLElement {
  const dt = within(details).getAllByRole("term").find((el) => el.textContent === label);
  if (!dt) throw new Error(`no detail ${label}`);
  return dt.nextElementSibling as HTMLElement;
}

function openMenu(rowName: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: `More actions for ${rowName}` }), { pointerId: 1, button: 0 });
}

/* ─── Header ─── */

describe("header", () => {
  it("renders the fixed columns around the default visible columns, in order", () => {
    renderTable();
    expect(DEFAULT_COLUMNS).toEqual(["status", "progress", "agents", "converted"]);
    expect(headerLabels()).toEqual(["Details", "Campaign", "Status", "Lead progress", "Agents", "Converted", "Actions"]);
    // Optional columns stay out of the default layout.
    expect(screen.queryByRole("columnheader", { name: /contacted/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /tags/i })).not.toBeInTheDocument();
  });

  it("renders optional columns when passed", () => {
    renderTable({ columns: ALL_COLUMNS });
    expect(headerLabels()).toEqual([
      "Details", "Campaign", "Status", "Lead progress", "Agents", "Converted", "Contacted", "Created", "Tags", "Last dialed", "Actions",
    ]);
    // Each body row has a cell per header.
    expect(within(rowFor("c-team")).getAllByRole("cell")).toHaveLength(ALL_COLUMNS.length + 3);
  });

  it("follows the passed column order", () => {
    renderTable({ columns: ["converted", "status"] });
    expect(headerLabels()).toEqual(["Details", "Campaign", "Converted", "Status", "Actions"]);
  });

  it("marks only the active sort header with aria-sort; the others read none", () => {
    renderTable({ columns: ALL_COLUMNS, sort: { key: "name", dir: "asc" } });
    expect(headerFor("Campaign")).toHaveAttribute("aria-sort", "ascending");
    for (const label of ["Status", "Lead progress", "Converted", "Contacted", "Created", "Last dialed"]) {
      expect(headerFor(label)).toHaveAttribute("aria-sort", "none");
    }
    // Non-sortable headers expose no sort state at all.
    expect(headerFor("Agents")).not.toHaveAttribute("aria-sort");
    expect(headerFor("Tags")).not.toHaveAttribute("aria-sort");
  });

  it("reports descending order on the active header", () => {
    renderTable({ columns: ALL_COLUMNS, sort: { key: "converted", dir: "desc" } });
    expect(headerFor("Converted")).toHaveAttribute("aria-sort", "descending");
    expect(headerFor("Campaign")).toHaveAttribute("aria-sort", "none");
  });

  it("calls onSort with the header's sort key", () => {
    const { handlers } = renderTable({ columns: ALL_COLUMNS });
    const expected: Array<[string, string]> = [
      ["Campaign", "name"], ["Status", "status"], ["Lead progress", "progress"], ["Converted", "converted"],
      ["Contacted", "contacted"], ["Created", "created"], ["Last dialed", "last_dialed"],
    ];
    for (const [label, key] of expected) {
      fireEvent.click(within(headerFor(label)).getByRole("button", { name: label }));
      expect(handlers.onSort).toHaveBeenLastCalledWith(key);
    }
    expect(handlers.onSort).toHaveBeenCalledTimes(expected.length);
  });

  it("renders Agents and Tags headers without a sort button", () => {
    renderTable({ columns: ALL_COLUMNS });
    expect(within(headerFor("Agents")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(headerFor("Tags")).queryByRole("button")).not.toBeInTheDocument();
  });
});

/* ─── Metrics ─── */

describe("metric states", () => {
  it("renders skeletons while stats load, never a fabricated 0", () => {
    renderTable({ stats: LOADING });
    for (const row of ROWS) {
      const progress = within(cellFor(row.id, "progress")).getByTestId("lead-progress");
      expect(within(progress).getAllByTestId("metric-loading")).toHaveLength(2);
      expect(progress.textContent).not.toMatch(/0/);
      expect(progress.textContent).not.toMatch(/\d/);
      const converted = cellFor(row.id, "converted");
      expect(within(converted).getByTestId("metric-loading")).toBeInTheDocument();
      expect(converted.textContent).toBe("");
    }
  });

  it("renders a dash with sr-only 'Metrics unavailable' when the stats request failed", () => {
    renderTable({ stats: FAILED, columns: ALL_COLUMNS });
    for (const row of ROWS) {
      for (const col of ["converted", "contacted"] as const) {
        const cell = cellFor(row.id, col, ALL_COLUMNS);
        expect(within(cell).getByText("—")).toHaveAttribute("aria-hidden", "true");
        expect(within(cell).getByText("Metrics unavailable")).toHaveClass("sr-only");
        expect(cell.textContent).not.toMatch(/\d/);
      }
      const progress = within(cellFor(row.id, "progress", ALL_COLUMNS)).getByTestId("lead-progress");
      expect(within(progress).getAllByText("Metrics unavailable")).toHaveLength(2);
      expect(progress.textContent).not.toMatch(/\d/);
    }
  });

  it("falls back to stored total/called for a campaign the settled RPC omitted (D1-B)", () => {
    renderTable({ columns: ALL_COLUMNS });
    const progress = within(cellFor("c-personal", "progress", ALL_COLUMNS)).getByTestId("lead-progress");
    expect(progress).toHaveTextContent("12 / 40");
    expect(progress).toHaveTextContent("30%");

    for (const col of ["converted", "contacted"] as const) {
      const cell = cellFor("c-personal", col, ALL_COLUMNS);
      expect(within(cell).getByText("—")).toBeInTheDocument();
      expect(within(cell).getByText("Not available for this campaign")).toHaveClass("sr-only");
      expect(cell.textContent).not.toMatch(/\d/);
    }
  });

  it("prefers RPC values over stored counts when the campaign was returned", () => {
    renderTable({ columns: ALL_COLUMNS });
    const progress = within(cellFor("c-team", "progress", ALL_COLUMNS)).getByTestId("lead-progress");
    expect(progress).toHaveTextContent("25 / 100");
    expect(progress).toHaveTextContent("25%");
    expect(progress.textContent).not.toMatch(/999/);
    expect(cellFor("c-team", "contacted", ALL_COLUMNS)).toHaveTextContent(/^10$/);
  });

  it("renders a genuine 0 as 0", () => {
    renderTable();
    const converted = cellFor("c-team", "converted");
    expect(converted).toHaveTextContent(/^0$/);
    expect(within(converted).queryByText("Metrics unavailable")).not.toBeInTheDocument();
    expect(within(converted).queryByText("Not available for this campaign")).not.toBeInTheDocument();
    expect(cellFor("c-open", "converted")).toHaveTextContent(/^7$/);
  });

  it("never labels the lead progress cell Untouched or Completed", () => {
    const untouched = makeRow({ id: "c-zero", name: "Fresh Camp", type: "Team", total_leads: 5, leads_called: 0 });
    const rows = [...ROWS, untouched];
    const views: StatsView[] = [
      SETTLED,
      LOADING,
      FAILED,
      { status: "ready", map: { ...STATS, "c-zero": { total: 5, called: 0, contacted: 0, converted: 0, policiesSold: 0 } } },
      { status: "ready", map: {} },
    ];
    for (const view of views) {
      const { unmount } = renderTable({ rows, stats: view });
      for (const row of rows) {
        const progress = within(cellFor(row.id, "progress")).getByTestId("lead-progress");
        expect(progress.textContent).not.toMatch(/untouched/i);
        expect(progress.textContent).not.toMatch(/completed/i);
      }
      unmount();
    }
  });

  it("keeps the Completed status pill out of the progress cell for a fully called campaign", () => {
    renderTable();
    expect(cellFor("c-open", "status")).toHaveTextContent("Completed");
    const progress = within(cellFor("c-open", "progress")).getByTestId("lead-progress");
    expect(progress).toHaveTextContent("50 / 50");
    expect(progress).toHaveTextContent("100%");
    expect(progress.textContent).not.toMatch(/completed/i);
  });
});

/* ─── Expansion ─── */

describe("row expansion", () => {
  it("chevron reports collapsed state with no aria-controls", () => {
    renderTable();
    const chevron = screen.getByRole("button", { name: "Show details for Team Camp" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(chevron).not.toHaveAttribute("aria-controls");
    expect(screen.queryByTestId("campaign-details-c-team")).not.toBeInTheDocument();
  });

  it("clicking the chevron calls onToggle with the id and does not navigate or open", () => {
    const { handlers } = renderInteractiveTable();
    fireEvent.click(screen.getByRole("button", { name: "Show details for Team Camp" }));
    expect(handlers.onToggle).toHaveBeenCalledTimes(1);
    expect(handlers.onToggle).toHaveBeenCalledWith("c-team");
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/campaigns$/);

    const chevron = screen.getByRole("button", { name: "Hide details for Team Camp" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    const controls = chevron.getAttribute("aria-controls");
    expect(controls).toBe("campaign-details-panel-c-team");
    const details = document.getElementById(controls as string);
    expect(details).not.toBeNull();
    expect(details).toBe(screen.getByTestId("campaign-details-c-team"));

    fireEvent.click(chevron);
    expect(handlers.onToggle).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("campaign-details-c-team")).not.toBeInTheDocument();
    const collapsed = screen.getByRole("button", { name: "Show details for Team Camp" });
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
    expect(collapsed).not.toHaveAttribute("aria-controls");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/campaigns$/);
  });

  it("only the expanded row renders details and spans every column", () => {
    renderTable({ expandedId: "c-team", columns: ALL_COLUMNS });
    expect(screen.getByTestId("campaign-details-c-team")).toBeInTheDocument();
    expect(screen.queryByTestId("campaign-details-c-personal")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details for Personal Camp" })).toHaveAttribute("aria-expanded", "false");
    const cell = screen.getByTestId("campaign-details-c-team").closest("td");
    expect(cell).toHaveAttribute("colspan", String(ALL_COLUMNS.length + 3));
  });

  it("details grid shows metrics, settings and last dialed", () => {
    renderTable({ expandedId: "c-team" });
    const details = screen.getByTestId("campaign-details-c-team");
    const labels = within(details).getAllByRole("term").map((dt) => dt.textContent);
    for (const label of [
      "Total leads", "Called", "Contacted", "Converted", "Created", "Retry interval", "Max attempts",
      "Calling window", "Ring timeout", "Last dialed",
    ]) {
      expect(labels).toContain(label);
    }
    expect(detailValue(details, "Total leads")).toHaveTextContent(/^100$/);
    expect(detailValue(details, "Called")).toHaveTextContent(/^25$/);
    expect(detailValue(details, "Contacted")).toHaveTextContent(/^10$/);
    expect(detailValue(details, "Converted")).toHaveTextContent(/^0$/);
    expect(detailValue(details, "Created")).toHaveTextContent("fmt:2026-02-05");
    expect(detailValue(details, "Retry interval")).toHaveTextContent("90 min");
    expect(detailValue(details, "Max attempts")).toHaveTextContent(/^3$/);
    expect(detailValue(details, "Calling window")).toHaveTextContent("9:00 AM – 6:00 PM");
    expect(detailValue(details, "Ring timeout")).toHaveTextContent("Org default");
    expect(detailValue(details, "Last dialed")).toHaveTextContent("30 min ago");
    expect(detailValue(details, "Assigned agents")).toHaveTextContent("Ada Lovelace, Grace Hopper");
  });

  it("details grid uses D1-B fallbacks and settings fallbacks for a Personal campaign", () => {
    renderTable({ expandedId: "c-personal" });
    const details = screen.getByTestId("campaign-details-c-personal");
    expect(detailValue(details, "Total leads")).toHaveTextContent(/^40$/);
    expect(detailValue(details, "Called")).toHaveTextContent(/^12$/);
    expect(within(detailValue(details, "Contacted")).getByText("Not available for this campaign")).toHaveClass("sr-only");
    expect(within(detailValue(details, "Converted")).getByText("Not available for this campaign")).toHaveClass("sr-only");
    expect(detailValue(details, "Retry interval")).toHaveTextContent("2 hr");
    expect(detailValue(details, "Max attempts")).toHaveTextContent("Unlimited");
    expect(detailValue(details, "Calling window")).toHaveTextContent("8:00 AM – 8:30 PM");
    expect(detailValue(details, "Ring timeout")).toHaveTextContent("30s");
    // A null entry in a loaded map is "Never".
    expect(detailValue(details, "Last dialed")).toHaveTextContent("Never");
    expect(detailValue(details, "Owner")).toHaveTextContent("Olive Owner");
  });

  it("details show description and tags only when present", () => {
    const { unmount } = renderTable({ expandedId: "c-personal" });
    const personal = screen.getByTestId("campaign-details-c-personal");
    expect(within(personal).getByText("Follow-ups for warm leads")).toBeInTheDocument();
    const tags = within(personal).getByRole("list", { name: "Tags" });
    expect(within(tags).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["warm", "q4"]);
    unmount();

    // Whitespace-only description and empty tags render neither block.
    renderTable({ expandedId: "c-team" });
    const team = screen.getByTestId("campaign-details-c-team");
    expect(within(team).queryByRole("list", { name: "Tags" })).not.toBeInTheDocument();
    expect(team.querySelector("p")).toBeNull();
  });
});

/* ─── Navigation + actions ─── */

describe("navigation and row actions", () => {
  it("campaign name is a link to the campaign detail page", () => {
    renderTable();
    for (const row of ROWS) {
      const link = within(rowFor(row.id)).getByRole("link", { name: row.name });
      expect(link).toHaveAttribute("href", `/campaigns/${row.id}`);
    }
    fireEvent.click(screen.getByRole("link", { name: "Team Camp" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/campaigns/c-team");
  });

  it("shows the type badge beside the name", () => {
    renderTable();
    expect(within(rowFor("c-personal")).getByText("Personal")).toBeInTheDocument();
    expect(within(rowFor("c-team")).getByText("Team")).toBeInTheDocument();
    expect(within(rowFor("c-open")).getByText("Open Pool")).toBeInTheDocument();
  });

  it("Open calls onOpen with the campaign id", () => {
    const { handlers } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Open Team Camp" }));
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onOpen).toHaveBeenCalledWith("c-team");
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });

  it("omits the overflow menu when duplicate is hidden", () => {
    renderTable({ duplicate: "hidden" });
    for (const row of ROWS) {
      expect(screen.queryByRole("button", { name: `More actions for ${row.name}` })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Open ${row.name}` })).toBeInTheDocument();
    }
  });

  it("uses duplicateFor per row", () => {
    renderTable({ duplicate: (row) => (row.id === "c-team" ? "allowed" : "hidden") });
    expect(screen.getByRole("button", { name: "More actions for Team Camp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions for Personal Camp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions for Open Camp" })).not.toBeInTheDocument();
  });

  it("disables Duplicate with the owner-only reason", async () => {
    const { handlers } = renderTable({ duplicate: "owner_only" });
    openMenu("Team Camp");
    const item = await screen.findByRole("menuitem", { name: /duplicate/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(within(item).getByText("Only the campaign owner can duplicate")).toBeInTheDocument();
    fireEvent.click(item);
    expect(handlers.onDuplicate).not.toHaveBeenCalled();
  });

  it("disables Duplicate while the agency is locked", async () => {
    const { handlers } = renderTable({ duplicate: "allowed", orgLocked: true });
    openMenu("Team Camp");
    const item = await screen.findByRole("menuitem", { name: /duplicate/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(within(item).getByText("Unavailable while the agency is suspended or archived")).toBeInTheDocument();
    fireEvent.click(item);
    expect(handlers.onDuplicate).not.toHaveBeenCalled();
  });

  it("enables Duplicate when allowed and passes the row to onDuplicate", async () => {
    const { handlers } = renderTable({ duplicate: "allowed" });
    openMenu("Team Camp");
    const item = await screen.findByRole("menuitem", { name: /duplicate/i });
    expect(item).not.toHaveAttribute("aria-disabled");
    expect(within(item).queryByText("Only the campaign owner can duplicate")).not.toBeInTheDocument();
    fireEvent.click(item);
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(handlers.onDuplicate).toHaveBeenCalledWith(TEAM);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("exposes no dialing action in the row", () => {
    renderTable();
    expect(within(rowFor("c-team")).queryByRole("button", { name: /dial/i })).not.toBeInTheDocument();
  });
});

/* ─── Agents cell ─── */

describe("agents cell", () => {
  it("shows an avatar stack with sr-only names for leadership", () => {
    renderTable({ assignees: ASSIGNEES_READY });
    const team = within(cellFor("c-team", "agents")).getByTestId("agents-stack");
    expect(within(team).getByText("Ada Lovelace, Grace Hopper")).toHaveClass("sr-only");
    expect(within(team).getByText("AL")).toBeInTheDocument();
    expect(within(team).getByText("GH")).toBeInTheDocument();

    const personal = within(cellFor("c-personal", "agents")).getByTestId("agents-stack");
    expect(within(personal).getByText("Olive Owner")).toHaveClass("sr-only");
  });

  it("caps the stack and summarizes the rest as +N", () => {
    const ids = ["u-1", "u-2", "u-3", "u-4", "u-5", "u-6"];
    const big = makeRow({ id: "c-big", name: "Big Team", type: "Team", assigned_agent_ids: ids });
    const map: AssigneeProfileMap = Object.fromEntries(ids.map((id, i) => [id, { id, displayName: `Agent ${i + 1}`, avatarUrl: null }]));
    renderTable({ rows: [big], stats: { status: "ready", map: {} }, assignees: { status: "ready", map } });
    const stack = within(cellFor("c-big", "agents")).getByTestId("agents-stack");
    expect(within(stack).getByText("+2")).toBeInTheDocument();
    expect(within(stack).getByText("Agent 1, Agent 2, Agent 3, Agent 4, Agent 5, Agent 6")).toHaveClass("sr-only");
  });

  it("shows counts only when the viewer is not leadership (assignees null)", () => {
    renderTable({ assignees: null });
    expect(cellFor("c-team", "agents")).toHaveTextContent(/^2 assigned$/);
    expect(cellFor("c-personal", "agents")).toHaveTextContent(/^1 assigned$/);
    expect(screen.queryByTestId("agents-stack")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ada Lovelace/)).not.toBeInTheDocument();
  });

  it("falls back to counts when the profile request failed", () => {
    renderTable({ assignees: { status: "error", map: {} } });
    expect(cellFor("c-team", "agents")).toHaveTextContent(/^2 assigned$/);
  });

  it("shows Open to agency for Open Pool campaigns", () => {
    for (const assignees of [ASSIGNEES_READY, null, ASSIGNEES_LOADING]) {
      const { unmount } = renderTable({ assignees });
      expect(cellFor("c-open", "agents")).toHaveTextContent(/^Open to agency$/);
      unmount();
    }
  });

  it("shows a skeleton while assignee profiles load", () => {
    renderTable({ assignees: ASSIGNEES_LOADING });
    expect(within(cellFor("c-team", "agents")).getByTestId("agents-loading")).toBeInTheDocument();
    expect(within(cellFor("c-personal", "agents")).getByTestId("agents-loading")).toBeInTheDocument();
    expect(cellFor("c-team", "agents").textContent).toBe("");
  });
});

/* ─── Last dialed ─── */

describe("last dialed column", () => {
  const cols: ColumnId[] = ["last_dialed"];

  it("renders Never when the loaded map has no entry for the campaign", () => {
    renderTable({ columns: cols });
    expect(cellFor("c-open", "last_dialed", cols)).toHaveTextContent(/^Never$/);
    expect(cellFor("c-personal", "last_dialed", cols)).toHaveTextContent(/^Never$/);
  });

  it("renders relative time with the exact timestamp for screen readers", () => {
    renderTable({ columns: cols });
    const cell = cellFor("c-team", "last_dialed", cols);
    expect(cell).toHaveTextContent("30 min ago");
    const exact = formatExactTimestamp(TEAM_LAST_DIALED);
    expect(exact).toMatch(/Oct 9, 2026/);
    const sr = within(cell).getByText((_, el) => el?.classList.contains("sr-only") === true);
    expect(sr.textContent).toBe(` (${exact})`);
  });

  it("renders a dash when the last-dialed request failed", () => {
    renderTable({ columns: cols, lastDialed: LAST_DIALED_ERROR });
    for (const row of ROWS) {
      const cell = cellFor(row.id, "last_dialed", cols);
      expect(within(cell).getByText("—")).toBeInTheDocument();
      expect(within(cell).getByText("Last dialed unavailable")).toHaveClass("sr-only");
      expect(cell).not.toHaveTextContent("Never");
    }
  });

  it("renders a skeleton while last dialed loads", () => {
    renderTable({ columns: cols, lastDialed: LAST_DIALED_LOADING });
    for (const row of ROWS) {
      const cell = cellFor(row.id, "last_dialed", cols);
      expect(cell.textContent).toBe("");
      expect(cell.querySelector(".animate-pulse")).not.toBeNull();
    }
  });
});

/* ─── Optional columns ─── */

describe("optional columns", () => {
  it("renders created via formatDate and tag chips", () => {
    renderTable({ columns: ALL_COLUMNS });
    expect(cellFor("c-team", "created", ALL_COLUMNS)).toHaveTextContent("fmt:2026-02-05");
    const tags = cellFor("c-personal", "tags", ALL_COLUMNS);
    expect(within(tags).getByText("warm")).toBeInTheDocument();
    expect(within(tags).getByText("q4")).toBeInTheDocument();
    expect(cellFor("c-team", "tags", ALL_COLUMNS)).toHaveTextContent(/^—$/);
  });
});
