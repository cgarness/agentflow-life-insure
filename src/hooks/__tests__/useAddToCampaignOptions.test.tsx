import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

type Row = {
  id: string; name: string; type: string; status: string;
  user_id: string | null; assigned_agent_ids: string[]; total_leads: number;
};
type Response = { data: Row[] | null; error: { message: string } | null };
const h = vi.hoisted(() => ({
  queries: [] as { org: string; signal: AbortSignal; resolve: (r: Response) => void }[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe("campaigns");
      let org = "";
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => { if (column === "organization_id") org = value; return chain; },
        order: () => chain,
        abortSignal: (signal: AbortSignal) =>
          new Promise<Response>((resolve) => { h.queries.push({ org, signal, resolve }); }),
      };
      return chain;
    },
  },
}));
import { useAddToCampaignOptions } from "../useAddToCampaignOptions";

const openPool = (name: string): Row => ({
  id: name, name, type: "Open Pool", status: "Active", user_id: "admin", assigned_agent_ids: [], total_leads: 1,
});
const rows = (...names: string[]) => ({ data: names.map(openPool), error: null });

type Props = { open: boolean; orgId: string | null; userId: string | null };
type Seen = { phase: string; status: string; names: string[] };
const A: Props = { open: true, orgId: "org-a", userId: "user-a" };

// Records EVERY render's result, including renders before effects run (the PR #479 review standard).
function recordRenders(initial: Props) {
  const seen: Seen[] = [];
  let phase = "first-open";
  const view = renderHook((p: Props) => {
    const r = useAddToCampaignOptions({ ...p, profileRole: "Agent", isSuperAdmin: false });
    seen.push({ phase, status: r.status, names: r.options.map((o) => o.name) });
    return r;
  }, { initialProps: initial });
  return { seen, view, setPhase: (next: string) => { phase = next; } };
}
const after = (seen: Seen[], phase: string) => seen.filter((s) => s.phase === phase);

beforeEach(() => { h.queries = []; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useAddToCampaignOptions — every render", () => {
  it("never returns the previous open's list while closed or after a same-identity reopen", async () => {
    const { seen, view, setPhase } = recordRenders(A);
    await act(async () => h.queries[0].resolve(rows("List A")));
    expect(view.result.current.options.map((o) => o.name)).toEqual(["List A"]);

    setPhase("closed"); view.rerender({ ...A, open: false });
    setPhase("reopened"); view.rerender(A);
    await act(async () => {});
    expect(h.queries).toHaveLength(2); // the reopen is a fresh read
    expect(after(seen, "reopened").length).toBeGreaterThan(0);
    expect(after(seen, "reopened").every((s) => s.status === "loading" && s.names.length === 0)).toBe(true);

    setPhase("resolved");
    await act(async () => h.queries[1].resolve(rows("List B")));
    expect(view.result.current).toMatchObject({ status: "ready" });
    expect(view.result.current.options.map((o) => o.name)).toEqual(["List B"]);
    expect(seen.filter((s) => s.phase !== "first-open").some((s) => s.names.includes("List A"))).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never renders another organization's or user's campaigns, even before effects run", async () => {
    const { seen, view, setPhase } = recordRenders(A);
    await act(async () => h.queries[0].resolve(rows("Org A")));

    setPhase("org-b"); view.rerender({ ...A, orgId: "org-b" });
    expect(after(seen, "org-b").every((s) => s.status === "loading" && s.names.length === 0)).toBe(true);
    setPhase("user-b"); view.rerender({ ...A, orgId: "org-b", userId: "user-b" });
    expect(after(seen, "user-b").every((s) => s.status === "loading" && s.names.length === 0)).toBe(true);

    // The org-b read for user-a was superseded by the user change: aborted, and its late answer is ignored.
    expect(h.queries.map((q) => [q.org, q.signal.aborted])).toEqual([["org-a", true], ["org-b", true], ["org-b", false]]);
    await act(async () => h.queries[1].resolve(rows("Org B for user A")));
    expect(view.result.current.status).toBe("loading");
    await act(async () => h.queries[2].resolve(rows("Org B for user B")));
    expect(view.result.current.options.map((o) => o.name)).toEqual(["Org B for user B"]);
    expect(seen.some((s) => s.names.includes("Org B for user A"))).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("A→B→A before B resolves: back on A is loading until A's new read, and B's late answer is dropped", async () => {
    const { seen, view, setPhase } = recordRenders(A);
    await act(async () => h.queries[0].resolve(rows("Org A Old")));
    setPhase("on-b"); view.rerender({ ...A, orgId: "org-b" });
    setPhase("back-on-a"); view.rerender(A);
    await act(async () => {});
    expect(h.queries.map((q) => q.org)).toEqual(["org-a", "org-b", "org-a"]);
    await act(async () => h.queries[1].resolve(rows("Org B Late")));
    expect(after(seen, "back-on-a").every((s) => s.status === "loading" && s.names.length === 0)).toBe(true);

    setPhase("a-resolved");
    await act(async () => h.queries[2].resolve(rows("Org A New")));
    expect(view.result.current.options.map((o) => o.name)).toEqual(["Org A New"]);
    expect(seen.filter((s) => s.phase !== "first-open")
      .some((s) => s.names.includes("Org A Old") || s.names.includes("Org B Late"))).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("discards a superseded retry's response", async () => {
    const { view } = recordRenders(A);
    await act(async () => h.queries[0].resolve({ data: null, error: { message: "offline" } }));
    expect(view.result.current.status).toBe("error");
    act(() => view.result.current.retry());
    act(() => view.result.current.retry());
    await act(async () => h.queries[1].resolve(rows("Stale")));
    expect(view.result.current.status).toBe("loading");
    await act(async () => h.queries[2].resolve(rows("Fresh")));
    expect(view.result.current.options.map((o) => o.name)).toEqual(["Fresh"]);
  });

  it("sends no read while closed or without an organization", () => {
    const { view } = recordRenders({ ...A, open: false });
    expect(h.queries).toHaveLength(0);
    view.rerender({ ...A, orgId: null });
    expect(view.result.current.status).toBe("unavailable");
    expect(h.queries).toHaveLength(0);
  });
});
