import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/** useTeamOpenMasterLead — existing-authorization master reads only (mocked client, no database). */
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
const base: P = { enabled: true, campaignLeadId: "cl-1", leadId: "lead-1", organizationId: "org-1", embedded: null, claimed: false };

beforeEach(() => {
  h.reads = [];
  h.pending = [];
});

describe("useTeamOpenMasterLead", () => {
  it("uses the loader's RLS-governed embed with no extra query", () => {
    const embedded = { id: "lead-1", custom_fields: { Goal: "Term" } };
    const { result } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, embedded } });
    expect(result.current.status).toBe("loaded");
    expect(result.current.master).toBe(embedded);
    expect(h.reads).toEqual([]);
  });

  it("hidden by RLS → 'unavailable' (never an empty contact); one org-scoped re-read after the hard claim", async () => {
    const { result, rerender } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: base });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.master).toBeNull();
    expect(h.reads).toEqual([]);
    rerender({ ...base, claimed: true });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    expect(h.reads[0]).toEqual({ table: "leads", filters: [["id", "lead-1"], ["organization_id", "org-1"]] });
    await act(async () => h.pending[0]({ data: { id: "lead-1", custom_fields: { Goal: "Term" } }, error: null }));
    expect(result.current.status).toBe("loaded");
    expect(result.current.master).toEqual({ id: "lead-1", custom_fields: { Goal: "Term" } });
  });

  it("a failed read is an explicit 'error' (retryable), not a loaded empty record", async () => {
    const { result } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, claimed: true } });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    await act(async () => h.pending[0]({ data: null, error: { message: "network" } }));
    expect(result.current.status).toBe("error");
    expect(result.current.master).toBeNull();
    act(() => void result.current.retry());
    expect(h.reads).toHaveLength(2);
  });

  it("drops a late read after the lead changed, and never carries the previous lead's row", async () => {
    const { result, rerender } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, claimed: true } });
    await waitFor(() => expect(h.reads).toHaveLength(1));
    rerender({ ...base, campaignLeadId: "cl-2", leadId: "lead-2", claimed: false });
    await act(async () => h.pending[0]({ data: { id: "lead-1", first_name: "Old" }, error: null }));
    expect(result.current.key).toBe("cl-2:lead-2");
    expect(result.current.status).toBe("unavailable");
    expect(result.current.master).toBeNull();
  });

  it("adopt() applies a saved row only to the identity it was saved against", () => {
    const { result, rerender } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, embedded: { id: "lead-1" } } });
    act(() => result.current.adopt("cl-1:lead-1", { id: "lead-1", first_name: "Saved" }));
    expect(result.current.master).toEqual({ id: "lead-1", first_name: "Saved" });
    rerender({ ...base, campaignLeadId: "cl-2", leadId: "lead-2", embedded: null });
    act(() => result.current.adopt("cl-1:lead-1", { id: "lead-1", first_name: "Late" }));
    expect(result.current.master).toBeNull();
  });

  it("an embed whose id does not match the lead is not trusted; disabled (Personal) is inert", () => {
    const { result } = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, embedded: { id: "other" } } });
    expect(result.current.status).toBe("unavailable");
    const personal = renderHook((p: P) => useTeamOpenMasterLead(p), { initialProps: { ...base, enabled: false, claimed: true } });
    expect(personal.result.current.key).toBeNull();
    expect(h.reads).toEqual([]);
  });
});
