import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_KEYS } from "@/lib/reports-panels";

// Controllable transport: every call returns a deferred promise the test resolves or rejects.
type Call = { fn: string; args: any; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal };
const { calls, deferred } = vi.hoisted(() => {
  const calls: Call[] = [];
  const deferred = (fn: string) => (args: any, signal?: AbortSignal) =>
    new Promise((resolve, reject) => calls.push({ fn, args, resolve, reject, signal }));
  return { calls, deferred };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/reports-v3-queries", () => ({
  fetchReportScopeV3: (signal: AbortSignal, requestedScope: unknown) => deferred("scope")({ requestedScope }, signal),
  fetchReportSummaryV3: deferred("summary"), fetchReportJourneyV3: deferred("journey"),
  fetchReportSalesAppointmentsV3: deferred("salesAppointments"), fetchReportStateBreakdownV3: deferred("states"),
  fetchReportCallVolumeV3: deferred("volume"), fetchReportDispositionBreakdownV3: deferred("dispositions"),
  fetchReportCampaignCallsV3: deferred("campaigns"), fetchReportLeadSourceCallsV3: deferred("leadSources"),
}));
import { useReportsPage } from "@/hooks/useReportsPage";
import { ReportsQueryError } from "@/lib/reports-queries";

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", AGENT = "33333333-3333-3333-3333-333333333333";
const scopeFor = (self: string, requested = "agency") => ({
  scope: requested === "personal" ? "own" : requested === "team" ? "team" : "organization", requested_scope: requested,
  available_scopes: ["personal", "team", "agency"], self_id: self, agents: [{ id: AGENT, name: "Agent", status: "Active" }],
  can_export: true, max_range_days: 366, today: "2026-11-03", time_zone: "America/Los_Angeles",
});
const panelFor = (req: any, scope = "organization", patch: Record<string, unknown> = {}) => ({
  scope, requested_scope: req.requestedScope, filter_agent_id: req.agentId, metrics: [], as_of: "2026-11-03T20:00:00Z",
  window: { time_zone: "America/Los_Angeles", start_date: req.startDate, end_date: req.endDate }, ...patch,
});
const pending = (fn: string) => calls.filter(c => c.fn === fn);
const last = (fn: string) => pending(fn).at(-1)!;
const panelCalls = () => calls.filter(c => c.fn !== "scope");
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function resolveScope(self: string, requested = "agency") { await act(async () => { last("scope").resolve(scopeFor(self, requested)); }); await flush(); }
async function resolvePanels(patch: Record<string, unknown> = {}) {
  await act(async () => { for (const k of PANEL_KEYS) { const c = last(k); c.resolve(panelFor(c.args, "organization", patch)); } });
  await flush();
}

beforeEach(() => { calls.length = 0; });

describe("useReportsPage: scope and request identity", () => {
  it("requests nothing without a viewer", async () => {
    const { result } = renderHook(() => useReportsPage(null));
    await flush();
    expect(calls).toHaveLength(0);
    expect(result.current.scopeData).toBeNull();
    expect(result.current.request).toBeNull();
  });

  it("requests no panel while the scope is unresolved or denied", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush();
    expect(panelCalls()).toHaveLength(0);
    await act(async () => { last("scope").reject(new ReportsQueryError("denied")); });
    await flush();
    expect(result.current.scope.status).toBe("error");
    expect(panelCalls()).toHaveLength(0);
  });

  it("withholds the old scope, values and request in the same render when the viewer leaves (logout, View As, org change)", async () => {
    const { result, rerender } = renderHook(({ key }) => useReportsPage(key), { initialProps: { key: `${A}|org` as string | null } });
    await flush(); await resolveScope(A); await resolvePanels();
    expect(result.current.panels.summary.status).toBe("ready");
    for (const next of [null, `${A}|other-org`]) {
      rerender({ key: next });
      expect(result.current.scopeData).toBeNull();
      expect(result.current.request).toBeNull();
      expect(result.current.panels.summary.status).toBe("loading");
      expect(result.current.exportable("summary")).toBe(false);
    }
  });

  it("never shows a late scope response from a previous viewer", async () => {
    const { result, rerender } = renderHook(({ key }) => useReportsPage(key), { initialProps: { key: `${A}|org` } });
    await flush();
    const oldScope = last("scope");
    rerender({ key: `${B}|org` });
    await flush();
    await act(async () => { oldScope.resolve(scopeFor(A)); });
    await flush();
    expect(result.current.scopeData).toBeNull();
    expect(oldScope.signal?.aborted).toBe(true);
    await resolveScope(B);
    expect(result.current.scopeData?.self_id).toBe(B);
  });

  it("ignores a late panel response from a previous agent filter, date range or refresh", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A);
    const first = last("summary");
    act(() => result.current.setAgentId(AGENT));
    await flush();
    expect(first.signal?.aborted).toBe(true);
    await act(async () => { first.resolve(panelFor(first.args)); });
    await flush();
    expect(result.current.panels.summary.status).toBe("loading");
    const second = last("summary");
    act(() => result.current.setPreset("7d"));
    await flush();
    await act(async () => { second.resolve(panelFor(second.args)); });
    await flush();
    expect(result.current.panels.summary.status).toBe("loading");
    const third = last("summary");
    act(() => result.current.refresh());
    await flush();
    await act(async () => { third.resolve(panelFor(third.args)); });
    await flush();
    expect(result.current.panels.summary.status).toBe("loading");
    await resolveScope(A);
    await act(async () => { const c = last("summary"); c.resolve(panelFor(c.args)); });
    await flush();
    expect(result.current.panels.summary.status).toBe("ready");
  });

  it("treats a response whose metadata does not match the request or scope as drift, never as data", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A);
    await resolvePanels({ requested_scope: "team" });
    expect(result.current.panels.summary.status).toBe("error");
    expect(result.current.scopeDrift).toBe(true);
    expect(result.current.exportable("summary")).toBe(false);
  });

  it("exports only current, matching panels", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A); await resolvePanels();
    expect(result.current.scopeDrift).toBe(false);
    expect(result.current.exportable("summary")).toBe(true);
    act(() => result.current.setPreset("7d"));
    expect(result.current.exportable("summary")).toBe(false);
  });
});

// Cases carried over from the retired useReportsData hook (its 20 cases are mapped in WORK_LOG 2026-11-04).
describe("useReportsPage: carried-over request-lifetime cases", () => {
  it("a scope failure is shown, and Refresh retries it on demand", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush();
    await act(async () => { last("scope").reject(new ReportsQueryError("timeout")); });
    await flush();
    expect(result.current.scope).toEqual({ status: "error", kind: "timeout" });
    act(() => result.current.refresh());
    await flush();
    expect(pending("scope")).toHaveLength(2);
    await resolveScope(A);
    expect(result.current.scope.status).toBe("ready");
  });

  it("an unconfigured agency time zone is a configuration error and requests no panel", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush();
    await act(async () => { last("scope").reject(new ReportsQueryError("configuration")); });
    await flush();
    expect(result.current.scope).toEqual({ status: "error", kind: "configuration" });
    expect(panelCalls()).toHaveLength(0);
  });

  it("refuses a scope answer whose requested scope differs from the explicit request (a broader answer is never adopted)", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A, "agency");
    act(() => result.current.onScope("personal"));
    await flush();
    expect(last("scope").args.requestedScope).toBe("personal");
    const before = panelCalls().length;
    await act(async () => { last("scope").resolve(scopeFor(A, "agency")); });
    await flush();
    expect(result.current.scope.status).toBe("error");
    expect(result.current.scopeData).toBeNull();
    expect(panelCalls()).toHaveLength(before);
  });

  it("Refresh masks the loaded scope and values in the same render and never re-commits the previous payload", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A); await resolvePanels();
    act(() => result.current.refresh());
    expect(result.current.scopeData).toBeNull();
    expect(result.current.panels.summary.status).toBe("loading");
    expect(result.current.exportable("summary")).toBe(false);
    await flush(); await resolveScope(A);
    expect(result.current.panels.summary.status).toBe("loading");
  });

  it("after A → B → A, A's earlier panels are not exportable until A's new answers arrive", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A); await resolvePanels();
    expect(result.current.exportable("summary")).toBe(true);
    act(() => result.current.setAgentId(AGENT));
    await flush();
    act(() => result.current.setAgentId(null));
    await flush();
    expect(result.current.panels.summary.status).toBe("loading");
    expect(result.current.exportable("summary")).toBe(false);
    await resolvePanels();
    expect(result.current.exportable("summary")).toBe(true);
  });

  it("one failed panel keeps the others, and Retry re-requests only that panel", async () => {
    const { result } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A);
    await act(async () => {
      for (const k of PANEL_KEYS) { const c = last(k); if (k === "journey") c.reject(new ReportsQueryError("timeout")); else c.resolve(panelFor(c.args)); }
    });
    await flush();
    expect(result.current.panels.journey).toEqual({ status: "error", kind: "timeout" });
    expect(result.current.panels.summary.status).toBe("ready");
    const counts = Object.fromEntries(PANEL_KEYS.map(k => [k, pending(k).length]));
    act(() => result.current.retryPanel("journey"));
    await flush();
    for (const k of PANEL_KEYS) expect(pending(k).length).toBe(counts[k] + (k === "journey" ? 1 : 0));
    expect(result.current.panels.journey.status).toBe("loading");
    expect(result.current.panels.summary.status).toBe("ready");
    await act(async () => { const c = last("journey"); c.resolve(panelFor(c.args)); });
    await flush();
    expect(result.current.panels.journey.status).toBe("ready");
  });

  it("requests nothing on its own after loading (no polling)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useReportsPage(`${A}|org`));
      await flush(); await resolveScope(A); await resolvePanels();
      const n = calls.length;
      await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
      expect(calls).toHaveLength(n);
      expect(result.current.panels.summary.status).toBe("ready");
    } finally { vi.useRealTimers(); }
  });

  it("unmount cancels every in-flight request (logout, navigation)", async () => {
    const { unmount } = renderHook(() => useReportsPage(`${A}|org`));
    await flush(); await resolveScope(A);
    const inFlight = PANEL_KEYS.map(k => last(k));
    unmount();
    expect(inFlight.every(c => c.signal?.aborted)).toBe(true);
  });
});
