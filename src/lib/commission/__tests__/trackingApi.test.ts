import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown]>,
  response: { data: null, error: null } as { data: unknown; error: unknown },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      h.calls.push([name, args]);
      const request = Promise.resolve(h.response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));

import { CommissionTrackingError, commissionTrackingApi, fetchClientPolicyCommissions } from "../trackingApi";
import { parseClientPolicyCommissions } from "../trackingSchemas";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const installment = (kind: string, cents: number) => ({
  id: id(), kind, expected_cents: cents, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts: [],
});
function recordedPolicy(access: "write" | "read" = "write") {
  return {
    policy_id: id(), source: "primary", state: "recorded", access, credited_agent_id: id(), win_id: id(),
    basis: { policy_type: "Term", carrier: "Synthetic Carrier", monthly_premium: "50.00", premium_source: "sale_snapshot", effective_date: "2026-11-01" },
    estimate: {
      id: id(), status: "active", status_reason: null, capture_mode: "sale_entry", captured_by: id(), recorded_by: id(),
      recorded_at: "2026-10-19T17:00:00Z", grid_name: "Synthetic Grid", grid_revision: 4, grid_effective_date: "2026-01-01",
      product_name: "Synthetic Term", product_carrier: "Synthetic Carrier", variant_label: "Ages 18-60", insured_age: 35, term_years: 20,
      contract_level: 100, rate_percent: "95.50", monthly_premium: "50.00", premium_source: "sale_snapshot", first_year_cents: 57300,
      advance_cents: 42975, schedule_start_on: null, schedule_start_source: null, state_revision: 1,
      installments: [installment("advance", 42975), installment("month_10", 4775), installment("month_11", 4775), installment("month_12", 4775)],
    },
    capture: null,
  };
}

beforeEach(() => { h.calls = []; h.response = { data: null, error: null }; });

describe("contact read", () => {
  it("parses visible, hidden and unavailable policies strictly", async () => {
    const data = { client_id: id(), policies: [recordedPolicy(), { policy_id: id(), source: "additional", state: "hidden" }] };
    h.response = { data, error: null };
    const parsed = await fetchClientPolicyCommissions(data.client_id);
    expect(parsed.policies.map((p) => p.state)).toEqual(["recorded", "hidden"]);
    expect(h.calls[0]).toEqual(["get_client_policy_commissions", { p_client_id: data.client_id }]);
  });

  it("refuses malformed rows instead of showing a wrong figure", () => {
    const bad = recordedPolicy();
    bad.estimate.installments.pop();
    expect(() => parseClientPolicyCommissions({ client_id: id(), policies: [bad] })).toThrow();
    const noEstimate = { ...recordedPolicy(), estimate: null };
    expect(() => parseClientPolicyCommissions({ client_id: id(), policies: [noEstimate] })).toThrow();
  });
});

describe("tracking writes", () => {
  it("sends one request id per change and the exact arguments", async () => {
    const estimateId = id();
    h.response = { data: { estimate_id: estimateId, state_revision: 3, status: "ok" }, error: null };
    await commissionTrackingApi.setHold({ requestId: "r-1", estimateId, expectedRevision: 2, onHold: true, reason: "Carrier review" });
    expect(h.calls[0]).toEqual(["set_policy_commission_hold", {
      p_request_id: "r-1", p_estimate_id: estimateId, p_expected_revision: 2, p_on_hold: true, p_reason: "Carrier review",
    }]);
    h.response = { data: { estimate_id: estimateId, state_revision: 4, status: "ok", replacement_receipt_id: null }, error: null };
    await commissionTrackingApi.voidReceipt({ requestId: "r-2", receiptId: id(), expectedRevision: 3, reason: "Wrong amount",
      replacement: { installmentId: id(), amountCents: 100, receivedOn: "2026-10-19", reference: null } });
    expect((h.calls[1][1] as { p_replacement: Record<string, unknown> }).p_replacement).toEqual({
      installment_id: expect.any(String), amount_cents: 100, received_on: "2026-10-19", reference: null,
    });
  });

  it("explains stale, denied, invalid and unknown outcomes", async () => {
    const run = () => commissionTrackingApi.recordReceipt({ requestId: "r", installmentId: id(), amountCents: 1, receivedOn: "2026-10-19", reference: null });
    h.response = { data: null, error: { code: "PT409", message: "Commission changed elsewhere; refresh and try again" } };
    await expect(run()).rejects.toMatchObject({ kind: "stale" });
    h.response = { data: null, error: { code: "42501", message: "Not authorized to change this commission" } };
    await expect(run()).rejects.toMatchObject({ kind: "denied", message: "You don't have permission to change this commission." });
    h.response = { data: null, error: { code: "22023", message: "Enter an amount above $0.00" } };
    await expect(run()).rejects.toMatchObject({ kind: "invalid", message: "Enter an amount above $0.00" });
    h.response = { data: null, error: { code: "", message: "TypeError: fetch failed" } };
    await expect(run()).rejects.toMatchObject({ kind: "unknown" });
    h.response = { data: { what: "?" }, error: null };
    const unreadable = await run().catch((error) => error);
    expect(unreadable).toBeInstanceOf(CommissionTrackingError);
    expect(unreadable.kind).toBe("unknown");
  });
});
