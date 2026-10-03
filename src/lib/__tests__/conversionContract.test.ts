import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    rpc: [] as Array<{ name: string; args: any }>,
    rpcResult: { data: null as any, error: null as any },
    notifyError: null as unknown,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      state.rpc.push({ name, args });
      return Promise.resolve(name === "notify_win" ? { data: 1, error: state.notifyError } : state.rpcResult);
    },

  },
}));

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
  soldDate: "2026-01-02", effectiveDate: "2026-02-03",
  draftDate: "2026-02-15", paymentFrequency: "monthly",
  beneficiaryName: "B", beneficiaryRelationship: "Spouse", beneficiaryPhone: "5553334444",
  notes: "conv note",
} as any;

beforeEach(() => {
  state.rpc.length = 0;
  state.rpcResult = { data: { client_id: "33333333-3333-3333-3333-333333333333", idempotent: false, win_ids: ["win-1", "win-2"] }, error: null };
  state.notifyError = null;
});

describe("conversionSupabaseApi.convertLeadToClient", () => {
  it("calls convert_lead_to_client_with_sales with p_lead_id + canonical p_client (never premium_amount)", async () => {
    const id = await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", "camp-1");
    expect(id).toBe("33333333-3333-3333-3333-333333333333");
    expect(state.rpc.filter(r => r.name !== "notify_win")).toHaveLength(1);
    expect(state.rpc[0].name).toBe("convert_lead_to_client_with_sales");
    expect(state.rpc[0].args.p_lead_id).toBe(LEAD.id);
    const pc = state.rpc[0].args.p_client;
    expect(pc.policy_type).toBe("IUL");
    expect(pc.premium).toBe(125.5);            // parsed number
    expect(pc.face_amount).toBe(500000);
    expect(pc.sold_date).toBe("2026-01-02");   // business sale date
    expect(pc.effective_date).toBe("2026-02-03");
    expect(pc.draft_date).toBe("2026-02-15");
    expect(pc.payment_frequency).toBe("monthly"); // canonical value
    expect(pc.issue_date).toBeNull();          // legacy storage — the modal no longer collects it
    expect(pc.policy_number).toBe("P-1");
    expect(pc.beneficiary_name).toBe("B");
    expect(pc.custom_fields).toEqual({ foo: "bar" });
    expect("premium_amount" in pc).toBe(false);  // canon: never premium_amount
    expect("organization_id" in pc).toBe(false); // org is derived server-side, never caller-supplied
  });

  it("normalizes payment frequency to canonical values and blanks unknowns to null", async () => {
    await conversionSupabaseApi.convertLeadToClient(LEAD, { ...POLICY, paymentFrequency: "Semi-Annual" }, "org-1", null);
    expect(state.rpc[0].args.p_client.payment_frequency).toBe("semi_annual");
    state.rpc.length = 0;
    await conversionSupabaseApi.convertLeadToClient(LEAD, { ...POLICY, paymentFrequency: "biweekly" }, "org-1", null);
    expect(state.rpc[0].args.p_client.payment_frequency).toBeNull();
    state.rpc.length = 0;
    await conversionSupabaseApi.convertLeadToClient(LEAD, { ...POLICY, soldDate: "", draftDate: "", paymentFrequency: "" }, "org-1", null);
    expect(state.rpc[0].args.p_client.sold_date).toBeNull();
    expect(state.rpc[0].args.p_client.draft_date).toBeNull();
    expect(state.rpc[0].args.p_client.payment_frequency).toBeNull();
  });

  it("notifies every recorded policy after the successful transaction without inserting browser wins", async () => {
    await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1", "camp-1");
    expect(state.rpc.map(r => r.name)).toEqual(["convert_lead_to_client_with_sales", "notify_win", "notify_win"]);
    expect(state.rpc.slice(1).map(r => r.args.p_win_id)).toEqual(["win-1", "win-2"]);
    expect(state.rpc[0].args.p_expected_org).toBe("org-1");
    expect(state.rpc[0].args.p_campaign_id).toBe("camp-1");
  });
  it("a retry re-notifies the same recorded wins", async () => {
    state.rpcResult.data.idempotent = true;
    await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1");
    expect(state.rpc.slice(1).map(r => r.args.p_win_id)).toEqual(["win-1", "win-2"]);
  });
  it("legacy conversions with no win receipt are not backfilled", async () => {
    state.rpcResult.data.win_ids = [];
    state.rpcResult.data.idempotent = true;
    await conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1");
    expect(state.rpc).toHaveLength(1);
  });
  it("returns the saved client despite notification failure", async () => {
    state.notifyError = new Error("delivery failed");
    await expect(conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1"))
      .resolves.toBe("33333333-3333-3333-3333-333333333333");
  });
  it("passes additional policies verbatim into the atomic save", async () => {
    const extra = [{ policyType: "Term", carrier: "Extra", policyNumber: "P2", faceAmount: "", premiumAmount: "$42.00", soldDate: "2026-01-02", effectiveDate: null }];
    await conversionSupabaseApi.convertLeadToClient(LEAD, { ...POLICY, additionalPolicies: extra }, "org-1");
    expect(state.rpc[0].args.p_client.custom_fields).toEqual({ foo: "bar", additional_policies: extra });
  });
  it("throws on transaction failure and never reports a celebration", async () => {
    state.rpcResult = { data: null, error: { message: "win_storage_failed" } };
    await expect(conversionSupabaseApi.convertLeadToClient(LEAD, POLICY, "org-1")).rejects.toThrow(/win_storage_failed/);
    expect(state.rpc).toHaveLength(1);
  });
  it("rejects missing org before requesting a save", async () => {
    await expect(conversionSupabaseApi.convertLeadToClient(LEAD, POLICY)).rejects.toThrow(/organization/);
    expect(state.rpc).toHaveLength(0);
  });
});
