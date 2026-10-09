/**
 * Campaigns stacked list (below xl) — rendered directly with props.
 * Invariants pinned here:
 *   - name, type badge, status pill, lead progress and Open are visible without expanding;
 *   - Open / overflow / chevron are 40px touch targets (h-10);
 *   - the chevron expands the shared detail grid (aria-expanded / aria-controls) with ids
 *     distinct from the desktop table (campaign-details-stacked-*), and never navigates;
 *   - metric states match the table: skeleton while loading (never "0"), D1-B stored
 *     fallbacks, and the progress cell is never labelled "Untouched" / "Completed";
 *   - Duplicate eligibility and the agency lock gate the overflow menu.
 */
import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import CampaignStackedList from "@/components/campaigns/CampaignStackedList";
import {
  resolveCampaignMetrics,
  type CampaignMetrics, type CampaignRow, type DuplicateEligibility, type StatsView,
} from "@/lib/campaigns-table/model";
import type { CampaignCardStats } from "@/lib/campaign-card-stats";
import type { AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";
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
  total_leads: 40,
  leads_called: 12,
});

const TEAM = makeRow({
  id: "c-team",
  name: "Team Camp",
  type: "Team",
  status: "Active",
  assigned_agent_ids: ["u-1", "u-2"],
  created_at: "2026-02-05T10:00:00Z",
  retry_interval_minutes: 90,
  max_attempts: 3,
  calling_hours_start: "09:00:00",
  calling_hours_end: "18:00:00",
  total_leads: 999,
  leads_called: 999,
});

const OPEN = makeRow({
  id: "c-open",
  name: "Open Camp",
  type: "Open Pool",
  status: "Completed",
  created_at: "2026-01-05T10:00:00Z",
});

const ROWS: CampaignRow[] = [PERSONAL, TEAM, OPEN];

const STATS: Record<string, CampaignCardStats> = {
  "c-team": { total: 100, called: 25, contacted: 10, converted: 0, policiesSold: 3 },
  "c-open": { total: 50, called: 50, contacted: 20, converted: 7, policiesSold: 9 },
  // "c-personal" omitted by the RPC (D1-B fallback).
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
const LAST_DIALED_READY: LastDialedView = { status: "ready", map: { "c-team": "2026-10-09T11:30:00.000Z" } };

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
  stats?: StatsView;
  expandedId?: string | null;
  duplicate?: DuplicateEligibility;
  orgLocked?: boolean;
  assignees?: { status: LoadStatus; map: AssigneeProfileMap } | null;
}

function buildProps(o: Opts) {
  const rows = o.rows ?? ROWS;
  const dup = o.duplicate ?? "allowed";
  const handlers = { onToggle: vi.fn(), onOpen: vi.fn(), onDuplicate: vi.fn() };
  const props = {
    rows,
    metricsById: metricsFor(o.stats ?? SETTLED, rows),
    duplicateFor: () => dup,
    expandedId: o.expandedId ?? null,
    orgLocked: o.orgLocked ?? false,
    lastDialed: LAST_DIALED_READY,
    assignees: o.assignees === undefined ? ASSIGNEES_READY : o.assignees,
    nowMs: NOW_MS,
    formatDate,
    ...handlers,
  };
  return { props, handlers };
}

function renderList(o: Opts = {}) {
  const { props, handlers } = buildProps(o);
  const utils = render(<CampaignStackedList {...props} />, { wrapper: Wrapper });
  return { ...utils, props, handlers };
}

/** Owns expansion like CampaignsPageContent does, while recording onToggle calls. */
function renderInteractiveList(o: Opts = {}) {
  const { props, handlers } = buildProps(o);
  function Harness() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    return (
      <CampaignStackedList {...props} expandedId={expandedId}
        onToggle={(id) => { handlers.onToggle(id); setExpandedId((cur) => (cur === id ? null : id)); }} />
    );
  }
  const utils = render(<Harness />, { wrapper: Wrapper });
  return { ...utils, props, handlers };
}

const itemFor = (id: string) => screen.getByTestId(`campaign-row-${id}`);

function detailValue(details: HTMLElement, label: string): HTMLElement {
  const dt = within(details).getAllByRole("term").find((el) => el.textContent === label);
  if (!dt) throw new Error(`no detail ${label}`);
  return dt.nextElementSibling as HTMLElement;
}

/* ─── Collapsed row ─── */

describe("collapsed row", () => {
  it("renders a list item per campaign without a table", () => {
    renderList();
    const list = screen.getByRole("list", { name: "Campaigns" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(ROWS.length);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows name, type badge, status pill, lead progress and Open without expanding", () => {
    renderList();
    const expected: Array<[CampaignRow, string]> = [[PERSONAL, "Personal"], [TEAM, "Team"], [OPEN, "Open Pool"]];
    for (const [row, typeLabel] of expected) {
      const item = within(itemFor(row.id));
      expect(item.getByRole("link", { name: row.name })).toHaveAttribute("href", `/campaigns/${row.id}`);
      expect(item.getByText(typeLabel)).toBeInTheDocument();
      expect(item.getByText(row.status)).toBeInTheDocument();
      expect(item.getByTestId("lead-progress")).toBeInTheDocument();
      expect(item.getByRole("button", { name: `Open ${row.name}` })).toBeInTheDocument();
      expect(screen.queryByTestId(`campaign-details-${row.id}`)).not.toBeInTheDocument();
    }
  });

  it("uses compact lead progress: called / total with a 'called' suffix and no percentage", () => {
    renderList();
    const team = within(itemFor("c-team")).getByTestId("lead-progress");
    expect(team).toHaveTextContent("25 / 100 called");
    expect(team.textContent).not.toMatch(/%/);
    expect(team.textContent).not.toMatch(/999/);
    // D1-B: the RPC omitted this Personal campaign; stored total/called are shown.
    expect(within(itemFor("c-personal")).getByTestId("lead-progress")).toHaveTextContent("12 / 40 called");
  });

  it("renders skeletons while stats load, never a fabricated 0", () => {
    renderList({ stats: LOADING });
    for (const row of ROWS) {
      const progress = within(itemFor(row.id)).getByTestId("lead-progress");
      expect(within(progress).getAllByTestId("metric-loading")).toHaveLength(2);
      expect(progress.textContent).not.toMatch(/\d/);
      expect(progress.textContent).not.toMatch(/called/);
    }
  });

  it("renders dashes with sr-only 'Metrics unavailable' when stats failed", () => {
    renderList({ stats: FAILED });
    const progress = within(itemFor("c-team")).getByTestId("lead-progress");
    expect(within(progress).getAllByText("Metrics unavailable")).toHaveLength(2);
    for (const el of within(progress).getAllByText("Metrics unavailable")) expect(el).toHaveClass("sr-only");
    expect(progress.textContent).not.toMatch(/\d/);
  });

  it("never labels lead progress Untouched or Completed", () => {
    const fresh = makeRow({ id: "c-zero", name: "Fresh Camp", type: "Team", total_leads: 5, leads_called: 0 });
    const rows = [...ROWS, fresh];
    for (const view of [SETTLED, LOADING, FAILED, { status: "ready", map: {} } as StatsView]) {
      const { unmount } = renderList({ rows, stats: view });
      for (const row of rows) {
        const progress = within(itemFor(row.id)).getByTestId("lead-progress");
        expect(progress.textContent).not.toMatch(/untouched/i);
        expect(progress.textContent).not.toMatch(/completed/i);
      }
      unmount();
    }
  });

  it("uses 40px touch targets for Open, the overflow menu and the chevron", () => {
    renderList();
    const item = within(itemFor("c-team"));
    expect(item.getByRole("button", { name: "Open Team Camp" })).toHaveClass("h-10");
    const menu = item.getByRole("button", { name: "More actions for Team Camp" });
    expect(menu).toHaveClass("h-10");
    expect(menu).toHaveClass("w-10");
    const chevron = item.getByRole("button", { name: "Show details for Team Camp" });
    expect(chevron).toHaveClass("h-10");
    expect(chevron).toHaveClass("w-10");
  });
});

/* ─── Expansion ─── */

describe("expansion", () => {
  it("chevron toggles details with aria-expanded and stacked-specific aria-controls", () => {
    const { handlers } = renderInteractiveList();
    const chevron = screen.getByRole("button", { name: "Show details for Team Camp" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(chevron).not.toHaveAttribute("aria-controls");

    fireEvent.click(chevron);
    expect(handlers.onToggle).toHaveBeenCalledWith("c-team");
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/campaigns$/);

    const expanded = screen.getByRole("button", { name: "Hide details for Team Camp" });
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    expect(expanded).toHaveAttribute("aria-controls", "campaign-details-stacked-c-team");
    const details = document.getElementById("campaign-details-stacked-c-team");
    expect(details).not.toBeNull();
    expect(details).toBe(screen.getByTestId("campaign-details-c-team"));
    expect(itemFor("c-team")).toContainElement(details);
    // Ids never collide with the desktop table's panel ids.
    expect(document.getElementById("campaign-details-panel-c-team")).toBeNull();

    fireEvent.click(expanded);
    expect(handlers.onToggle).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("campaign-details-c-team")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details for Team Camp" })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the shared detail grid for the expanded row only", () => {
    renderList({ expandedId: "c-personal" });
    expect(screen.queryByTestId("campaign-details-c-team")).not.toBeInTheDocument();
    const details = screen.getByTestId("campaign-details-c-personal");
    expect(details).toHaveAttribute("id", "campaign-details-stacked-c-personal");
    const labels = within(details).getAllByRole("term").map((dt) => dt.textContent);
    for (const label of [
      "Total leads", "Called", "Contacted", "Converted", "Created", "Retry interval", "Max attempts",
      "Calling window", "Ring timeout", "Last dialed",
    ]) {
      expect(labels).toContain(label);
    }
    expect(detailValue(details, "Total leads")).toHaveTextContent(/^40$/);
    expect(detailValue(details, "Called")).toHaveTextContent(/^12$/);
    expect(within(detailValue(details, "Converted")).getByText("Not available for this campaign")).toHaveClass("sr-only");
    expect(detailValue(details, "Owner")).toHaveTextContent("Olive Owner");
    expect(within(details).getByText("Follow-ups for warm leads")).toBeInTheDocument();
    expect(within(within(details).getByRole("list", { name: "Tags" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows team details with RPC values and settings", () => {
    renderList({ expandedId: "c-team" });
    const details = screen.getByTestId("campaign-details-c-team");
    expect(detailValue(details, "Converted")).toHaveTextContent(/^0$/);
    expect(detailValue(details, "Retry interval")).toHaveTextContent("90 min");
    expect(detailValue(details, "Calling window")).toHaveTextContent("9:00 AM – 6:00 PM");
    expect(detailValue(details, "Last dialed")).toHaveTextContent("30 min ago");
    expect(within(details).queryByRole("list", { name: "Tags" })).not.toBeInTheDocument();
  });
});

/* ─── Actions ─── */

describe("actions", () => {
  it("Open calls onOpen with the id", () => {
    const { handlers } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Open Open Camp" }));
    expect(handlers.onOpen).toHaveBeenCalledWith("c-open");
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });

  it("omits the overflow menu when duplicate is hidden", () => {
    renderList({ duplicate: "hidden" });
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
  });

  it("disables Duplicate for owner_only and while the agency is locked", async () => {
    const cases: Array<[Opts, string]> = [
      [{ duplicate: "owner_only" }, "Only the campaign owner can duplicate"],
      [{ duplicate: "allowed", orgLocked: true }, "Unavailable while the agency is suspended or archived"],
    ];
    for (const [opts, reason] of cases) {
      const { handlers, unmount } = renderList(opts);
      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Team Camp" }), { pointerId: 1, button: 0 });
      const item = await screen.findByRole("menuitem", { name: /duplicate/i });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(within(item).getByText(reason)).toBeInTheDocument();
      fireEvent.click(item);
      expect(handlers.onDuplicate).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("enables Duplicate when allowed and passes the row", async () => {
    const { handlers } = renderList({ duplicate: "allowed" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Team Camp" }), { pointerId: 1, button: 0 });
    const item = await screen.findByRole("menuitem", { name: /duplicate/i });
    expect(item).not.toHaveAttribute("aria-disabled");
    fireEvent.click(item);
    expect(handlers.onDuplicate).toHaveBeenCalledWith(TEAM);
  });
});
