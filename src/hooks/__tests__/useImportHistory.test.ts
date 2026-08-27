/**
 * useImportHistory — tab gating, clear-on-viewer-change, stale-response rejection, error/retry.
 *
 * These are the guarantees the previous inline implementation had none of: it fetched once per
 * mount regardless of tab, never cleared on a viewer change, had no request-generation guard, and
 * swallowed every error.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const apiState = vi.hoisted(() => ({
  calls: [] as { organizationId: string | null; viewerId: string | null; orgWide: boolean }[],
  rows: [] as unknown[],
  error: null as Error | null,
  /** When true, each call returns a promise the test settles by hand. */
  defer: false,
  pending: [] as { resolve: (rows: unknown[]) => void; reject: (e: Error) => void }[],
}));

vi.mock("@/lib/supabase-import-history", () => ({
  listImportHistory: (p: { organizationId: string | null; viewerId: string | null; orgWide: boolean }) => {
    apiState.calls.push(p);
    if (apiState.defer) {
      return new Promise((resolve, reject) => { apiState.pending.push({ resolve, reject }); });
    }
    if (apiState.error) return Promise.reject(apiState.error);
    return Promise.resolve(apiState.rows);
  },
  IMPORT_HISTORY_LIMIT: 200,
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
    expect(apiState.calls[0]).toEqual({ organizationId: ORG, viewerId: "agent-1", orgWide: false });
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
    expect(apiState.calls[0]).toEqual({ organizationId: ORG, viewerId: "agent-1", orgWide: false });
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
