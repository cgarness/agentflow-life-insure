import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  ids: {
    a: "00000000-0000-4000-8000-0000000000a1",
    b: "00000000-0000-4000-8000-0000000000b2",
    c: "00000000-0000-4000-8000-0000000000c3",
    org: "00000000-0000-4000-8000-0000000000d4",
    lead: "00000000-0000-4000-8000-0000000000e5",
    client: "00000000-0000-4000-8000-0000000000f6",
    client2: "00000000-0000-4000-8000-0000000000f7",
  },
  userId: "",
  profileId: "",
  role: "Agent",
  org: "",
  impersonating: false,
  perms: new Set<string>(),
  permLoading: false,
  permError: null as Error | null,
  fetchContext: vi.fn(),
  fetchOwner: vi.fn(),
  fetchProfile: vi.fn(),
  fetchTeam: vi.fn(),
  calls: [] as unknown[][],
  result: { data: null as unknown, error: null as unknown },
  rpcResult: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call: unknown[] = ["from", table];
    const builder = {
      select: (columns: string) => (call.push("select", columns), builder),
      eq: (column: string, value: unknown) => (call.push("eq", column, value), builder),
      maybeSingle: async () => {
        call.push("maybeSingle");
        h.calls.push(call);
        return h.result;
      },
    };
    return builder;
  };
  return { supabase: { from, rpc: async (name: string) => (h.calls.push(["rpc", name]), h.rpcResult) } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: h.userId ? { id: h.userId } : null,
    profile: h.profileId ? { id: h.profileId, role: h.role, organization_id: h.org } : null,
    isImpersonating: h.impersonating,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org, role: h.role }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canSeeCommission: (name: string) => h.perms.has(name),
    isLoading: h.permLoading,
    error: h.permError,
  }),
}));
vi.mock("@/lib/commission/api", () => ({ fetchCalculatorContext: () => h.fetchContext(), fetchCalculatorStatus: vi.fn() }));
vi.mock("@/lib/commission/previewApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCreditedOwner: (...args: unknown[]) => h.fetchOwner(...args),
  fetchCreditedAgentProfile: (...args: unknown[]) => h.fetchProfile(...args),
  fetchTeamScopeAgentIds: () => h.fetchTeam(),
}));

import { commissionCalculatorKeys } from "@/hooks/useCommissionCalculator";
import { policyCommissionPreviewKeys, usePolicyCommissionPreview, type PreviewOwner } from "@/hooks/usePolicyCommissionPreview";
import { OTHERS_COMMISSION_PERMISSION as OTHERS, OWN_COMMISSION_PERMISSION as OWN } from "@/lib/commission/policyPreview";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";

const { a: A, b: B, c: C, org: ORG, lead: LEAD, client: CLIENT, client2: CLIENT2 } = h.ids;
const profileOf = (id: string, name: string, level: string | null) => ({ id, firstName: "Synthetic", lastName: name, email: `${name}@example.test`, commissionLevel: level });
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function setup(owner: PreviewOwner | null, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ value }: { value: PreviewOwner | null }) => usePolicyCommissionPreview(value), { initialProps: { value: owner }, wrapper });
  return { client, ...hook };
}

beforeEach(() => {
  Object.assign(h, { userId: A, profileId: A, role: "Agent", org: ORG, impersonating: false, permLoading: false, permError: null });
  h.perms = new Set([OWN]);
  h.calls = [];
  h.result = { data: null, error: null };
  h.rpcResult = { data: null, error: null };
  for (const fn of [h.fetchContext, h.fetchOwner, h.fetchProfile, h.fetchTeam]) fn.mockReset();
  h.fetchContext.mockResolvedValue(syntheticContext("100"));
});
afterEach(cleanup);

const noRequests = () => {
  for (const fn of [h.fetchContext, h.fetchOwner, h.fetchProfile, h.fetchTeam]) expect(fn).not.toHaveBeenCalled();
};

describe("never under View As or without a commission permission", () => {
  it("issues no request and shows nothing under View As, even with every read cached", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(commissionCalculatorKeys.context(A, ORG), syntheticContext("100"));
    client.setQueryData(policyCommissionPreviewKeys.owner(A, ORG, "client", CLIENT, null), B);
    client.setQueryData(policyCommissionPreviewKeys.agent(A, ORG, B), profileOf(B, "B", "120"));
    Object.assign(h, { impersonating: true, profileId: B });
    h.perms = new Set([OWN, OTHERS]);
    for (const owner of [{ kind: "self" } as const, { kind: "client", id: CLIENT } as const]) {
      const { result, unmount } = setup(owner, client);
      await flush();
      expect(result.current.status).toBe("hidden");
      unmount();
    }
    noRequests();
  });

  it("requests nothing without either commission permission", async () => {
    h.perms = new Set();
    const { result } = setup({ kind: "client", id: CLIENT });
    await flush();
    expect(result.current.status).toBe("hidden");
    noRequests();
  });

  it("fails closed while permissions load or after a permission error", async () => {
    h.permLoading = true;
    const loading = setup({ kind: "self" });
    await flush();
    expect(loading.result.current.status).toBe("hidden");
    Object.assign(h, { permLoading: false, permError: new Error("permissions failed") });
    const failed = setup({ kind: "self" });
    await flush();
    expect(failed.result.current.status).toBe("hidden");
    noRequests();
  });

  it("requires the session user to be the resolved effective viewer", async () => {
    h.profileId = "";
    const unresolved = setup({ kind: "self" });
    await flush();
    expect(unresolved.result.current.status).toBe("hidden");
    h.profileId = B;
    const mismatched = setup({ kind: "self" });
    await flush();
    expect(mismatched.result.current.status).toBe("hidden");
    noRequests();
  });
});

describe("the signed-in user's own estimate", () => {
  it("uses the caller's own level for a new manual client with View Own only", async () => {
    const { result } = setup({ kind: "self" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ agentName: null, level: { kind: "valid", level: 100 } });
    expect(h.fetchOwner).not.toHaveBeenCalled();
    expect(h.fetchProfile).not.toHaveBeenCalled();
  });

  it("a lead the operator owns uses the operator's own level", async () => {
    h.fetchOwner.mockResolvedValue(A);
    const { result } = setup({ kind: "lead", id: LEAD, hint: A });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(h.fetchOwner).toHaveBeenCalledWith({ kind: "lead", id: LEAD }, ORG);
    expect(result.current).toMatchObject({ agentName: null, level: { kind: "valid", level: 100 } });
    expect(h.fetchProfile).not.toHaveBeenCalled();
  });

  it("View Others' alone never shows the operator's own estimate", async () => {
    Object.assign(h, { role: "Admin" });
    h.perms = new Set([OTHERS]);
    const { result } = setup({ kind: "self" });
    await flush();
    expect(result.current.status).toBe("hidden");
  });
});

describe("another agent's estimate", () => {
  it("an Admin with View Others' (and no View Own) sees the credited agent's level, never their own", async () => {
    Object.assign(h, { role: "Admin" });
    h.perms = new Set([OTHERS]);
    h.fetchOwner.mockResolvedValue(B);
    h.fetchProfile.mockResolvedValue(profileOf(B, "B", "120"));
    const { result } = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ agentName: "Synthetic B", level: { kind: "valid", level: 120 } });
    expect(h.fetchProfile).toHaveBeenCalledWith(B, ORG);
    expect(h.fetchTeam).not.toHaveBeenCalled();
  });

  it("View Own alone never reveals another agent's estimate", async () => {
    Object.assign(h, { role: "Admin" });
    h.fetchOwner.mockResolvedValue(B);
    const { result } = setup({ kind: "client", id: CLIENT });
    await flush();
    expect(result.current.status).toBe("hidden");
    expect(h.fetchProfile).not.toHaveBeenCalled();
  });

  it("a Team Leader sees only agents in their existing Contacts Team scope", async () => {
    Object.assign(h, { role: "Team Leader" });
    h.perms = new Set([OTHERS]);
    h.fetchOwner.mockResolvedValue(B);
    h.fetchProfile.mockResolvedValue(profileOf(B, "B", "120"));
    h.fetchTeam.mockResolvedValue([A, B]);
    const inScope = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(inScope.result.current.status).toBe("ready"));
    inScope.unmount();

    h.fetchProfile.mockClear();
    h.fetchTeam.mockResolvedValue([A]);
    const outside = setup({ kind: "client", id: CLIENT });
    await flush();
    expect(outside.result.current.status).toBe("hidden");
    expect(h.fetchProfile).not.toHaveBeenCalled();
    outside.unmount();

    h.fetchTeam.mockRejectedValue(new Error("scope failed"));
    const failed = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(failed.result.current).toMatchObject({ status: "unavailable", message: "Commission estimate unavailable" }));
    expect(h.fetchProfile).not.toHaveBeenCalled();
  });

  it("an Agent never sees another agent's estimate, whatever the permissions", async () => {
    h.perms = new Set([OWN, OTHERS]);
    h.fetchOwner.mockResolvedValue(B);
    const { result } = setup({ kind: "client", id: CLIENT });
    await flush();
    expect(result.current.status).toBe("hidden");
    expect(h.fetchTeam).not.toHaveBeenCalled();
    expect(h.fetchProfile).not.toHaveBeenCalled();
  });
});

describe("fails closed on owner, profile and grid data", () => {
  it("states 'No assigned agent' for an unassigned record and hides figures on owner errors", async () => {
    h.fetchOwner.mockResolvedValue(null);
    const unassigned = setup({ kind: "lead", id: LEAD, hint: null });
    await waitFor(() => expect(unassigned.result.current).toMatchObject({ status: "unavailable", message: "No assigned agent" }));
    unassigned.unmount();
    h.fetchOwner.mockRejectedValue(new Error("owner failed"));
    const failed = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(failed.result.current).toMatchObject({ status: "unavailable", message: "Commission estimate unavailable" }));
  });

  it("shows nothing usable for a missing, mismatched, unnamed or failed profile", async () => {
    Object.assign(h, { role: "Admin" });
    h.perms = new Set([OTHERS]);
    h.fetchOwner.mockResolvedValue(B);
    for (const profile of [null, profileOf(C, "C", "120"), { id: B, firstName: "", lastName: " ", email: "", commissionLevel: "120" }]) {
      h.fetchProfile.mockResolvedValue(profile);
      const view = setup({ kind: "client", id: CLIENT });
      await waitFor(() => expect(view.result.current).toMatchObject({ status: "unavailable" }));
      view.unmount();
    }
    h.fetchProfile.mockRejectedValue(new Error("profile failed"));
    const failed = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(failed.result.current).toMatchObject({ status: "unavailable" }));
  });

  it("hides the panel without a configured grid and reports a failed grid read", async () => {
    for (const status of ["not_configured", "no_access"]) {
      h.fetchContext.mockResolvedValue({ status });
      const view = setup({ kind: "self" });
      await flush();
      expect(view.result.current.status).toBe("hidden");
      view.unmount();
    }
    h.fetchContext.mockRejectedValue(new Error("grid failed"));
    const failed = setup({ kind: "self" });
    await waitFor(() => expect(failed.result.current).toMatchObject({ status: "unavailable" }));
  });
});

describe("stale responses and identity", () => {
  it("never shows a late profile of the previous credited agent for the next one", async () => {
    Object.assign(h, { role: "Admin" });
    h.perms = new Set([OTHERS]);
    h.fetchOwner.mockImplementation(async (source: { id: string }) => (source.id === CLIENT ? B : C));
    let releaseB: (value: unknown) => void = () => {};
    h.fetchProfile.mockImplementation((id: string) =>
      id === B ? new Promise((resolve) => { releaseB = resolve; }) : Promise.resolve(profileOf(C, "C", "130")),
    );
    const { result, rerender } = setup({ kind: "client", id: CLIENT });
    await waitFor(() => expect(h.fetchProfile).toHaveBeenCalledWith(B, ORG));
    expect(result.current.status).toBe("hidden");
    rerender({ value: { kind: "client", id: CLIENT2 } });
    await waitFor(() => expect(result.current).toMatchObject({ status: "ready", agentName: "Synthetic C", level: { level: 130 } }));
    releaseB(profileOf(B, "B", "120"));
    await flush();
    expect(result.current).toMatchObject({ status: "ready", agentName: "Synthetic C", level: { level: 130 } });
  });

  it("re-reads the stored lead owner when the caller's owner hint changes (e.g. a claim)", async () => {
    h.fetchOwner.mockResolvedValueOnce(null).mockResolvedValueOnce(A);
    const { result, rerender } = setup({ kind: "lead", id: LEAD, hint: null });
    await waitFor(() => expect(result.current).toMatchObject({ status: "unavailable", message: "No assigned agent" }));
    rerender({ value: { kind: "lead", id: LEAD, hint: A } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(h.fetchOwner).toHaveBeenCalledTimes(2);
  });

  it("changes identity with the viewer and the permission set", async () => {
    const first = setup({ kind: "self" });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const before = first.result.current.identity;
    h.perms = new Set([OWN, OTHERS]);
    first.rerender({ value: { kind: "self" } });
    expect(first.result.current.identity).not.toBe(before);
    h.org = "00000000-0000-4000-8000-0000000000d5";
    first.rerender({ value: { kind: "self" } });
    expect(first.result.current.identity).not.toContain(ORG);
  });
});

describe("read-only lookups are organization-scoped", () => {
  const api = () => vi.importActual<typeof import("@/lib/commission/previewApi")>("@/lib/commission/previewApi");

  it("reads the stored lead or client owner with maybeSingle in the viewer's organization", async () => {
    const { fetchCreditedOwner } = await api();
    h.result = { data: { assigned_agent_id: B }, error: null };
    await expect(fetchCreditedOwner({ kind: "lead", id: LEAD }, ORG)).resolves.toBe(B);
    h.result = { data: { assigned_agent_id: null }, error: null };
    await expect(fetchCreditedOwner({ kind: "client", id: CLIENT }, ORG)).resolves.toBeNull();
    expect(h.calls).toEqual([
      ["from", "leads", "select", "assigned_agent_id", "eq", "id", LEAD, "eq", "organization_id", ORG, "maybeSingle"],
      ["from", "clients", "select", "assigned_agent_id", "eq", "id", CLIENT, "eq", "organization_id", ORG, "maybeSingle"],
    ]);
  });

  it("refuses a missing row, a read error or a malformed owner", async () => {
    const { fetchCreditedOwner } = await api();
    h.result = { data: null, error: null };
    await expect(fetchCreditedOwner({ kind: "client", id: CLIENT }, ORG)).rejects.toMatchObject({ reason: "not_found" });
    h.result = { data: null, error: { message: "denied" } };
    await expect(fetchCreditedOwner({ kind: "client", id: CLIENT }, ORG)).rejects.toMatchObject({ reason: "failed" });
    h.result = { data: { assigned_agent_id: "not-a-uuid" }, error: null };
    await expect(fetchCreditedOwner({ kind: "client", id: CLIENT }, ORG)).rejects.toMatchObject({ reason: "failed" });
  });

  it("reads another agent's raw level (never defaulted) and returns null for no profile", async () => {
    const { fetchCreditedAgentProfile } = await api();
    h.result = { data: { id: B, first_name: "Synthetic", last_name: "B", email: "b@example.test", commission_level: null }, error: null };
    await expect(fetchCreditedAgentProfile(B, ORG)).resolves.toMatchObject({ id: B, commissionLevel: null });
    h.result = { data: { id: B, first_name: null, last_name: null, email: null, commission_level: "0%" }, error: null };
    await expect(fetchCreditedAgentProfile(B, ORG)).resolves.toMatchObject({ firstName: "", commissionLevel: "0%" });
    h.result = { data: null, error: null };
    await expect(fetchCreditedAgentProfile(B, ORG)).resolves.toBeNull();
    expect(h.calls[0]).toEqual([
      "from", "profiles", "select", "id, first_name, last_name, email, commission_level",
      "eq", "id", B, "eq", "organization_id", ORG, "maybeSingle",
    ]);
  });

  it("uses the existing Contacts Team-scope RPC and fails on its errors", async () => {
    const { fetchTeamScopeAgentIds } = await api();
    h.rpcResult = { data: [{ id: A, first_name: "S", last_name: "A" }, { id: B, first_name: "S", last_name: "B" }], error: null };
    await expect(fetchTeamScopeAgentIds()).resolves.toEqual([A, B]);
    h.rpcResult = { data: null, error: { message: "failed" } };
    await expect(fetchTeamScopeAgentIds()).rejects.toMatchObject({ reason: "failed" });
    expect(h.calls).toEqual([["rpc", "get_contact_scope_agents"], ["rpc", "get_contact_scope_agents"]]);
  });
});
