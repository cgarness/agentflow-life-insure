/**
 * Reports page — truthful states end to end with the real sections:
 * scope loading / denied / unavailable, panel loading, failure is never a zero, partial failure,
 * successful empty, scope-driven filters, permission-gated + key-checked exports, agency time zone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  emptySummary, policyQuality, reportCampaigns, reportDispositions, reportLeadSources, reportScope, reportSummary, reportVolume,
} from "@/lib/__tests__/reportsFixtures";

const h = vi.hoisted(() => ({
  scopeState: { status: "loading" } as { status: string; data?: unknown; error?: unknown },
  panels: {} as Record<string, { status: string; data?: unknown; error?: unknown }>,
  current: true,
  mismatchDate: false,
  retryScope: vi.fn(),
  retryPanel: vi.fn(),
  refresh: vi.fn(),
  downloads: [] as { name: string; csv: string }[],
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { id: "11000000-0000-0000-0000-0000000000b1", organization_id: "10000000-0000-0000-0000-000000000001", role: "Team Leader", is_super_admin: false } }),
}));
vi.mock("@/hooks/useReportsData", () => ({
  useReportScope: () => ({ key: "u|o", state: h.scopeState, reload: h.retryScope }),
  // Like the real hook: with nothing to request (an incomplete Custom range) the key is null and every panel loads.
  useReportPanels: (_scope: string, req: { startDate: string; endDate: string } | null) => ({ key: req ? "u|o|k" : null, panels: Object.fromEntries(Object.entries(h.panels).map(([key, state]) => [key,
    !req ? { status: "loading" } : state.status === "ready" && !h.mismatchDate ? { ...state, data: { ...(state.data as object), window: { ...(state.data as { window: object }).window, start_date: req.startDate, end_date: req.endDate } } } : state])), retryPanel: h.retryPanel, refresh: h.refresh, isCurrent: () => h.current }),
}));
vi.mock("@/lib/report-layout", async () => {
  const { DEFAULT_LAYOUT } = await vi.importActual<typeof import("@/lib/report-layout-constants")>("@/lib/report-layout-constants");
  const copy = () => JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  return {
    getDefaultLayout: copy,
    fetchUserLayout: () => Promise.resolve(copy()),
    saveUserLayout: vi.fn(), resetUserLayout: vi.fn(), saveOrgDefaultLayout: vi.fn(),
  };
});
vi.mock("@/lib/reports-export", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reports-export")>("@/lib/reports-export");
  return { ...actual, downloadCsv: (name: string, csv: string) => h.downloads.push({ name, csv }) };
});
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="w-[600px] h-[300px]">{children}</div> };
});

import Reports from "@/pages/Reports";
import { ReportsQueryError } from "@/lib/reports-queries";
import { installJsdomPolyfills } from "@/pages/__tests__/onboardingTestUtils";

installJsdomPolyfills(); // Radix Select (the Report period) probes pointer capture and scrollIntoView on open

const ready = (data: unknown) => ({ status: "ready", data });
const failed = (kind: "unavailable" | "denied" | "configuration" = "unavailable") => ({ status: "error", error: new ReportsQueryError(kind) });
const allReady = () => ({
  summary: ready(reportSummary()), volume: ready(reportVolume()), dispositions: ready(reportDispositions()),
  campaigns: ready(reportCampaigns()), leadSources: ready(reportLeadSources()),
});
const allLoading = () => Object.fromEntries(["summary", "volume", "dispositions", "campaigns", "leadSources"].map((k) => [k, { status: "loading" }]));

const renderPage = () => render(<MemoryRouter><Reports /></MemoryRouter>);
const openDataBasis = () => {
  fireEvent.click(screen.getByRole("button", { name: "Data basis" }));
  return screen.getByRole("dialog", { name: "Data basis" });
};
const choosePeriod = async (label: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Report period" }), { key: "Enter" });
  fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: label }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
};
const customizeButton = () => screen.getByRole("button", { name: "Customize layout" });
const editorRegion = () => screen.queryByRole("region", { name: "Customize your report" });
/** The viewer's saved layout resolves asynchronously; Customize enables once it has and sections exist. */
const layoutReady = () => waitFor(() => expect(customizeButton()).toBeEnabled());

beforeEach(() => {
  h.scopeState = ready(reportScope());
  h.panels = allReady();
  h.current = true; h.mismatchDate = false;
  h.downloads = [];
  h.retryScope.mockReset(); h.retryPanel.mockReset(); h.refresh.mockReset(); h.toastError.mockReset();
});

describe("scope states", () => {
  it("scope loading shows a loading state and no numbers", () => {
    h.scopeState = { status: "loading" };
    const { container } = renderPage();
    expect(screen.getByText("Loading your reports")).toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(container.querySelector("[data-reports-workspace] > header [data-report-scope-skeleton]")).not.toBeNull();
    expect(screen.getByText("Loading your report scope…")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Report period" })).toBeDisabled();
  });

  it("a denied scope shows the permission state and renders no report at all", () => {
    h.scopeState = failed("denied");
    renderPage();
    expect(screen.getByText("You don't have access to Reports.")).toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
    expect(screen.queryByText("Campaign Performance")).not.toBeInTheDocument();
  });

  it("an unconfigured agency time zone says so, computes nothing and offers Retry", () => {
    h.scopeState = failed("configuration");
    const { container } = renderPage();
    expect(screen.getByText("The agency time zone must be configured before official Reports can be calculated.")).toBeInTheDocument();
    expect(screen.getByText(/Settings → Company Branding/)).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to Reports.")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports are temporarily unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^export$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-period")).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading your report scope/)).not.toBeInTheDocument();
    expect(screen.getByText(/Agency time zone not configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize layout" })).toBeDisabled();
    expect(container.querySelector('[data-report-state="unavailable"]')!.textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.retryScope).toHaveBeenCalledTimes(1);
  });

  it("an unavailable scope offers Retry and never shows zeros", () => {
    h.scopeState = failed("unavailable");
    const { container } = renderPage();
    expect(screen.getByText("Reports are temporarily unavailable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.retryScope).toHaveBeenCalledTimes(1);
    const notice = container.querySelector('[data-report-state="error"]')!;
    expect(notice.textContent).not.toMatch(/\d/);
  });
});

describe("refresh and scope drift", () => {
  it("Refresh re-resolves the scope (agency today, zone, agents) — not only the panels", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Refresh reports" }));
    expect(h.retryScope).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a panel answered for a different scope is withheld with a reload prompt, never shown under stale labels", () => {
    h.scopeState = ready(reportScope({ scope: "own", agents: [{ id: "11000000-0000-0000-0000-0000000000c1", name: "Alice Agent", status: "Active" }] }));
    h.panels = allReady(); // the fixtures answer for scope "team"
    renderPage();
    expect(screen.getByText("Your report access changed while this page was open.")).toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.retryScope).toHaveBeenCalledTimes(1);
  });

  it("a panel answered in a different agency time zone is withheld too", () => {
    h.scopeState = ready(reportScope({ time_zone: "America/Chicago", time_zone_source: "agency_settings" }));
    renderPage();
    expect(screen.getByText("Your report access changed while this page was open.")).toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
  });
});

describe("panel states", () => {
  it("loading panels render skeletons, not empty messages", () => {
    h.panels = allLoading();
    const { container } = renderPage();
    expect(container.querySelectorAll('[data-report-state="loading"]').length).toBeGreaterThan(3);
    expect(screen.queryByText(/No (outbound )?calls in this period/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-stat-state="loading"]').length).toBeGreaterThan(0);
  });

  it("a failed panel is an error with Retry and no digits; the other panels still render (partial failure)", () => {
    h.panels = { ...allReady(), summary: failed() };
    const { container } = renderPage();
    const errors = Array.from(container.querySelectorAll('[data-report-state="error"]'));
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e.textContent).toMatch(/Couldn't load/);
      expect(e.textContent).toMatch(/not a zero/);
      expect(e.textContent).not.toMatch(/\d/);
    }
    for (const card of Array.from(container.querySelectorAll('[data-stat-state="error"]'))) {
      expect(card.textContent).not.toMatch(/\d/);
    }
    expect(screen.getAllByText("Spring Team").length).toBeGreaterThan(0); // campaigns still valid
    fireEvent.click(within(errors[0] as HTMLElement).getByRole("button", { name: /try again/i }));
    expect(h.retryPanel).toHaveBeenCalledWith("summary");
  });

  it("a panel refused for an unconfigured agency time zone withholds the whole report and re-resolves the scope", () => {
    h.panels = { ...allReady(), volume: failed("configuration") };
    renderPage();
    expect(screen.getAllByText("The agency time zone must be configured before official Reports can be calculated.")).toHaveLength(1);
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument(); // no section renders in the old zone
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(h.retryScope).toHaveBeenCalledTimes(1);
    expect(h.retryPanel).not.toHaveBeenCalled();
  });

  it("labels the call-level rate 'Call contact rate' everywhere, never a bare 'Contact rate'", async () => {
    const { container } = renderPage();
    expect(screen.getAllByText(/Call contact rate/).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/(?<!call )contact rate/i);
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(h.downloads).toHaveLength(1));
    expect(h.downloads[0].csv).toContain(`"Call contact rate %",57.9`);
    expect(h.downloads[0].csv).not.toMatch(/(?<!Call )Contact rate/);
  });

  it("shows the genuine empty state only after a successful empty result", () => {
    const zeroVolume = reportVolume();
    zeroVolume.by_date = zeroVolume.by_date.map((d) => ({ ...d, calls_made: 0, contacted: 0, inbound_calls: 0, policies_sold: 0 }));
    zeroVolume.by_hour = zeroVolume.by_hour.map((r) => ({ ...r, calls_made: 0, contacted: 0 }));
    zeroVolume.by_day_of_week = zeroVolume.by_day_of_week.map((r) => ({ ...r, calls_made: 0, contacted: 0 }));
    zeroVolume.heatmap = zeroVolume.heatmap.map((r) => ({ ...r, calls_made: 0, contacted: 0 }));
    h.panels = { ...allReady(), summary: ready(emptySummary()), volume: ready(zeroVolume) };
    renderPage();
    expect(screen.getAllByText(/No (outbound )?calls in this period/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("No outbound calls in this period.").length).toBeGreaterThan(0); // outbound-only panels say so
  });
});

describe("empty states name what is actually missing", () => {
  it("Deep Dive says no call has a campaign when calls exist but none has one", () => {
    const d = reportDispositions();
    d.by_campaign = [];
    h.panels = { ...allReady(), dispositions: ready(d) };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Disposition Deep Dive" }));
    fireEvent.click(screen.getByRole("button", { name: "By campaign" }));
    expect(screen.getByText("No campaign breakdown is available for the 6 outbound calls in this period.")).toBeInTheDocument();
    expect(screen.queryByText(/No dispositioned calls/)).not.toBeInTheDocument();
  });
});

describe("filters follow the server scope", () => {
  it("team scope offers an agent filter; own scope does not", () => {
    const { unmount } = renderPage();
    expect(screen.getByLabelText("Agent filter")).toBeInTheDocument();
    unmount();
    h.scopeState = ready(reportScope({ scope: "own", agents: [{ id: "11000000-0000-0000-0000-0000000000c1", name: "Alice Agent", status: "Active" }] }));
    renderPage();
    expect(screen.queryByLabelText("Agent filter")).not.toBeInTheDocument();
  });

  it("shows the agency time zone from the organization's settings", () => {
    renderPage();
    expect(screen.getAllByText(/America\/Los_Angeles/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/default/i)).not.toBeInTheDocument();
  });

  it("presets use the agency today (July 2026 in the fixture)", async () => {
    renderPage();
    expect(screen.getByRole("combobox", { name: "Report period" })).toHaveTextContent("Last 30 days");
    expect(screen.getByTestId("report-period").textContent).toBe("Jun 21, 2026 – Jul 20, 2026");
    await choosePeriod("This month");
    expect(screen.getByTestId("report-period").textContent).toBe("Jul 1, 2026 – Jul 20, 2026");
    await choosePeriod("Last month");
    expect(screen.getByTestId("report-period").textContent).toBe("Jun 1, 2026 – Jun 30, 2026");
  });

  it("Custom range shows the date pickers and the page notice until both dates are picked", async () => {
    renderPage();
    await choosePeriod("Custom range");
    expect(screen.getByRole("button", { name: "Start Date" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "End Date" })).toBeEnabled();
    expect(screen.getByText("Pick a start and end date to run the report.")).toBeInTheDocument();
    expect(screen.queryByText(/Pick both dates/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-period")).not.toBeInTheDocument();
    expect(screen.queryByText("Calls made")).not.toBeInTheDocument();
    expect(screen.queryByText("Your report access changed while this page was open.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-as-of")).not.toBeInTheDocument();
  });
});

describe("the layout editor and an incomplete Custom range (U-6, U-8)", () => {
  it("disables Customize while a Custom range cannot run; the tabs stop pointing at a missing panel", async () => {
    renderPage();
    await layoutReady(); // non-vacuous: Customize starts enabled
    expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-controls", "reports-scope-panel");
    await choosePeriod("Custom range");
    expect(screen.getByText("Pick a start and end date to run the report.")).toBeInTheDocument();
    expect(customizeButton()).toBeDisabled();
    expect(editorRegion()).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Team" })).not.toHaveAttribute("aria-controls");
  });

  it("keeps an open edit session visible and usable on an incomplete Custom range; Customize still cancels", async () => {
    renderPage();
    await layoutReady();
    fireEvent.click(customizeButton());
    expect(within(screen.getByRole("tabpanel")).getByRole("region", { name: "Customize your report" })).toBeInTheDocument();
    await choosePeriod("Custom range");
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(editorRegion()).toBeInTheDocument();
    const calls = screen.getByRole("checkbox", { name: "Show Calls made" });
    expect(calls).toBeChecked();
    fireEvent.click(calls);
    expect(screen.getByRole("checkbox", { name: "Show Calls made" })).not.toBeChecked();
    expect(customizeButton()).toBeEnabled();
    expect(customizeButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(customizeButton());
    expect(editorRegion()).not.toBeInTheDocument();
    expect(customizeButton()).toHaveAttribute("aria-pressed", "false");
    expect(customizeButton()).toBeDisabled(); // nothing to edit until the range can run
  }, 20_000); // two full report renders plus a Radix Select round trip

  it("hides the editor and disables Customize when the report is withheld mid-edit", async () => {
    const { rerender } = renderPage();
    await layoutReady();
    fireEvent.click(customizeButton());
    expect(editorRegion()).toBeInTheDocument();
    h.mismatchDate = true;
    rerender(<MemoryRouter><Reports /></MemoryRouter>);
    expect(screen.getByText("Your report access changed while this page was open.")).toBeInTheDocument();
    expect(editorRegion()).not.toBeInTheDocument();
    expect(customizeButton()).toBeDisabled();
  });
});

describe("Summary as of in the context line", () => {
  it("shows the current summary's time in the agency zone, inside the header", () => {
    const { container } = renderPage();
    const header = container.querySelector("[data-reports-workspace] > header") as HTMLElement;
    const asOf = within(header).getByTestId("report-as-of");
    expect(asOf).toHaveTextContent("Summary as of 11:00 AM PDT");
    expect(asOf.querySelector("time")).toHaveAttribute("datetime", "2026-07-20T18:00:00Z");
  });

  it.each([
    ["a loading summary", () => { h.panels = { ...allReady(), summary: { status: "loading" } }; }],
    ["a failed summary", () => { h.panels = { ...allReady(), summary: failed() }; }],
    ["a summary that is no longer current", () => { h.current = false; }],
    ["a withheld report (scope drift)", () => { h.mismatchDate = true; }],
  ])("is absent for %s, never a cached time", (_label, arrange) => {
    arrange();
    renderPage();
    expect(screen.queryByTestId("report-as-of")).not.toBeInTheDocument();
    expect(screen.queryByText(/Summary as of/)).not.toBeInTheDocument();
  });

  it("disappears as soon as the summary reloads", () => {
    const { rerender } = renderPage();
    expect(screen.getByTestId("report-as-of")).toBeInTheDocument();
    h.panels = { ...allReady(), summary: { status: "loading" } };
    rerender(<MemoryRouter><Reports /></MemoryRouter>);
    expect(screen.queryByTestId("report-as-of")).not.toBeInTheDocument();
  });
});

describe("exports", () => {
  it("no export controls at all without the export permission", () => {
    h.scopeState = ready(reportScope({ can_export: false }));
    renderPage();
    expect(screen.queryByRole("button", { name: /^export$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv/i })).not.toBeInTheDocument();
  });

  it("export waits for the summary and carries scope, period and zone", async () => {
    h.panels = { ...allReady(), summary: { status: "loading" } };
    const { rerender } = renderPage();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeDisabled();
    h.panels = allReady();
    rerender(<MemoryRouter><Reports /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(h.downloads).toHaveLength(1));
    expect(h.downloads[0].name).toBe("report-summary-2026-06-21-to-2026-07-20.csv");
    expect(h.downloads[0].csv).toContain(`"Scope","Your team"`);
    expect(h.downloads[0].csv).toContain(`"Time zone","America/Los_Angeles"`);
    expect(h.downloads[0].csv).toContain(`"Calls made (outbound)",19`);
  });

  it("refuses to export a report that is no longer the one on screen", () => {
    h.current = false;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    expect(h.downloads).toHaveLength(0);
    expect(h.toastError).toHaveBeenCalled();
  });

  it("section CSV exports go through the same guarded, labelled writer and neutralize formulas", async () => {
    renderPage();
    const csvButtons = screen.getAllByRole("button", { name: /csv/i });
    expect(csvButtons.length).toBeGreaterThan(0);
    for (const b of csvButtons) fireEvent.click(b);
    await waitFor(() => expect(h.downloads.length).toBe(csvButtons.length));
    for (const d of h.downloads) {
      expect(d.csv).toContain(`"Period","2026-06-21 to 2026-07-20"`);
      expect(d.csv).not.toMatch(/(^|,)"=Sold"/m); // the "=Sold" disposition name is neutralized
    }
  });
});

describe("Policies Sold: stored policies, current assignment, lineage-only campaigns (plan §20)", () => {
  it("the chart counts stored policies and ranks by CURRENT assignment, never as seller credit", () => {
    renderPage();
    expect(screen.getAllByText("Most policies — current assignments").length).toBe(1); // chart support metric; the default six-metric strip omits this ranking
    expect(screen.queryByText("Top performer")).not.toBeInTheDocument();
    expect(screen.getAllByText(/2 policies currently assigned/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/counted from wins/)).not.toBeInTheDocument();
    const sheet = openDataBasis();
    expect(within(sheet).getByText("Policies are stored client policies (primary and additional), counted on each policy's sale date.")).toBeInTheDocument();
    expect(within(sheet).getByText(/^Agent policy counts and premiums use the client's current assigned agent, not the original seller/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/counted from wins/)).not.toBeInTheDocument();
  });

  it("shows the scope-wide, all-dates data-quality note only when there is something to report", () => {
    const { unmount } = renderPage();
    expect(screen.queryByText(/Data quality across this scope/)).not.toBeInTheDocument();
    unmount();
    h.panels = { ...allReady(), volume: ready({ ...reportVolume(), policy_quality: policyQuality(2, 1) }) };
    renderPage();
    expect(screen.getByText(/Data quality across this scope, all dates \(not only this period\): 2 policies have no usable sale date/)).toBeInTheDocument();
  });

  it("Campaign Performance shows campaign-attributed policies and the policies with no provable campaign", () => {
    renderPage();
    const header = screen.getByRole("columnheader", { name: "Policies (campaign-attributed)" });
    const table = header.closest("table")!;
    expect(within(table).queryByRole("columnheader", { name: "Policies sold" })).not.toBeInTheDocument();
    expect(screen.getByText(/3 of 5 policies sold in this\s+period have unavailable campaign attribution/)).toBeInTheDocument();
    expect(screen.getByText(/not complete campaign sales attribution and not proof the campaign caused the sale/)).toBeInTheDocument();
  });

  it("agent views label policy counts as the current assignment", () => {
    renderPage();
    expect(screen.getByRole("columnheader", { name: "Policies (current assignment)" })).toBeInTheDocument();
    expect(screen.getAllByText("Policies (current assignment)").length).toBeGreaterThan(0);
  });

  it("team scope withholds Dials per policy sold (no agent/team efficiency figure from current-owner credit)", () => {
    renderPage();
    const tile = screen.queryAllByText("Dials per policy sold");
    for (const t of tile) expect(t.closest("[data-stat-state]")?.getAttribute("data-stat-state") ?? "unavailable").not.toBe("ready");
    expect(screen.queryByText("calls in period ÷ dated stored policies in period")).not.toBeInTheDocument();
  });

  it("CSV exports carry the policy basis as metadata notes", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(h.downloads).toHaveLength(1));
    expect(h.downloads[0].csv).toContain(`"Policies sold (stored, by sale date)",5`);
    expect(h.downloads[0].csv).toMatch(/"Note","Agent policy counts and premiums use the client's current assigned agent, not the original seller/);
    expect(h.downloads[0].csv).toMatch(/"Note","Policies are stored client policies/);
  });

  it("a policy panel that failed validation (e.g. a win-based payload) is unavailable, never a number", () => {
    h.panels = { ...allReady(), volume: failed("unavailable"), campaigns: failed("unavailable") };
    renderPage();
    expect(screen.queryByText("Total policies sold")).not.toBeInTheDocument(); // the chart is withheld
    expect(screen.queryByText("Peak period")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Policies (campaign-attributed)" })).not.toBeInTheDocument();
    const errors = Array.from(document.querySelectorAll('[data-report-state="error"]'));
    expect(errors.length).toBeGreaterThanOrEqual(2);
    for (const e of errors) {
      expect(e.textContent).toMatch(/Couldn't load/);
      expect(e.textContent).not.toMatch(/\d/);
    }
  });
});

describe("v2 quality and response integrity", () => {
  it("withholds a response for the wrong dates, including exports", () => {
    h.mismatchDate = true; renderPage();
    expect(screen.getByText("Your report access changed while this page was open.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeDisabled();
  });
  it("shows known premium and preserves unknown coverage in CSV", async () => {
    renderPage();
    expect(screen.getByText(/Known annual premium in that subset:/)).toBeInTheDocument();
    const quality = within(openDataBasis()).getByRole("region", { name: "Data quality in this summary" });
    expect(within(quality).getByText("Known annual premium $1,481.40; 4/5 policies known, 1 unknown (0 invalid, 0 ambiguous legacy zero); 0 missing stable identities.")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(h.downloads).toHaveLength(1));
    expect(h.downloads[0].csv).toContain('"Known annual premium",1481.4');
    expect(h.downloads[0].csv).toContain('"Policies with unknown premium",1');
    expect(h.downloads[0].csv).toContain('"Response as of","2026-07-20T18:00:00Z"');
  });
});

describe("Data basis replaces the bottom data-quality block", () => {
  const quality = () => within(screen.getByRole("dialog", { name: "Data basis" })).getByRole("region", { name: "Data quality in this summary" });

  it("lives in the toolbar once the scope resolves; there is no bottom <details> any more", () => {
    const { container } = renderPage();
    expect(within(container.querySelector("header")!).getByRole("button", { name: "Data basis" })).toBeInTheDocument();
    expect(screen.queryByText("Report basis and data quality")).not.toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
    openDataBasis();
    expect(within(quality()).getByText(/^Session rate cohort: 13 matched calls, 6 unmatched calls retained in Calls Made/)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(`Converted by source isn't available: ${reportLeadSources().converted_unavailable_reason}`)).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("time")!.getAttribute("datetime")).toBe("2026-07-20T18:00:00Z");
  });

  it("is absent until a scope resolves", () => {
    h.scopeState = { status: "loading" };
    renderPage();
    expect(screen.queryByRole("button", { name: "Data basis" })).not.toBeInTheDocument();
  });

  it.each([
    ["a failed summary", () => { h.panels = { ...allReady(), summary: failed() }; }, "Live data-quality counts are unavailable because the summary didn't load."],
    ["a loading summary", () => { h.panels = { ...allReady(), summary: { status: "loading" } }; }, "Data-quality counts appear when the summary has loaded."],
    ["a summary that is no longer current", () => { h.current = false; }, "Data-quality counts appear when the summary has loaded."],
    ["a withheld report (scope drift)", () => { h.mismatchDate = true; }, "Live data-quality counts are unavailable because the summary didn't load."],
  ])("%s shows words, never digits or a stale as-of", (_label, arrange, message) => {
    arrange();
    renderPage();
    const sheet = openDataBasis();
    expect(within(quality()).getByText(message)).toBeInTheDocument();
    expect(quality().textContent).not.toMatch(/\d/);
    expect(sheet.querySelector("time")).toBeNull();
    expect(sheet.textContent).not.toMatch(/Session rate cohort|\$1,481\.40/);
  });
});
