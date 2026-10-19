import { describe, expect, it } from "vitest";
import { captureKey, captureSlotInputs, commissionPayload, emptyCommissionPayload, PRIMARY_SLOT } from "../capture";
import { estimateCommission } from "../estimate";
import { syntheticContext } from "./syntheticGrid";

const context = syntheticContext("100");
const base = {
  context,
  creditedAgentId: "00000000-0000-4000-8000-0000000000a1",
  level: 100,
  productId: "00000000-0000-4000-8000-0000000000b1",
  variantId: "00000000-0000-4000-8000-0000000000b2",
  age: 60,
  term: null,
};

describe("commission capture", () => {
  it("carries exactly the displayed inputs, with cents rounded half-up like the server", () => {
    // 12.34 × 12 × 95.50% = 141.4164 → 14142; × 75% = 106.0623 → 10606 (the server's CHECKs agree).
    const inputs = captureSlotInputs({ ...base, monthlyPremium: "12.34", estimate: estimateCommission("12.34", "95.50")! });
    expect(inputs).toEqual({
      credited_agent_id: base.creditedAgentId, grid_id: context.grid.id, grid_revision: context.grid.revision,
      product_id: base.productId, variant_id: base.variantId, insured_age: 60, term_years: null, contract_level: 100,
      rate_percent: "95.50", monthly_premium: "12.34", first_year_cents: 14142, advance_cents: 10606,
    });
    const halfCent = captureSlotInputs({ ...base, monthlyPremium: "0.25", estimate: estimateCommission("0.25", "50")! });
    expect([halfCent.first_year_cents, halfCent.advance_cents]).toEqual([150, 113]);
  });

  it("omits slots without a displayed estimate and never invents one", () => {
    const inputs = captureSlotInputs({ ...base, monthlyPremium: "100", estimate: estimateCommission("100", "110")! });
    const payload = commissionPayload([
      { slot: PRIMARY_SLOT, inputs },
      { slot: "00000000-0000-4000-8000-0000000000c1", inputs: null },
      { slot: "00000000-0000-4000-8000-0000000000c2", inputs: undefined },
    ]);
    expect(payload).toEqual({ v: "policy-commission-v1", slots: [{ slot: "primary", ...inputs }] });
    expect(commissionPayload([])).toEqual(emptyCommissionPayload());
    expect(captureKey(null)).toBe("");
    expect(captureKey(inputs)).toBe(JSON.stringify(inputs));
  });
});
