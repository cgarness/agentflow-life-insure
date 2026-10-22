import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

type Response = { data: { name: string }[] | null; error: { message: string } | null };
const h = vi.hoisted(() => ({
  user: "user-a" as string | null,
  org: "org-a" as string | null,
  queries: [] as { org: string; resolve: (r: Response) => void }[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user ? { id: h.user } : null }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe("carriers");
      return {
        select: (columns: string) => {
          expect(columns).toBe("name");
          return {
            eq: (column: string, org: string) => {
              expect(column).toBe("organization_id");
              return { order: () => new Promise<Response>((resolve) => { h.queries.push({ org, resolve }); }) };
            },
          };
        },
      };
    },
  },
}));
import { useOrganizationCarriers } from "../useOrganizationCarriers";

const names = (...list: string[]) => ({ data: list.map((name) => ({ name })), error: null });

beforeEach(() => { h.user = "user-a"; h.org = "org-a"; h.queries = []; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useOrganizationCarriers", () => {
  it("does nothing while disabled or without a user and agency", () => {
    const { result, rerender } = renderHook(({ on }) => useOrganizationCarriers(on), { initialProps: { on: false } });
    expect(result.current.status).toBe("idle");
    h.org = null; rerender({ on: true });
    expect(result.current.status).toBe("idle");
    expect(h.queries).toHaveLength(0);
  });

  it("loads the current agency's carriers, sorted, and reports an empty list as ready", async () => {
    const { result } = renderHook(() => useOrganizationCarriers(true));
    expect(result.current).toMatchObject({ status: "loading", carriers: null });
    expect(h.queries.map((q) => q.org)).toEqual(["org-a"]);
    await act(async () => h.queries[0].resolve(names("zeta", "Aetna", " Banner ")));
    expect(result.current).toMatchObject({ status: "ready", carriers: ["Aetna", "Banner", "zeta"] });
  });

  it("reports an error and retries on request", async () => {
    const { result } = renderHook(() => useOrganizationCarriers(true));
    await act(async () => h.queries[0].resolve({ data: null, error: { message: "denied" } }));
    expect(result.current).toMatchObject({ status: "error", carriers: null });
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await act(async () => h.queries[1].resolve(names("Aetna")));
    expect(result.current).toMatchObject({ status: "ready", carriers: ["Aetna"] });
  });

  it("never shows or keeps a previous agency's list, and discards its late response", async () => {
    const { result, rerender } = renderHook(() => useOrganizationCarriers(true));
    await act(async () => h.queries[0].resolve(names("Org A Carrier")));
    expect(result.current.carriers).toEqual(["Org A Carrier"]);
    h.org = "org-b"; rerender();
    expect(result.current).toMatchObject({ status: "loading", carriers: null });
    h.org = "org-c"; rerender();
    await act(async () => h.queries[1].resolve(names("Org B Carrier")));
    expect(result.current).toMatchObject({ status: "loading", carriers: null });
    await act(async () => h.queries[2].resolve(names("Org C Carrier")));
    expect(result.current).toMatchObject({ status: "ready", carriers: ["Org C Carrier"] });
    expect(h.queries.map((q) => q.org)).toEqual(["org-a", "org-b", "org-c"]);
  });

  it("keeps the fresh list when a superseded request answers after it", async () => {
    const { result, rerender } = renderHook(() => useOrganizationCarriers(true));
    h.org = "org-b"; rerender();
    await act(async () => h.queries[1].resolve(names("Org B Carrier")));
    expect(result.current.carriers).toEqual(["Org B Carrier"]);
    await act(async () => h.queries[0].resolve(names("Org A Carrier")));
    expect(result.current).toMatchObject({ status: "ready", carriers: ["Org B Carrier"] });
  });

  it("reloads on every reopen instead of reusing the previous open's list", async () => {
    const { result, rerender } = renderHook(({ on }) => useOrganizationCarriers(on), { initialProps: { on: true } });
    await act(async () => h.queries[0].resolve(names("Removed Later")));
    rerender({ on: false });
    rerender({ on: true });
    expect(result.current).toMatchObject({ status: "loading", carriers: null });
    await act(async () => h.queries[1].resolve(names("Current")));
    expect(result.current.carriers).toEqual(["Current"]);
  });

  it("never renders a previous agency's list, not even for the render before effects run", async () => {
    const seen: { org: string | null; carriers: string[] | null }[] = [];
    const { rerender } = renderHook(() => { const r = useOrganizationCarriers(true); seen.push({ org: h.org, carriers: r.carriers }); return r; });
    await act(async () => h.queries[0].resolve(names("Org A Carrier")));
    h.org = "org-b"; rerender();
    expect(seen.filter((s) => s.org === "org-b").every((s) => s.carriers === null)).toBe(true);
    expect(seen.some((s) => s.org === "org-a" && s.carriers?.[0] === "Org A Carrier")).toBe(true);
  });

  it("treats a different signed-in user as a new scope", async () => {
    const { result, rerender } = renderHook(() => useOrganizationCarriers(true));
    await act(async () => h.queries[0].resolve(names("Aetna")));
    h.user = "user-b"; rerender();
    expect(result.current).toMatchObject({ status: "loading", carriers: null });
    await waitFor(() => expect(h.queries).toHaveLength(2));
  });

  it("discards a superseded retry's response", async () => {
    const { result } = renderHook(() => useOrganizationCarriers(true));
    await act(async () => h.queries[0].resolve({ data: null, error: { message: "offline" } }));
    act(() => result.current.retry());
    act(() => result.current.retry());
    await act(async () => h.queries[1].resolve(names("Stale")));
    expect(result.current.status).toBe("loading");
    await act(async () => h.queries[2].resolve(names("Fresh")));
    expect(result.current.carriers).toEqual(["Fresh"]);
  });
});
