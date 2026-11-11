import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Response = { data: unknown[] | null; error: { message: string } | null };
const h = vi.hoisted(() => ({
  user: "user-a" as string | null, org: "org-a" as string | null, profileId: "user-a", role: "Agent", viewAs: false,
  loading: false, permissionError: null as Error | null, allowed: true,
  queries: [] as { org: string; resolve: (response: Response) => void }[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user ? { id: h.user } : null, profile: { id: h.profileId, role: h.role, organization_id: h.org }, isImpersonating: h.viewAs }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: h.loading, error: h.permissionError, hasPageAccess: () => h.allowed }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  expect(table).toBe("carriers");
  return { select: (columns: string) => {
    expect(columns).toBe("id,name,portal_url,logo_url,contact_phones,contact_emails,resource_links");
    return { eq: (column: string, org: string) => {
      expect(column).toBe("organization_id");
      return { order: () => new Promise<Response>((resolve) => { h.queries.push({ org, resolve }); }) };
    } };
  } };
} } }));
import { CARRIER_DIRECTORY_QUERY_KEY, useCarrierDirectory } from "../useCarrierDirectory";

const response = (name?: string): Response => ({ data: name ? [{ id: name, name, portal_url: null, logo_url: null, contact_phones: [], contact_emails: [], resource_links: [] }] : [], error: null });
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
beforeEach(() => { Object.assign(h, { user: "user-a", profileId: "user-a", org: "org-a", role: "Agent", viewAs: false, loading: false, permissionError: null, allowed: true, queries: [] }); });
afterEach(cleanup);

describe("carrier directory scope", () => {
  it.each(["no-user", "no-org", "wrong-profile", "unknown-role", "view-as", "pending", "denied", "failed"])("issues no resource read when %s", (reason) => {
    if (reason === "no-user") h.user = null;
    if (reason === "no-org") h.org = null;
    if (reason === "wrong-profile") h.profileId = "previous-user";
    if (reason === "unknown-role") h.role = "Unrecognized";
    if (reason === "view-as") h.viewAs = true;
    if (reason === "pending") h.loading = true;
    if (reason === "denied") h.allowed = false;
    if (reason === "failed") h.permissionError = new Error("offline");
    const { result } = renderHook(useCarrierDirectory, setup());
    expect(result.current).toMatchObject({ status: "unavailable", carriers: [] });
    expect(h.queries).toHaveLength(0);
  });
  it("permits a resolved Admin without waiting for configurable role permissions", async () => {
    h.role = "Admin"; h.loading = true;
    const { result } = renderHook(useCarrierDirectory, setup());
    await act(async () => h.queries[0].resolve(response()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.carriers).toEqual([]);
  });
  it("surfaces failures and retries without inventing an empty success", async () => {
    const { result } = renderHook(useCarrierDirectory, setup());
    await act(async () => h.queries[0].resolve({ data: null, error: { message: "missing resource column" } }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await act(async () => h.queries[1].resolve(response("Current")));
    await waitFor(() => expect(result.current.carriers[0]?.name).toBe("Current"));
  });
  it("never renders stale A data during A→B→A or a late response", async () => {
    const seen: { phase: string; names: string[] }[] = [];
    let phase = "initial";
    const { result, rerender } = renderHook(() => {
      const value = useCarrierDirectory();
      seen.push({ phase, names: value.carriers.map((row) => row.name) });
      return value;
    }, setup());
    await act(async () => h.queries[0].resolve(response("Old A")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    phase = "changed"; h.org = "org-b"; rerender();
    h.org = "org-a"; rerender();
    await act(async () => h.queries[1].resolve(response("Late B")));
    expect(seen.filter((row) => row.phase === "changed").every((row) => row.names.length === 0)).toBe(true);
    await act(async () => h.queries[2].resolve(response("Fresh A")));
    await waitFor(() => expect(result.current.carriers[0]?.name).toBe("Fresh A"));
  });
  it("hides rows immediately on access loss, identity change, and View As", async () => {
    const { result, rerender } = renderHook(useCarrierDirectory, setup());
    await act(async () => h.queries[0].resolve(response("Private")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    h.allowed = false; rerender();
    expect(result.current.carriers).toEqual([]);
    h.allowed = true; h.user = "user-b"; h.profileId = "user-b"; rerender();
    expect(result.current.carriers).toEqual([]);
    h.viewAs = true; rerender();
    await act(async () => h.queries[1].resolve(response("Late")));
    expect(result.current).toMatchObject({ status: "unavailable", carriers: [] });
  });
  it("refreshes on an acknowledged Settings invalidation and rejects malformed server rows", async () => {
    const options = setup();
    const { result } = renderHook(useCarrierDirectory, options);
    await act(async () => h.queries[0].resolve(response("Before")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => { void options.client.invalidateQueries({ queryKey: CARRIER_DIRECTORY_QUERY_KEY }); });
    await act(async () => h.queries[1].resolve({ data: [{ ...(response("After").data![0] as object), resource_links: [{ url: "javascript:bad" }] }], error: null }));
    await waitFor(() => expect(result.current).toMatchObject({ status: "error", carriers: [] }));
  });
});
