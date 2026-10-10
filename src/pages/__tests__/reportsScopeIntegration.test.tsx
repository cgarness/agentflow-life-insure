import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AGENT_A, TEAM_LEAD, reportCampaigns, reportDispositions, reportLeadSources, reportScope, reportSummary, reportVolume } from "@/lib/__tests__/reportsFixtures";
import type { ReportRequestedScope } from "@/lib/reports-schemas";
import type { ReportRequest } from "@/lib/reports-queries";
import type { ReportExportFn } from "@/lib/reports-export";

type Pending = { name: string; request: ReportRequest | ReportRequestedScope | null; resolve: (data: unknown) => void; reject: (error: unknown) => void };
const h = vi.hoisted(() => ({
  pending: [] as Pending[], calls: [] as { name: string; request: Pending["request"] }[],
  identity: { id: "11000000-0000-0000-0000-0000000000b1", organization_id: "10000000-0000-0000-0000-000000000001", role: "Agent" },
  impersonating: false, download: vi.fn(), toast: vi.fn(), exports: [] as ReportExportFn[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: h.identity, isImpersonating: h.impersonating }) }));
vi.mock("@/hooks/useReportLayout", async () => {
  const { DEFAULT_LAYOUT } = await vi.importActual<typeof import("@/lib/report-layout-constants")>("@/lib/report-layout-constants");
  return { useReportLayout: () => ({ layout: DEFAULT_LAYOUT, draft: DEFAULT_LAYOUT, editMode: false, status: "ready", busy: false, error: null, beginEdit: vi.fn(), cancel: vi.fn(), setSections: vi.fn(), save: vi.fn(), reset: vi.fn(), reload: vi.fn() }) };
});
vi.mock("@/lib/reports-queries", () => {
  class MockQueryError extends Error { constructor(public kind: string) { super(kind); } }
  const query = (name: string) => (first: unknown, second: unknown) => {
    const request = (name === "scope" ? second : first) as Pending["request"];
    h.calls.push({ name, request });
    return new Promise((resolve, reject) => h.pending.push({ name, request, resolve, reject }));
  };
  return { ReportsQueryError: MockQueryError, isReportsQueryError: (e: unknown) => e instanceof MockQueryError,
    fetchReportScope: query("scope"), fetchReportSummary: query("summary"), fetchReportVolume: query("volume"),
    fetchReportDispositions: query("dispositions"), fetchReportCampaigns: query("campaigns"), fetchReportLeadSources: query("leadSources") };
});
vi.mock("@/lib/reports-export", async () => ({ ...await vi.importActual<typeof import("@/lib/reports-export")>("@/lib/reports-export"), downloadCsv: h.download }));
vi.mock("sonner", () => ({ toast: { error: h.toast } }));
vi.mock("@/components/reports/reportSectionMap", () => ({ buildReportSections: (ctx: { panels: { summary: { status: string; data?: ReturnType<typeof reportSummary> } }; exportFor: (p: string) => ReportExportFn | undefined; onSelectAgent: (id: string) => void }) => {
  const summary = ctx.panels.summary;
  const exporter = ctx.exportFor("summary");
  if (summary.status === "ready" && exporter) h.exports.push(exporter);
  return { policies_sold: <div><output data-testid="current-calls">{summary.status === "ready" ? summary.data!.totals.calls_made : "loading"}</output><button onClick={() => ctx.onSelectAgent(AGENT_A)}>Drill into Alice</button></div> };
} }));
import Reports from "@/pages/Reports";
import { ReportsQueryError } from "@/lib/reports-queries";
const renderPage = () => render(<MemoryRouter><Reports /></MemoryRouter>);
const builders = { summary: reportSummary, volume: reportVolume, dispositions: reportDispositions, campaigns: reportCampaigns, leadSources: reportLeadSources };
const scopeKind = (requested: ReportRequestedScope) => requested === "personal" ? "own" : requested === "agency" ? "organization" : "team";
async function resolveScope(requested: ReportRequestedScope, available: ReportRequestedScope[] = ["personal", "team", "agency"]) {
  const pending = h.pending.filter((p) => p.name === "scope").slice(-1)[0]!;
  h.pending.splice(h.pending.indexOf(pending), 1);
  await act(async () => pending.resolve(reportScope({ scope: scopeKind(requested), requested_scope: requested, available_scopes: available, role: "Agent", agents: requested === "personal" ? [{ id: TEAM_LEAD, name: "Tina", status: "Active" }] : reportScope().agents })));
}
async function resolvePanels(calls = 19) {
  const pending = h.pending.filter((p) => p.name !== "scope");
  h.pending = h.pending.filter((p) => p.name === "scope");
  await act(async () => {
    for (const item of pending) {
      const request = item.request as ReportRequest;
      const data = builders[item.name as keyof typeof builders]();
      data.requested_scope = request.requestedScope!; data.scope = scopeKind(request.requestedScope!);
      data.filter_agent_id = request.agentId ?? null;
      data.window = { ...data.window, start_date: request.startDate, end_date: request.endDate };
      if (item.name === "summary") (data as ReturnType<typeof reportSummary>).totals.calls_made = calls;
      item.resolve(data);
    }
  });
}
beforeEach(() => {
  h.pending = []; h.calls = []; h.exports = []; h.impersonating = false;
  h.identity = { id: TEAM_LEAD, organization_id: "10000000-0000-0000-0000-000000000001", role: "Agent" };
  h.download.mockReset(); h.toast.mockReset();
});

describe("Reports explicit scopes with real request lifetimes", () => {
  it("uses server scopes, gates panels, clears agent drilldown and rejects old exports after Agency→Personal→Agency", async () => {
    renderPage();
    expect(h.calls).toEqual([{ name: "scope", request: null }]);
    await resolveScope("agency"); await resolvePanels(901);
    expect(screen.getByRole("tab", { name: "Agency" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Customize layout" })).toBeEnabled(); // the View As case below is not vacuous
    expect(screen.getByTestId("current-calls")).toHaveTextContent("901");
    const oldExport = h.exports[h.exports.length - 1]!;
    fireEvent.click(screen.getByRole("button", { name: "Drill into Alice" }));
    expect(h.calls[h.calls.length - 1]!.request).toMatchObject({ agentId: AGENT_A, requestedScope: "agency" });
    await resolvePanels(503);
    const panelsBefore = h.calls.filter((p) => p.name !== "scope").length;
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false });
    expect(screen.queryByTestId("current-calls")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Export$/ })).not.toBeInTheDocument();
    expect(h.calls[h.calls.length - 1]).toEqual({ name: "scope", request: "personal" });
    expect(h.calls.filter((p) => p.name !== "scope")).toHaveLength(panelsBefore);
    await resolveScope("personal");
    expect(screen.getByRole("button", { name: /^Export$/ })).toBeDisabled();
    expect(h.calls.slice(-5).every((p) => (p.request as ReportRequest).requestedScope === "personal" && (p.request as ReportRequest).agentId === null)).toBe(true);
    await resolvePanels(17);
    expect(screen.getByTestId("current-calls")).toHaveTextContent("17");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Agency" }), { button: 0, ctrlKey: false });
    await resolveScope("agency"); await resolvePanels(902);
    expect(h.calls.slice(-5).every((p) => (p.request as ReportRequest).agentId === null && (p.request as ReportRequest).requestedScope === "agency")).toBe(true);
    oldExport("old", ["Calls"], [[901]]);
    expect(h.download).not.toHaveBeenCalled(); expect(h.toast).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(h.download.mock.calls[0][1]).toContain('"Calls made (outbound)",902');
  });

  it("resets selected scope on identity changes and issues no requests in View As", async () => {
    const view = renderPage(); await resolveScope("agency"); await resolvePanels();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false }); await resolveScope("personal"); await resolvePanels();
    h.identity = { ...h.identity, id: AGENT_A }; view.rerender(<MemoryRouter><Reports /></MemoryRouter>);
    expect(screen.queryByTestId("current-calls")).not.toBeInTheDocument();
    expect(h.calls[h.calls.length - 1]).toEqual({ name: "scope", request: null });
    const total = h.calls.length;
    h.impersonating = true; view.rerender(<MemoryRouter><Reports /></MemoryRouter>);
    expect(h.calls).toHaveLength(total);
    expect(screen.getByRole("button", { name: "Customize layout" })).toBeDisabled(); // View As never edits a layout
    await resolveScope("agency");
    expect(h.calls).toHaveLength(total); expect(screen.queryByTestId("current-calls")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize layout" })).toBeDisabled();
    h.impersonating = false; view.rerender(<MemoryRouter><Reports /></MemoryRouter>);
    expect(h.calls[h.calls.length - 1]).toEqual({ name: "scope", request: null });
  });

  it("never silently broadens a denied explicit scope and uses only returned options", async () => {
    renderPage(); await resolveScope("team", ["personal", "team"]); await resolvePanels();
    expect(screen.queryByRole("tab", { name: "Agency" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false });
    await act(async () => h.pending.find((p) => p.name === "scope")!.reject(new ReportsQueryError("denied")));
    await waitFor(() => expect(screen.getByText("You don't have access to Reports.")).toBeInTheDocument());
    expect(h.calls[h.calls.length - 1]).toEqual({ name: "scope", request: "personal" });
    expect(screen.queryByTestId("current-calls")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use default report scope" }));
    expect(h.calls[h.calls.length - 1]).toEqual({ name: "scope", request: null });
  });
});
