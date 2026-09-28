/**
 * useReportsData — scope-first loading, keyed state, late-response protection, partial failure,
 * retry, cancellation, identity change and "no polling".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useLayoutEffect } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { reportCampaigns, reportDispositions, reportLeadSources, reportScope, reportSummary, reportVolume } from "@/lib/__tests__/reportsFixtures";

type Pending = { fn: string; req: unknown; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void };

const h = vi.hoisted(() => ({ pending: [] as Pending[], calls: [] as { fn: string; req: unknown }[] }));

vi.mock("@/lib/reports-queries", async () => {
  class MockReportsQueryError extends Error {
    kind: string;
    constructor(kind: string) { super(kind); this.kind = kind; }
  }
  const make = (fn: string) => (reqOrSignal?: unknown, maybeSignal?: AbortSignal) => {
    const signal = (fn === "scope" ? reqOrSignal : maybeSignal) as AbortSignal | undefined;
    const req = fn === "scope" ? null : reqOrSignal;
    h.calls.push({ fn, req });
    return new Promise((resolve, reject) => h.pending.push({ fn, req, signal, resolve, reject }));
  };
  return {
    ReportsQueryError: MockReportsQueryError,
    isReportsQueryError: (e: unknown) => e instanceof MockReportsQueryError,
    fetchReportScope: make("scope"),
    fetchReportSummary: make("summary"),
    fetchReportVolume: make("volume"),
    fetchReportDispositions: make("dispositions"),
    fetchReportCampaigns: make("campaigns"),
    fetchReportLeadSources: make("leadSources"),
  };
});

import { ReportsQueryError } from "@/lib/reports-queries";
import { useReportPanels, useReportScope, PANEL_KEYS } from "@/hooks/useReportsData";

const DATA: Record<string, () => unknown> = {
  summary: reportSummary, volume: reportVolume, dispositions: reportDispositions,
  campaigns: reportCampaigns, leadSources: reportLeadSources, scope: reportScope,
};

function settle(fn: string, index = 0, outcome: "ok" | "fail" = "ok", data?: unknown) {
  const matching = h.pending.filter((p) => p.fn === fn);
  const p = matching[index];
  if (!p) throw new Error(`no pending ${fn}[${index}]`);
  h.pending.splice(h.pending.indexOf(p), 1);
  if (outcome === "ok") p.resolve(data ?? DATA[fn]());
  else p.reject(new (ReportsQueryError as unknown as new (k: string) => Error)("unavailable"));
}

const REQ_JULY = { startDate: "2026-07-01", endDate: "2026-07-31", agentId: null };
const REQ_JUNE = { startDate: "2026-06-01", endDate: "2026-06-30", agentId: null };

beforeEach(() => { h.pending = []; h.calls = []; });
afterEach(() => { vi.useRealTimers(); });

describe("useReportScope", () => {
  it("loads the scope once per viewer|organization and never shows another viewer's scope", async () => {
    const { result, rerender } = renderHook(({ v, o }) => useReportScope(v, o), { initialProps: { v: "u1", o: "o1" } });
    expect(result.current.state.status).toBe("loading");
    await act(async () => settle("scope"));
    expect(result.current.state.status).toBe("ready");

    // Identity change: the very next render is LOADING — the old scope is not returned for a frame.
    rerender({ v: "u2", o: "o1" });
    expect(result.current.state.status).toBe("loading");
    expect(h.pending.filter((p) => p.fn === "scope")).toHaveLength(1);
    expect(h.calls.filter((c) => c.fn === "scope")).toHaveLength(2);
  });

  it("a late scope answer for a previous viewer commits nothing and its request was cancelled", async () => {
    const { result, rerender } = renderHook(({ v }) => useReportScope(v, "o1"), { initialProps: { v: "u1" } });
    const first = h.pending[0];
    rerender({ v: "u2" });
    expect(first.signal?.aborted).toBe(true);
    h.pending.splice(h.pending.indexOf(first), 1);
    await act(async () => { first.resolve(reportScope({ scope: "organization" })); });
    expect(result.current.state.status).toBe("loading");
    await act(async () => settle("scope", 0, "ok", reportScope({ scope: "own" })));
    expect(result.current.state.status === "ready" && result.current.state.data.scope).toBe("own");
  });

  it("surfaces a scope failure and retries on demand", async () => {
    const { result } = renderHook(() => useReportScope("u1", "o1"));
    await act(async () => settle("scope", 0, "fail"));
    expect(result.current.state.status).toBe("error");
    act(() => result.current.retry());
    expect(result.current.state.status).toBe("loading");
    await act(async () => settle("scope"));
    expect(result.current.state.status).toBe("ready");
  });

  it("sends nothing without a signed-in viewer", () => {
    renderHook(() => useReportScope(null, null));
    expect(h.calls).toHaveLength(0);
  });
});

describe("useReportPanels", () => {
  it("sends no panel request until there is a scope and a valid request", () => {
    renderHook(() => useReportPanels("u1|o1", null));
    renderHook(() => useReportPanels(null, REQ_JULY));
    expect(h.calls).toHaveLength(0);
  });

  it("loads the five panels independently; one failure keeps the others (partial failure)", async () => {
    const { result } = renderHook(() => useReportPanels("u1|o1", REQ_JULY));
    expect(h.calls.map((c) => c.fn).sort()).toEqual([...PANEL_KEYS].sort());
    await act(async () => {
      settle("summary");
      settle("volume", 0, "fail");
      settle("dispositions");
      settle("campaigns");
      settle("leadSources");
    });
    expect(result.current.panels.summary.status).toBe("ready");
    expect(result.current.panels.volume.status).toBe("error");
    expect(result.current.panels.campaigns.status).toBe("ready");
  });

  it("retry re-requests only the failed panel", async () => {
    const { result } = renderHook(() => useReportPanels("u1|o1", REQ_JULY));
    await act(async () => { settle("summary", 0, "fail"); for (const k of ["volume", "dispositions", "campaigns", "leadSources"]) settle(k); });
    const before = h.calls.length;
    act(() => result.current.retryPanel("summary"));
    expect(h.calls.slice(before).map((c) => c.fn)).toEqual(["summary"]);
    expect(result.current.panels.summary.status).toBe("loading");
    await act(async () => settle("summary"));
    expect(result.current.panels.summary.status).toBe("ready");
    expect(result.current.panels.volume.status).toBe("ready");
  });

  it("a late answer for a previous period (resolve OR reject) never overwrites the current one", async () => {
    const { result, rerender } = renderHook(({ r }) => useReportPanels("u1|o1", r), { initialProps: { r: REQ_JULY } });
    const julySummary = h.pending.find((p) => p.fn === "summary")!;
    const julyVolume = h.pending.find((p) => p.fn === "volume")!;
    rerender({ r: REQ_JUNE });
    expect(julySummary.signal?.aborted).toBe(true);
    expect(result.current.panels.summary.status).toBe("loading");

    await act(async () => {
      julySummary.resolve(reportSummary({ calls_made: 999 }));
      julyVolume.reject(new Error("late failure"));
    });
    expect(result.current.panels.summary.status).toBe("loading");
    expect(result.current.panels.volume.status).toBe("loading");

    const june = h.pending.filter((p) => (p.req as { startDate: string })?.startDate === "2026-06-01");
    expect(june).toHaveLength(5);
    await act(async () => { june.find((p) => p.fn === "summary")!.resolve(reportSummary({ calls_made: 7 })); });
    const s = result.current.panels.summary;
    expect(s.status === "ready" && s.data.totals.calls_made).toBe(7);
  });

  it("never paints the previous agent filter's numbers on the render that switches it", async () => {
    const frames: Array<number | string> = [];
    const Probe: React.FC<{ agentId: string | null }> = ({ agentId }) => {
      const { panels } = useReportPanels("u1|o1", { ...REQ_JULY, agentId });
      const s = panels.summary;
      useLayoutEffect(() => { frames.push(s.status === "ready" ? s.data.totals.calls_made : s.status); });
      return null;
    };
    const { rerender } = render(<Probe agentId={null} />);
    await act(async () => settle("summary", 0, "ok", reportSummary({ calls_made: 19 })));
    rerender(<Probe agentId="11000000-0000-0000-0000-0000000000c1" />);
    // The committed frame right after the switch must not show 19.
    expect(frames[frames.length - 1]).toBe("loading");
    expect(frames).toContain(19);
  });

  it("refresh re-runs every panel for the same key; nothing runs on its own afterwards (no polling)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useReportPanels("u1|o1", REQ_JULY));
    await act(async () => { for (const k of PANEL_KEYS) settle(k); });
    const settledCalls = h.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(h.calls.length).toBe(settledCalls);
    act(() => result.current.refresh());
    expect(h.calls.length).toBe(settledCalls + PANEL_KEYS.length);
    expect(result.current.panels.summary.status).toBe("loading");
  });

  it("isCurrent reflects the report on screen, for export-time checks", async () => {
    const { result, rerender } = renderHook(({ r }) => useReportPanels("u1|o1", r), { initialProps: { r: REQ_JULY } });
    const julyKey = result.current.key;
    expect(result.current.isCurrent(julyKey)).toBe(true);
    rerender({ r: REQ_JUNE });
    await waitFor(() => expect(result.current.isCurrent(julyKey)).toBe(false));
  });

  it("unmount cancels every in-flight panel request (logout / navigation)", () => {
    const { unmount } = renderHook(() => useReportPanels("u1|o1", REQ_JULY));
    const inFlight = [...h.pending];
    unmount();
    expect(inFlight.every((p) => p.signal?.aborted)).toBe(true);
  });
});
