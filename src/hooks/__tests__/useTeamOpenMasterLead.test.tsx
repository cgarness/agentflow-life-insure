import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * useTeamOpenMasterLead — existing-authorization master reads only (mocked client, no database).
 * Rev 5: full-context identity (org + viewer + campaign lead + lead) with visit and request
 * generations. Stale STARTS and stale FINISHES are both rejected.
 */
const h = vi.hoisted(() => ({
  reads: [] as Array<{ table: string; filters: unknown[][] }>,
  pending: [] as Array<(v: { data: unknown; error: unknown }) => void>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const read = { table, filters: [] as unknown[][] };
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (...args: unknown[]) => { read.filters.push(args); return q; };
    q.maybeSingle = () => {
      h.reads.push(read);
      return new Promise((resolve) => h.pending.push(resolve));
    };
    return q;
  };
  return { supabase: { from } };
});

import { useTeamOpenMasterLead } from "@/hooks/useTeamOpenMasterLead";

type P = Parameters<typeof useTeamOpenMasterLead>[0];
type R = ReturnType<typeof useTeamOpenMasterLead>;
const ORG = "org-1";
const base = { enabled: true, organizationId: ORG, viewerId: "u1", campaignLeadId: "cl-1", leadId: "lead-1", embedded: null, claimed: false } as P;
const leadB = { ...base, campaignLeadId: "cl-2", leadId: "lead-2" } as P;
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: ORG, ...extra });
/** The identity handle the hook hands out for adopt(): the visit-bound context (rev 5). */
const ident = (r: R) => (r as unknown as { context?: unknown; key?: unknown }).context ?? (r as unknown as { key: unknown }).key;
const settle = () => new Promise((r) => setTimeout(r, 30));
const mount = (p: P, strict = false) =>
  renderHook((props: P) => useTeamOpenMasterLead(props), {
    initialProps: p,
    wrapper: strict ? ({ children }) => <React.StrictMode>{children}</React.StrictMode> : undefined,
  });

beforeEach(() => {
  h.reads = [];
  h.pending = [];
});

describe("useTeamOpenMasterLead — sources", () => {
  it("uses the loader's RLS-governed embed with no extra query", () => {
    const embedded = row("lead-1", { custom_fields: { Goal: "Term" } });
    const { result } = mount({ ...base, embedded });
    expect(result.current.status).toBe("loaded");
    expect(result.current.master).toBe(embedded);
    expect(h.reads).toEqual([]);
  });

  it("hidden by RLS → 'unavailable'; exactly ONE org-scoped re-read after the hard claim", async () => {
    const { result, rerender } = mount(base);
    expect(result.current.status).toBe("unavailable");
    rerender({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    expect(h.reads[0]).toEqual({ table: "leads", filters: [["id", "lead-1"], ["organization_id", ORG]] });
    await act(async () => h.pending[0]({ data: row("lead-1", { custom_fields: { Goal: "Term" } }), error: null }));
    expect(result.current.status).toBe("loaded");
  });

  it("claimed but still hidden → one automatic read, no polling; only Retry reads again", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    await act(async () => h.pending[0]({ data: null, error: null }));
    await settle();
    expect(result.current.status).toBe("unavailable");
    expect(h.reads).toHaveLength(1);
    act(() => void result.current.retry());
    expect(h.reads).toHaveLength(2);
  });

  it("a failed read is an explicit 'error', never a loaded empty record", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    await act(async () => h.pending[0]({ data: null, error: { message: "network" } }));
    expect(result.current.status).toBe("error");
    expect(result.current.master).toBeNull();
  });

  it("disabled (Personal) is inert", () => {
    const { result } = mount({ ...base, enabled: false, claimed: true });
    expect(result.current.master).toBeNull();
    expect(h.reads).toEqual([]);
  });
});

describe("useTeamOpenMasterLead — stale FINISH rejection", () => {
  it("A → B → A: the first A visit's late response never lands on the new A visit", async () => {
    const { result, rerender } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1)); // read #0 for visit A1
    rerender({ ...leadB });
    rerender({ ...base, claimed: false }); // visit A2 (same ids), not claimed yet → unavailable
    expect(result.current.status).toBe("unavailable");
    await act(async () => h.pending[0]({ data: row("lead-1", { first_name: "Old visit" }), error: null }));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.master).toBeNull();
  });

  it("two same-lead reads finishing in reverse order: the OLDER one never overwrites the newer", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    act(() => void result.current.retry()); // read #1 supersedes #0
    expect(h.reads).toHaveLength(2);
    await act(async () => h.pending[1]({ data: row("lead-1", { first_name: "Newer" }), error: null }));
    await act(async () => h.pending[0]({ data: row("lead-1", { first_name: "Older" }), error: null }));
    expect(result.current.master?.first_name).toBe("Newer");
  });

  it("an older read finishing after adopt() never replaces the confirmed saved row", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    act(() => result.current.adopt(ident(result.current) as never, row("lead-1", { first_name: "Saved" })));
    await act(async () => h.pending[0]({ data: row("lead-1", { first_name: "Stale read" }), error: null }));
    expect(result.current.master?.first_name).toBe("Saved");
  });

  it("an older read never clears a newer loading / error state", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    act(() => void result.current.retry());
    await act(async () => h.pending[1]({ data: null, error: { message: "boom" } }));
    expect(result.current.status).toBe("error");
    await act(async () => h.pending[0]({ data: null, error: null }));
    expect(result.current.status).toBe("error");
  });

  it("a wrong-row response (other lead id or other organization) is rejected", async () => {
    const { result } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    await act(async () => h.pending[0]({ data: { id: "lead-1", organization_id: "org-OTHER" }, error: null }));
    expect(result.current.master).toBeNull();
    expect(result.current.status).not.toBe("loaded");
    act(() => void result.current.retry());
    await act(async () => h.pending[1]({ data: row("lead-9"), error: null }));
    expect(result.current.master).toBeNull();
  });

  it("organization or viewer change starts a new visit: the old read never lands", async () => {
    const { result, rerender } = mount({ ...base, claimed: true, embedded: null });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    rerender({ ...base, viewerId: "u2" });
    await act(async () => h.pending[0]({ data: row("lead-1"), error: null }));
    expect(result.current.master).toBeNull();
    const second = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(2));
    second.rerender({ ...base, organizationId: "org-2" });
    await act(async () => h.pending[1]({ data: row("lead-1"), error: null }));
    expect(second.result.current.master).toBeNull();
  });

  it("unmount and disable invalidate in-flight reads without errors", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, rerender, unmount } = mount({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    rerender({ ...base, enabled: false });
    await act(async () => h.pending[0]({ data: row("lead-1"), error: null }));
    expect(result.current.master).toBeNull();
    unmount();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("useTeamOpenMasterLead — stale START rejection and first-render masking", () => {
  it("a retained old retry() never starts a read for the old lead under the new context", async () => {
    const { result, rerender } = mount(base);
    const oldRetry = result.current.retry;
    rerender({ ...leadB });
    act(() => void oldRetry());
    await settle();
    expect(h.reads.filter((r) => r.filters.some(([k, v]) => k === "id" && v === "lead-1"))).toEqual([]);
    expect(h.reads).toEqual([]);
  });

  it("the previous lead's row is never visible in the first render after a switch", () => {
    const embeddedA = row("lead-1", { first_name: "A" });
    const seen: unknown[] = [];
    const { rerender } = renderHook((p: P) => {
      const r = useTeamOpenMasterLead(p);
      seen.push(r.master);
      return r;
    }, { initialProps: { ...base, embedded: embeddedA } });
    seen.length = 0;
    rerender({ ...leadB, embedded: null });
    expect(seen[0]).toBeNull(); // first committed render already masked
  });

  it("a replacement authorized embed for the same lead supersedes the old one and in-flight reads", async () => {
    const e1 = row("lead-1", { first_name: "E1" });
    const e2 = row("lead-1", { first_name: "E2" });
    const { result, rerender } = mount({ ...base, embedded: e1 });
    act(() => void result.current.retry());
    rerender({ ...base, embedded: e2 });
    expect(result.current.master).toBe(e2);
    await act(async () => h.pending[0]({ data: row("lead-1", { first_name: "late read" }), error: null }));
    expect(result.current.master).toBe(e2);
  });

  it("StrictMode: one automatic claim read per visit, and a late read is still rejected", async () => {
    const { result, rerender } = mount({ ...base, claimed: true }, true);
    await waitFor(() => expect(h.reads.length).toBeGreaterThanOrEqual(1));
    await settle();
    const readsForVisit = h.reads.length;
    expect(readsForVisit).toBeLessThanOrEqual(2); // StrictMode may double-invoke effects once
    rerender({ ...leadB });
    for (const p of h.pending) await act(async () => p({ data: row("lead-1"), error: null }));
    expect(result.current.master).toBeNull();
  });
});
