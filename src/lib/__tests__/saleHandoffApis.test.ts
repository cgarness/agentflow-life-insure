import { beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, JSON.parse(JSON.stringify(args))]);
      if (name === "notify_win") return { data: 1, error: null };
      const client = { id: "00000000-0000-4000-8000-0000000000c1", first_name: "Pat", last_name: "Lee", premium: 50 };
      return { data: { client, client_id: client.id, win_ids: ["00000000-0000-4000-8000-0000000000d1"], idempotent: false,
        commission: { status: "evidence_recorded", slots: [] } }, error: null };
    },
  },
}));

import { conversionSupabaseApi, type LeadConversionPayload } from "../supabase-conversion";
import { recordClientPolicy, recordClientPolicyHandoff, type PolicyEntry } from "../policySaleRecording";
import { clientsSupabaseApi } from "../supabase-clients";
import { newSaleAttempt } from "../policySaleOutcome";
import { commissionPayload, type CommissionSlotInputs } from "../commission/capture";
import type { Client, Lead } from "../types";

const REQUEST = "00000000-0000-4000-8000-0000000000a1";
const ORG = "00000000-0000-4000-8000-0000000000e1";
const INPUTS: CommissionSlotInputs = {
  credited_agent_id: "00000000-0000-4000-8000-0000000000b1", grid_id: "00000000-0000-4000-8000-0000000000b2", grid_revision: 3,
  product_id: "00000000-0000-4000-8000-0000000000b3", variant_id: "00000000-0000-4000-8000-0000000000b4", insured_age: 60,
  term_years: null, contract_level: 100, rate_percent: "110.00", monthly_premium: "100", first_year_cents: 132000, advance_cents: 99000,
};
const COMMISSION = commissionPayload([{ slot: "primary", inputs: INPUTS }]);
const callsTo = (name: string) => h.calls.filter(([n]) => n === name).map(([, args]) => args);
const withoutCommission = ({ p_commission: _c, ...rest }: Record<string, unknown>) => rest;

beforeEach(() => { h.calls = []; });

describe("sale companions send exactly the unchanged writers' arguments", () => {
  it("conversion (primary plus a row that keeps its own UUID as policy identity)", async () => {
    const lead = { id: "00000000-0000-4000-8000-0000000000f1", firstName: "Pat", lastName: "Lee", notes: "", customFields: { hobby: "golf" } } as unknown as Lead;
    const payload: LeadConversionPayload = {
      policyType: "Final Expense", carrier: "Synthetic Carrier", policyNumber: "P-1", faceAmount: "10,000", premiumAmount: "$100.00",
      soldDate: "2026-10-03", effectiveDate: "", draftDate: "", paymentFrequency: "monthly",
      additionalPolicies: [{ policyId: "00000000-0000-4000-8000-0000000000f2", policyType: "Term", carrier: "Synthetic Carrier", policyNumber: "",
        faceAmount: "", premiumAmount: "50", soldDate: "2026-10-03", effectiveDate: null }],
    };
    await conversionSupabaseApi.convertLeadToClient(lead, payload, ORG, null);
    const result = await conversionSupabaseApi.convertLeadToClientHandoff(newSaleAttempt(), lead, payload, ORG, null, REQUEST, COMMISSION);
    const [legacy] = callsTo("convert_lead_to_client_with_sales");
    const [companion] = callsTo("convert_lead_to_client_with_sales_handoff");
    expect(withoutCommission(companion)).toEqual({ ...legacy, p_request_id: REQUEST });
    expect(companion.p_commission).toEqual(COMMISSION);
    expect((legacy.p_client as { custom_fields: { additional_policies: Array<{ policyId: string }> } }).custom_fields.additional_policies[0].policyId)
      .toBe("00000000-0000-4000-8000-0000000000f2");
    expect(result.clientId).toBe(CLIENT);
  });

  it("Record Policy", async () => {
    const policy: PolicyEntry = { policy_type: "Term", carrier: "Synthetic Carrier", policy_number: "T-1", premium: 58.45, sold_date: "2026-09-28", sale_mode: "new" };
    await recordClientPolicy(REQUEST, CLIENT, policy, false);
    await recordClientPolicyHandoff(newSaleAttempt(), REQUEST, CLIENT, policy, false, COMMISSION);
    const [legacy] = callsTo("record_client_policy");
    const [companion] = callsTo("record_client_policy_handoff");
    expect(withoutCommission(companion)).toEqual(legacy);
  });

  it("new client with a sale, including the historical flag", async () => {
    const data = { firstName: "Pat", lastName: "Lee", phone: "5551234567", email: "", policyType: "Term", carrier: "Synthetic Carrier",
      premiumAmount: "$50.00", soldDate: "2026-10-03", assignedAgentId: "00000000-0000-4000-8000-0000000000b1" } as unknown as Omit<Client, "id" | "createdAt" | "updatedAt">;
    const sale = { requestId: REQUEST, recordSale: true, historical: true };
    await clientsSupabaseApi.create(data, ORG, sale);
    const saved = await clientsSupabaseApi.create(data, ORG, { ...sale, commission: COMMISSION, attempt: newSaleAttempt() });
    const [legacy] = callsTo("create_client_with_sale");
    const [companion] = callsTo("create_client_with_sale_handoff");
    expect(withoutCommission(companion)).toEqual(legacy);
    expect(saved.id).toBe(CLIENT);
    expect(callsTo("notify_win")).toHaveLength(0);
  });

  it("first-policy edit (updated_at is set per call and excluded from the server's hash)", async () => {
    const data: Partial<Client> = { carrier: "Synthetic Carrier", policyType: "Term", premiumAmount: "50", soldDate: "2026-10-03" };
    await clientsSupabaseApi.update(CLIENT, data);
    await clientsSupabaseApi.updateWithPolicySaleHandoff(newSaleAttempt(), CLIENT, data, REQUEST, COMMISSION);
    const [legacy] = callsTo("update_client_with_policy_sale");
    const [companion] = callsTo("update_client_with_policy_sale_handoff");
    const patch = (args: Record<string, unknown>) => ({ ...(args.p_patch as Record<string, unknown>), updated_at: "<now>" });
    expect(patch(companion)).toEqual(patch(legacy));
    expect(companion).toMatchObject({ p_client_id: CLIENT, p_request_id: REQUEST, p_commission: COMMISSION });
  });

  it("a validation refusal is raised before anything is sent", async () => {
    const data = { firstName: "Pat", lastName: "Lee", carrier: "Synthetic Carrier", premiumAmount: "$50 garbage" } as unknown as Omit<Client, "id" | "createdAt" | "updatedAt">;
    const attempt = newSaleAttempt();
    await expect(clientsSupabaseApi.create(data, ORG, { requestId: REQUEST, recordSale: true, attempt })).rejects.toMatchObject({ errorClass: "not_sent" });
    expect(attempt.sent).toBe(false);
    expect(h.calls).toHaveLength(0);
  });
});
