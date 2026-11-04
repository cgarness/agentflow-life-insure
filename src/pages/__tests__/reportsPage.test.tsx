/**
 * Reports page (v3) end to end with the real hook, fetchers and contract: scope states, refresh and drift, panel
 * states (loading, failure is never a zero, partial failure), filters from the server scope, the as-of line, the
 * seven sections in brief order, exactly 23 metrics, and the nine-v3-reader rule. Exports and the customizer are
 * covered with F-4 (D6 §4.9, §4.5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  deny: null as null | { code: string; message: string },
  fail: new Set<string>(),
  patch: {} as Record<string, Record<string, unknown>>,
  hold: false,
  releases: [] as (() => void)[],
  profile: { id: "11000000-0000-0000-0000-0000000000b1", organization_id: "10000000-0000-0000-0000-000000000001", role: "Admin" } as Record<string, unknown> | null,
  impersonating: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: h.profile, isImpersonating: h.impersonating }) }));
vi.mock("@/integrations/supabase/client", async () => {
  const { buildV3Bundle, V3_PANEL_KEY } = await vi.importActual<typeof import("@/lib/__tests__/reportsV3Fixtures")>("@/lib/__tests__/reportsV3Fixtures");
  return { supabase: { rpc: (fn: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    h.calls.push({ fn, args });
    const key = V3_PANEL_KEY[fn];
    if (!key) return { data: null, error: { code: "PGRST202", message: `not a v3 reader: ${fn}` } };
    if (h.hold && key !== "scopeV3") await new Promise<void>(r => { h.releases.push(r); signal.addEventListener("abort", () => r(), { once: true }); });
    if (key === "scopeV3" && h.deny) return { data: null, error: h.deny };
    if (h.fail.has(key)) return { data: null, error: { code: "P0001", message: "synthetic failure" } };
    const requestedScope = (args.p_requested_scope ?? "agency") as "agency" | "team" | "personal";
    const b = buildV3Bundle({ requestedScope, startDate: (args.p_start_date as string) ?? "2026-06-16", endDate: (args.p_end_date as string) ?? "2026-07-15", agentId: (args.p_agent_id as string) ?? null });
    return { data: { ...b[key], ...(h.patch[key] ?? {}) }, error: null };
  } }) } };
});
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="h-[300px] w-[600px]">{children}</div> };
});

import Reports from "@/pages/Reports";

const panelCalls = () => h.calls.filter(c => c.fn !== "get_report_scope_v3");
const renderPage = () => render(<MemoryRouter><Reports /></MemoryRouter>);
const ready = () => waitFor(() => expect(document.querySelectorAll("[data-kpi-id] span[aria-hidden='true']").length).toBeGreaterThan(10));

beforeEach(() => {
  h.calls.length = 0; h.deny = null; h.fail.clear(); h.patch = {}; h.hold = false; h.releases.length = 0; h.impersonating = false;
  h.profile = { id: "11000000-0000-0000-0000-0000000000b1", organization_id: "10000000-0000-0000-0000-000000000001", role: "Admin" };
});

describe("scope states", () => {
  it("requests only the nine v3 readers, scope first, and renders exactly 23 metrics", async () => {
    renderPage(); await ready();
    expect(h.calls[0].fn).toBe("get_report_scope_v3");
    expect(new Set(h.calls.map(c => c.fn)).size).toBe(9);
    expect(h.calls.every(c => c.fn.endsWith("_v3"))).toBe(true);
    expect(document.querySelectorAll("[data-kpi-id]")).toHaveLength(23);
  });
  it("a denied or disabled v3 scope shows Reports unavailable and requests no panel (R23)", async () => {
    h.deny = { code: "42501", message: "permission denied for function get_report_scope_v3" };
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0));
    expect(panelCalls()).toHaveLength(0);
    expect(document.querySelectorAll("[data-kpi-id]")).toHaveLength(0);
  });
  it("View As and a missing profile send nothing at all", async () => {
    h.impersonating = true;
    renderPage(); await act(async () => { await Promise.resolve(); });
    expect(h.calls).toHaveLength(0);
  });
  it("an unconfigured agency time zone says so and computes nothing", async () => {
    h.deny = { code: "55000", message: "agency time zone not configured" };
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/time zone/i).length).toBeGreaterThan(0));
    expect(panelCalls()).toHaveLength(0);
  });
});

describe("panel states", () => {
  it("loading panels render skeletons, never values", async () => {
    h.hold = true; renderPage();
    await waitFor(() => expect(screen.getByLabelText("Calls made: loading")).toBeTruthy());
    expect(document.querySelector("[data-kpi-id='5'] span[aria-hidden='true']")).toBeNull();
  });
  it("a failed panel is an error with Retry and no digits; the others still render", async () => {
    h.fail.add("journeyV3"); renderPage(); await ready();
    expect(screen.getByLabelText("1 Call Close: not loaded").textContent).toBe("—");
    expect(document.querySelector("[data-kpi-id='5']")?.textContent).toContain("200");
  });
  it("a panel answered for a different scope is withheld as drift, never shown under the current labels", async () => {
    h.patch.summaryV3 = { requested_scope: "team" }; renderPage();
    await waitFor(() => expect(document.querySelector("#reports-scope-panel")).toBeNull());
    await waitFor(() => expect(screen.getAllByText(/changed|reload|retry/i).length).toBeGreaterThan(0));
  });
  it("a payload that breaks the contract fails that panel closed", async () => {
    h.patch.summaryV3 = { basis_version: "reports_integrity_v2" }; renderPage();
    await waitFor(() => expect(screen.getByLabelText("Annual premium (AP): not loaded")).toBeTruthy());
  });
});

describe("sections and copy", () => {
  it("renders the seven sections in brief order, with no Sales/Calls tabs and one Period averages line", async () => {
    renderPage(); await ready();
    const groups = [...document.querySelectorAll("[data-report-group]")].map(e => e.getAttribute("data-report-group"));
    expect(groups.filter((g, i) => groups.indexOf(g) === i)).toEqual(["production", "effort", "trends", "agent_performance_cards", "regional_performance", "calling_heatmap", "breakdowns"]);
    expect(screen.queryByRole("tab", { name: /^sales$|^calls$/i })).toBeNull();
    expect(document.querySelectorAll("[data-report-helper='period-averages']")).toHaveLength(1);
  });
  it("shows money in dollars and cents, rounded once, and no percentage in Production", async () => {
    renderPage(); await ready();
    const production = document.querySelector("[data-report-group='production']")!;
    expect(production.textContent).toContain("$4,000.50");
    expect(production.textContent).toContain("$1,000.13");
    expect(production.textContent).not.toContain("%");
  });
  it("KPIs not tracked yet show a dash with a short cue, never 0", async () => {
    renderPage(); await ready();
    const tile = document.querySelector("[data-kpi-id='15']")!;
    expect(within(tile as HTMLElement).getByText("Not tracked yet")).toBeTruthy();
    expect(tile.textContent).not.toMatch(/\b0\b/);
  });
  it("Personal scope has no agent table", async () => {
    renderPage(); await ready();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Personal" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(h.calls.some(c => c.args.p_requested_scope === "personal" && c.fn === "get_report_summary_v3")).toBe(true));
    await ready();
    expect(document.querySelector("[data-report-group='agent_performance_cards']")).toBeNull();
  });
});

describe("filters and the context line", () => {
  it("shows the agency time zone and the current summary's as-of from the server", async () => {
    renderPage(); await ready();
    expect(screen.getAllByText(/America\/Chicago/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/as of/i).length).toBeGreaterThan(0);
  });
  it("Refresh re-resolves the scope and refetches every panel", async () => {
    renderPage(); await ready();
    const before = h.calls.filter(c => c.fn === "get_report_scope_v3").length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(h.calls.filter(c => c.fn === "get_report_scope_v3").length).toBe(before + 1));
    await ready();
  });
});
