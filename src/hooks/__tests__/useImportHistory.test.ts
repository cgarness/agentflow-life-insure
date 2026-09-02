/**
 * useImportHistory — tab gating, clear-on-viewer-change, stale-response rejection, error/retry.
 *
 * These are the guarantees the previous inline implementation had none of: it fetched once per
 * mount regardless of tab, never cleared on a viewer change, had no request-generation guard, and
 * swallowed every error.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, renderHook, waitFor, act } from "@testing-library/react";

const apiState = vi.hoisted(() => ({
  calls: [] as { organizationId: string | null; viewerId: string | null; orgWide: boolean; offset?: number; pageSize?: number }[],
  rows: [] as unknown[],
  /** When set, successive calls are served from here by offset (pagination tests). */
  pages: null as unknown[][] | null,
  error: null as Error | null,
  /** When true, each call returns a promise the test settles by hand. */
  defer: false,
  pending: [] as { resolve: (rows: unknown[]) => void; reject: (e: Error) => void }[],
}));

vi.mock("@/lib/supabase-import-history", () => ({
  listImportHistory: (p: { organizationId: string | null; viewerId: string | null; orgWide: boolean; offset?: number; pageSize?: number }) => {
    apiState.calls.push(p);
    if (apiState.defer) {
      return new Promise((resolve, reject) => { apiState.pending.push({ resolve, reject }); });
    }
    if (apiState.error) return Promise.reject(apiState.error);
    if (apiState.pages) {
      const size = p.pageSize ?? 200;
      const offset = p.offset ?? 0;
      return Promise.resolve(apiState.pages[Math.floor(offset / size)] ?? []);
    }
    return Promise.resolve(apiState.rows);
  },
  IMPORT_HISTORY_PAGE_SIZE: 200,
}));

import { useImportHistory } from "@/hooks/useImportHistory";
import type { EffectiveViewer } from "@/lib/effectiveViewer";

const ORG = "org-1";
const AGENT: EffectiveViewer = { viewerId: "agent-1", role: "Agent", organizationId: ORG, isImpersonating: false };
const ADMIN: EffectiveViewer = { viewerId: "admin-1", role: "Admin", organizationId: ORG, isImpersonating: false };
const OTHER_AGENT: EffectiveViewer = { viewerId: "agent-2", role: "Agent", organizationId: ORG, isImpersonating: false };

const entry = (id: string) => ({
  id, fileName: `${id}.csv`, date: "2026-08-20T00:00:00Z",
  totalRecords: 1, imported: 1, duplicates: 0, errors: 0,
  importedLeadIds: [], importCompletionStatus: null, undoStatus: null, campaignId: null,
});

beforeEach(() => {
  apiState.calls = [];
  apiState.rows = [];
  apiState.pages = null;
  apiState.error = null;
  apiState.defer = false;
  apiState.pending = [];
});

describe("tab gating", () => {
  it("issues NO fetch while the tab is inactive", async () => {
    renderHook(() => useImportHistory({ viewer: AGENT, enabled: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiState.calls).toHaveLength(0);
  });

  it("fetches once when the tab becomes active, and does not refetch on re-render", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useImportHistory({ viewer: AGENT, enabled }),
      { initialProps: { enabled: false } },
    );
    expect(apiState.calls).toHaveLength(0);

    apiState.rows = [entry("a")];
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(apiState.calls).toHaveLength(1);

    rerender({ enabled: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiState.calls).toHaveLength(1);
  });

  it("does not fetch without a resolved viewer", async () => {
    renderHook(() => useImportHistory({ viewer: null, enabled: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiState.calls).toHaveLength(0);
  });
});

describe("scope passed to the query", () => {
  it("an Agent is not org-wide", async () => {
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(apiState.calls).toHaveLength(1));
    // Exact, including the paging cursor — nothing else may be smuggled into the query.
    expect(apiState.calls[0]).toEqual({
      organizationId: ORG, viewerId: "agent-1", orgWide: false, offset: 0, pageSize: 200,
    });
    expect(result.current.error).toBeNull();
  });

  it("an Admin is org-wide", async () => {
    renderHook(() => useImportHistory({ viewer: ADMIN, enabled: true }));
    await waitFor(() => expect(apiState.calls).toHaveLength(1));
    expect(apiState.calls[0].orgWide).toBe(true);
  });

  it("a Super Admin VIEWING AS an Agent is NOT org-wide", async () => {
    const viewedAgent: EffectiveViewer = { ...AGENT, isImpersonating: true };
    renderHook(() => useImportHistory({ viewer: viewedAgent, enabled: true }));
    await waitFor(() => expect(apiState.calls).toHaveLength(1));
    expect(apiState.calls[0]).toEqual({
      organizationId: ORG, viewerId: "agent-1", orgWide: false, offset: 0, pageSize: 200,
    });
  });
});

describe("viewer change clears data and rejects stale responses", () => {
  it("clears the previous viewer's entries immediately", async () => {
    apiState.rows = [entry("first")];
    const { result, rerender } = renderHook(
      ({ viewer }) => useImportHistory({ viewer, enabled: true }),
      { initialProps: { viewer: AGENT } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    apiState.rows = [entry("second")];
    rerender({ viewer: OTHER_AGENT });

    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["second"]));
    expect(apiState.calls.at(-1)?.viewerId).toBe("agent-2");
  });

  it("a slow response for the previous viewer never repaints the new one", async () => {
    apiState.defer = true;
    const { result, rerender } = renderHook(
      ({ viewer }) => useImportHistory({ viewer, enabled: true }),
      { initialProps: { viewer: AGENT } },
    );
    await waitFor(() => expect(apiState.pending).toHaveLength(1));
    const stale = apiState.pending[0];

    // Switch viewer in place, then settle the NEW request first.
    rerender({ viewer: OTHER_AGENT });
    await waitFor(() => expect(apiState.pending).toHaveLength(2));
    await act(async () => { apiState.pending[1].resolve([entry("current")]); });
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["current"]));

    // The previous viewer's response finally arrives — it must be discarded entirely.
    await act(async () => { stale.resolve([entry("stale")]); });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.entries.map((e) => e.id)).toEqual(["current"]);
  });

  it("a stale response that ERRORS cannot raise an error on the current viewer", async () => {
    apiState.defer = true;
    const { result, rerender } = renderHook(
      ({ viewer }) => useImportHistory({ viewer, enabled: true }),
      { initialProps: { viewer: AGENT } },
    );
    await waitFor(() => expect(apiState.pending).toHaveLength(1));
    const stale = apiState.pending[0];

    rerender({ viewer: OTHER_AGENT });
    await waitFor(() => expect(apiState.pending).toHaveLength(2));
    await act(async () => { apiState.pending[1].resolve([entry("current")]); });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => { stale.reject(new Error("stale failure")); });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.error).toBeNull();
    expect(result.current.entries.map((e) => e.id)).toEqual(["current"]);
  });
});

describe("errors are distinguishable from an empty history", () => {
  it("sets error and clears entries, rather than resolving empty", async () => {
    apiState.error = new Error("permission denied");
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));

    await waitFor(() => expect(result.current.error).toBe("permission denied"));
    expect(result.current.entries).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("an empty history has NO error", async () => {
    apiState.rows = [];
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("refresh() retries after a failure", async () => {
    apiState.error = new Error("boom");
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.error).toBe("boom"));

    apiState.error = null;
    apiState.rows = [entry("recovered")];
    await act(async () => { await result.current.refresh(); });

    expect(result.current.error).toBeNull();
    expect(result.current.entries.map((e) => e.id)).toEqual(["recovered"]);
  });
});

describe("markStale — the post-import path", () => {
  it("does NOT fetch while the tab is inactive, but refetches on activation", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useImportHistory({ viewer: AGENT, enabled }),
      { initialProps: { enabled: false } },
    );

    act(() => { result.current.markStale(); });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiState.calls).toHaveLength(0); // still inactive — nothing fetched

    apiState.rows = [entry("after-import")];
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["after-import"]));
    expect(apiState.calls).toHaveLength(1);
  });

  it("forces a refetch when the tab is already active", async () => {
    apiState.rows = [entry("before")];
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    apiState.rows = [entry("before"), entry("after-import")];
    act(() => { result.current.markStale(); });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(apiState.calls).toHaveLength(2);
  });
});


describe("render-time isolation — no viewer ever sees another viewer's rows, not even for one render", () => {
  // A passive `useEffect` clear is ONE COMMIT TOO LATE: on the render where the viewer changes, the
  // previous viewer's entries are still in state and are returned to the component. This probe
  // records what the hook RETURNS on every render, so that frame is visible.
  function probe(logRef: string[][]) {
    return function Probe({ viewer, enabled }: { viewer: EffectiveViewer | null; enabled: boolean }) {
      const r = useImportHistory({ viewer, enabled });
      logRef.push(r.entries.map((e) => e.id));
      return null;
    };
  }

  it("Agent B never renders Agent A's import row", async () => {
    const log: string[][] = [];
    const Probe = probe(log);
    apiState.rows = [entry("agent-a-import")];

    const { rerender } = render(React.createElement(Probe, { viewer: AGENT, enabled: true }));
    await waitFor(() => expect(log.at(-1)).toEqual(["agent-a-import"]));

    const before = log.length;
    apiState.rows = [entry("agent-b-import")];
    rerender(React.createElement(Probe, { viewer: OTHER_AGENT, enabled: true }));
    await waitFor(() => expect(log.at(-1)).toEqual(["agent-b-import"]));

    // Every render from the switch onward — the first of which is where the leak occurs.
    const after = log.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((ids) => ids.includes("agent-a-import"))).toEqual([]);
  });

  it("an unresolved viewer immediately renders nothing", async () => {
    const log: string[][] = [];
    const Probe = probe(log);
    apiState.rows = [entry("agent-a-import")];

    const { rerender } = render(React.createElement(Probe, { viewer: AGENT, enabled: true }));
    await waitFor(() => expect(log.at(-1)).toEqual(["agent-a-import"]));

    const before = log.length;
    rerender(React.createElement(Probe, { viewer: null, enabled: true }));

    expect(log.slice(before).filter((ids) => ids.length > 0)).toEqual([]);
  });
});

describe("pagination — every authorized import must be reachable", () => {
  it("exposes hasMore and loads the next page without losing the first", async () => {
    apiState.pages = [
      Array.from({ length: 200 }, (_, i) => entry(`p1-${i}`)),
      Array.from({ length: 60 }, (_, i) => entry(`p2-${i}`)),
    ];
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.entries).toHaveLength(260);
    expect(result.current.entries[0].id).toBe("p1-0");
    expect(result.current.entries.at(-1)?.id).toBe("p2-59");
    expect(result.current.hasMore).toBe(false);
  });

  it("a short first page means there is nothing more to load", async () => {
    apiState.pages = [[entry("only")]];
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.hasMore).toBe(false);
  });

  it("a viewer change resets pagination — no page-2 rows from the previous viewer survive", async () => {
    apiState.pages = [
      Array.from({ length: 200 }, (_, i) => entry(`a-${i}`)),
      [entry("a-extra")],
    ];
    const { result, rerender } = renderHook(
      ({ viewer }) => useImportHistory({ viewer, enabled: true }),
      { initialProps: { viewer: AGENT } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.entries).toHaveLength(201);

    apiState.pages = [[entry("b-only")]];
    rerender({ viewer: OTHER_AGENT });

    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["b-only"]));
    expect(result.current.hasMore).toBe(false);
  });

  it("refresh() collapses back to the first page rather than silently keeping a stale tail", async () => {
    apiState.pages = [
      Array.from({ length: 200 }, (_, i) => entry(`p1-${i}`)),
      [entry("p2-0")],
    ];
    const { result } = renderHook(() => useImportHistory({ viewer: AGENT, enabled: true }));
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.entries).toHaveLength(201);

    apiState.pages = [[entry("fresh")]];
    await act(async () => { await result.current.refresh(); });

    expect(result.current.entries.map((e) => e.id)).toEqual(["fresh"]);
    expect(result.current.hasMore).toBe(false);
  });
});


describe("initial loading is derived synchronously, not after the effect", () => {
  // At aafe3ba the hook returned loading:false until its passive effect started the request, so an
  // enabled tab briefly rendered the legitimate-empty state before the first request even began.
  it("reports loading on the very FIRST render for an enabled, valid viewer", () => {
    apiState.defer = true;
    const log: { loading: boolean; entries: number; error: string | null }[] = [];
    function Probe() {
      const r = useImportHistory({ viewer: AGENT, enabled: true });
      log.push({ loading: r.loading, entries: r.entries.length, error: r.error });
      return null;
    }
    render(React.createElement(Probe));

    // No render before the first request settles may look like a real empty result.
    const emptyNonLoading = log.filter((f) => !f.loading && f.entries === 0 && f.error === null);
    expect(emptyNonLoading).toEqual([]);
    expect(log[0].loading).toBe(true);
  });

  it("does NOT report loading when the tab is disabled", () => {
    const log: boolean[] = [];
    function Probe() {
      log.push(useImportHistory({ viewer: AGENT, enabled: false }).loading);
      return null;
    }
    render(React.createElement(Probe));
    expect(log.every((v) => v === false)).toBe(true);
  });

  it("does NOT report loading without a resolved viewer", () => {
    const log: boolean[] = [];
    function Probe() {
      log.push(useImportHistory({ viewer: null, enabled: true }).loading);
      return null;
    }
    render(React.createElement(Probe));
    expect(log.every((v) => v === false)).toBe(true);
  });

  it("a viewer switch re-enters loading immediately, with no empty frame", async () => {
    apiState.rows = [entry("a")];
    const log: { loading: boolean; entries: number; error: string | null }[] = [];
    function Probe({ viewer }: { viewer: EffectiveViewer }) {
      const r = useImportHistory({ viewer, enabled: true });
      log.push({ loading: r.loading, entries: r.entries.length, error: r.error });
      return null;
    }
    const { rerender } = render(React.createElement(Probe, { viewer: AGENT }));
    await waitFor(() => expect(log.at(-1)?.entries).toBe(1));

    const before = log.length;
    apiState.defer = true;
    rerender(React.createElement(Probe, { viewer: OTHER_AGENT }));

    const after = log.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((f) => !f.loading && f.entries === 0 && f.error === null)).toEqual([]);
  });
});
