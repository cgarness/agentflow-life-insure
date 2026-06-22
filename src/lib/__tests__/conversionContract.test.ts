import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    rpc: [] as Array<{ name: string; args: any }>,
    rpcResult: { data: null as any, error: null as any },
    profileRow: { first_name: "Dana", last_name: "Agent" } as any,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      state.rpc.push({ name, args });
      return Promise.resolve(state.rpcResult);
    },
    from: (_t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.profileRow, error: null }),
        }),
      }),
    }),
  },
}));

const triggerWinMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/win-trigger", () => ({ triggerWin: triggerWinMock }));

import { conversionSupabaseApi } from "@/lib/supabase-conversion";

const LEAD = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Pat", lastName: "Lee", phone: "5551112222", email: "p@x.com",
  assignedAgentId: "22222222-2222-2222-2222-222222222222",
  notes: "lead note", customFields: { foo: "bar" },
} as any;

const POLICY = {
  policyType: "IUL", carrier: "Acme", policyNumber: "P-1",
  premiumAmount: "$125.50", faceAmount: "500,000",
  issueDate: "2026-01-02", effectiveDate: "2026-02-03",
  beneficiaryName: "B", beneficiaryRelationship: "Spouse", beneficiaryPhone: "5553334444",
  notes: "conv note",
} as any;

beforeEach(() => {
  state.rpc.length = 0;
  state.rpcResult = { data: { client_id: "33333333-3333-3333-3333-333333333333", idempotent: false }, error: null };
  state.profileRow = { first_name: "Dana", last_name: "Agent" };
  triggerWinMock.mockReset();
  triggerWinMock.mockResolvedValue(undefined);
});

describe("conversionSupabaseApi.convertLeadToClient", () => {
  it("calls convert_lead_to_client_atomic with p_lead_id + canonical p_client (never premium_amount)", async () => {
    const id = await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", "camp-1");
    expect(id).toBe("33333333-3333-3333-3333-333333333333");
    expect(state.rpc).toHaveLength(1);
    expect(state.rpc[0].name).toBe("convert_lead_to_client_atomic");
    expect(state.rpc[0].args.p_lead_id).toBe(LEAD.id);
    const pc = state.rpc[0].args.p_client;
    expect(pc.policy_type).toBe("IUL");
    expect(pc.premium).toBe(125.5);            // parsed number
    expect(pc.face_amount).toBe(500000);
    expect(pc.issue_date).toBe("2026-01-02");
    expect(pc.effective_date).toBe("2026-02-03");
    expect(pc.policy_number).toBe("P-1");
    expect(pc.beneficiary_name).toBe("B");
    expect(pc.custom_fields).toEqual({ foo: "bar" });
    expect("premium_amount" in pc).toBe(false);  // canon: never premium_amount
    expect("organization_id" in pc).toBe(false); // org is derived server-side, never caller-supplied
  });

  it("creates the win after commit with the conversion idempotency key + real agent name", async () => {
    await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", "camp-1");
    expect(triggerWinMock).toHaveBeenCalledTimes(1);
    const arg = triggerWinMock.mock.calls[0][0];
    expect(arg.idempotencyKey).toBe(`conversion:${LEAD.id}`);
    expect(arg.agentName).toBe("Dana Agent");   // resolved from profiles, no "Agent" fallback
    expect(arg.agentId).toBe(LEAD.assignedAgentId);
    expect(arg.contactId).toBe("33333333-3333-3333-3333-333333333333");
    expect(arg.premiumAmount).toBe(125.5);
    expect(arg.policyType).toBe("IUL");
  });

  it("does NOT create a win on an idempotent retry (existing client)", async () => {
    state.rpcResult = { data: { client_id: "33333333-3333-3333-3333-333333333333", idempotent: true }, error: null };
    const id = await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", null);
    expect(id).toBe("33333333-3333-3333-3333-333333333333");
    expect(triggerWinMock).not.toHaveBeenCalled();
  });

  it("returns the client id even if win celebration throws (no rollback of the committed conversion)", async () => {
    triggerWinMock.mockRejectedValueOnce(new Error("celebration boom"));
    const id = await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", null);
    expect(id).toBe("33333333-3333-3333-3333-333333333333");
  });

  it("throws when the atomic RPC returns an error", async () => {
    state.rpcResult = { data: null, error: { message: "lead_not_found" } };
    await expect(conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", null)).rejects.toThrow(/lead_not_found/);
    expect(triggerWinMock).not.toHaveBeenCalled();
  });
});
