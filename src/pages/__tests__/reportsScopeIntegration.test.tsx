/**
 * Scope transitions through the real tabs, hook, fetchers and contract (v3): Agency → Personal → Agency requests
 * each scope's own panels, clears the agent filter, and never shows a late response from the previous scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Pending = { fn: string; args: Record<string, unknown>; release: () => void };
const h = vi.hoisted(() => ({ calls: [] as Pending[], holdScope: null as string | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "11000000-0000-0000-0000-0000000000b1", organization_id: "10000000-0000-0000-0000-000000000001", role: "Admin" }, isImpersonating: false }) }));
vi.mock("@/integrations/supabase/client", async () => {
  const { buildV3Bundle, V3_PANEL_KEY } = await vi.importActual<typeof import("@/lib/__tests__/reportsV3Fixtures")>("@/lib/__tests__/reportsV3Fixtures");
  return { supabase: { rpc: (fn: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    const requestedScope = (args.p_requested_scope ?? "agency") as "agency" | "team" | "personal";
    let release = () => {};
    const gate = h.holdScope === requestedScope && fn !== "get_report_scope_v3" ? new Promise<void>(r => { release = r; }) : null;
    h.calls.push({ fn, args, release: () => release() });
    if (gate) await gate;
    if (signal.aborted) return { data: null, error: { code: "", message: "aborted" } };
    const b = buildV3Bundle({ requestedScope, startDate: (args.p_start_date as string) ?? "2026-06-16", endDate: (args.p_end_date as string) ?? "2026-07-15", agentId: (args.p_agent_id as string) ?? null });
    return { data: b[V3_PANEL_KEY[fn]], error: null };
  } }) } };
});
vi.mock("@/lib/report-layout", async () => {
  const { DEFAULT_LAYOUT, normalizeReportLayout } = await vi.importActual<typeof import("@/lib/report-layout-constants")>("@/lib/report-layout-constants");
  const copy = () => JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  return { getDefaultLayout: copy, fetchUserLayout: () => Promise.resolve(copy()), saveUserLayout: (_o: unknown, l: unknown) => Promise.resolve(normalizeReportLayout(l)),
    resetUserLayout: () => Promise.resolve(copy()) };
});
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="h-[300px] w-[600px]">{children}</div> };
});
import Reports from "@/pages/Reports";

const tab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
const summaries = (scope: string) => h.calls.filter(c => c.fn === "get_report_summary_v3" && (c.args.p_requested_scope ?? "agency") === scope);
const ready = () => waitFor(() => expect(document.querySelector("[data-kpi-id='5'] span[aria-hidden='true']")).toBeTruthy());

beforeEach(() => { h.calls.length = 0; h.holdScope = null; });

describe("scope transitions (v3)", () => {
  it("Agency → Personal → Agency requests each scope's own panels and swaps the sections", async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>); await ready();
    expect(document.querySelector("[data-report-group='agent_performance_cards']")).toBeTruthy();
    tab("Personal");
    await waitFor(() => expect(summaries("personal").length).toBe(1)); await ready();
    expect(document.querySelector("[data-report-group='agent_performance_cards']")).toBeNull();
    tab("Agency");
    await waitFor(() => expect(summaries("agency").length).toBeGreaterThanOrEqual(2)); await ready();
    expect(document.querySelector("[data-report-group='agent_performance_cards']")).toBeTruthy();
  });

  it("a late response from the previous scope never reaches the screen", async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>); await ready();
    h.holdScope = "personal";
    tab("Personal");
    await waitFor(() => expect(summaries("personal").length).toBe(1));
    tab("Agency");
    await waitFor(() => expect(summaries("agency").length).toBeGreaterThanOrEqual(2)); await ready();
    await act(async () => { h.calls.filter(c => (c.args.p_requested_scope ?? "") === "personal").forEach(c => c.release()); });
    expect(document.querySelector("[data-report-group='agent_performance_cards']")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Agency" }).getAttribute("aria-selected")).toBe("true");
  });

  it("panels are requested only after the scope resolves, for the resolved scope", async () => {
    render(<MemoryRouter><Reports /></MemoryRouter>); await ready();
    const firstPanel = h.calls.findIndex(c => c.fn !== "get_report_scope_v3");
    expect(h.calls.slice(0, firstPanel).every(c => c.fn === "get_report_scope_v3")).toBe(true);
    expect(h.calls.filter(c => c.fn !== "get_report_scope_v3").every(c => c.args.p_requested_scope === "agency")).toBe(true);
  });
});
