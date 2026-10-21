/** Insights reads: strict parsing (groups must add up) and the drill-down filters and addresses. */
import { describe, expect, it } from "vitest";
import { breakdown, goal, historyPage, policiesPage } from "@/components/commissions/__tests__/centerFixtures";
import { breakdownSchema, goalClearSchema, goalSchema, goalSetSchema, policyListSchema, receiptListSchema } from "../centerSchemas";
import {
  historyHref, monthsTenToTwelveHref, parseHistory, parsePolicies, soldPoliciesHref, writeCarrier, writePeriod,
} from "../centerFilters";

describe("insights schemas", () => {
  it("parses a consistent breakdown; refuses one whose groups do not add up", () => {
    expect(breakdownSchema.parse(breakdown()).carriers).toHaveLength(3);
    expect(breakdownSchema.parse(breakdown({ comparison: null })).comparison).toBeNull();
    const b = breakdown();
    const off = (patch: Record<string, unknown>) => breakdownSchema.safeParse({ ...b, ...patch }).success;
    expect(off({ sold: { ...b.sold, policies: 10 } })).toBe(false);
    expect(off({ received: { ...b.received, received_cents: 1 } })).toBe(false);
    expect(off({ products: [...b.products.slice(1), { ...b.products[0], category: "whole_life" }] })).toBe(false);
    expect(off({ carriers: b.carriers.map((c) => (c.carrier === "Harbor Mutual" ? { ...c, carrier: " synthetic life " } : c)) })).toBe(false);
    expect(off({ products: [...b.products.slice(0, 3), { ...b.products[3], category: "annuity" }] })).toBe(false);
    expect(off({ sold: { ...b.sold, estimate_cents: -1 } })).toBe(false);
  });

  it("goal reads and writes: whole cents within limits, null when unset", () => {
    expect(goalSchema.parse(goal(null)).target_cents).toBeNull();
    expect(goalSchema.parse(goal(100_000_000)).target_cents).toBe(100_000_000);
    expect(goalSchema.safeParse(goal(0)).success).toBe(false);
    expect(goalSchema.safeParse(goal(100_000_001)).success).toBe(false);
    expect(goalSchema.safeParse(goal(10.5)).success).toBe(false);
    expect(goalSetSchema.parse({ month: "2026-10-01", target_cents: 5, updated_at: "x" }).target_cents).toBe(5);
    expect(goalClearSchema.parse({ month: "2026-10-01", cleared: false }).cleared).toBe(false);
  });

  it("list pages carry whole-filter totals, categories and carrier options", () => {
    expect(policyListSchema.parse(policiesPage()).rows[0].category).toBe("term");
    expect(policyListSchema.safeParse({ ...policiesPage(), totals: undefined }).success).toBe(false);
    expect(receiptListSchema.parse(historyPage()).has_unknown_carrier).toBe(false);
    expect(receiptListSchema.safeParse({ ...historyPage(), carriers: undefined }).success).toBe(false);
  });
});

describe("insights filters", () => {
  it("Policies defaults to All time (its released address is unchanged) and reads Sold, Type and carrier", () => {
    expect(parsePolicies(new URLSearchParams(""))).toMatchObject({ period: { preset: "all" }, category: null, carrier: null, carrierUnknown: false });
    expect(parsePolicies(new URLSearchParams("period=this_month&carrier=Harbor%20Mutual&type=final_expense"))).toMatchObject(
      { period: { preset: "this_month" }, category: "final_expense", carrier: "Harbor Mutual", carrierUnknown: false });
    expect(parsePolicies(new URLSearchParams("carrier=X&carrier_unknown=1"))).toMatchObject({ carrier: null, carrierUnknown: true });
    expect(parsePolicies(new URLSearchParams("type=whole%20life")).category).toBeNull();
    expect(parseHistory(new URLSearchParams("view=history&carrier_unknown=1"))).toMatchObject({ period: { preset: "this_month" }, carrierUnknown: true });
  });

  it("drill-down addresses are exactly the bar's or slice's filter", () => {
    const month = { preset: "this_month" as const, from: null, to: null };
    expect(soldPoliciesHref(month, { carrier: { carrier: "Harbor Mutual", carrierUnknown: false } }))
      .toBe("/commissions/policies?period=this_month&carrier=Harbor+Mutual");
    expect(soldPoliciesHref(month, { carrier: { carrier: null, carrierUnknown: true } })).toBe("/commissions/policies?period=this_month&carrier_unknown=1");
    expect(soldPoliciesHref({ preset: "custom", from: "2026-03-01", to: "2026-03-31" }, { category: "final_expense" }))
      .toBe("/commissions/policies?period=custom&from=2026-03-01&to=2026-03-31&type=final_expense");
    expect(historyHref(month, { carrier: "Harbor Mutual", carrierUnknown: false })).toBe("/commissions/payments?view=history&carrier=Harbor+Mutual");
    expect(historyHref({ preset: "last_month", from: null, to: null }, { carrier: null, carrierUnknown: true }))
      .toBe("/commissions/payments?view=history&period=last_month&carrier_unknown=1");
    expect(monthsTenToTwelveHref()).toBe("/commissions/payments?period=next_month&status=remaining&kind=later");
  });

  it("writing filters: Policies' default period is All time; one carrier or Unknown, never both; back to page 1", () => {
    const params = new URLSearchParams("setup=missing&page=3");
    expect(writePeriod(params, { preset: "all", from: null, to: null }, "all").toString()).toBe("setup=missing");
    expect(writePeriod(params, { preset: "this_month", from: null, to: null }, "all").toString()).toBe("setup=missing&period=this_month");
    const unknown = writeCarrier(new URLSearchParams("carrier=X&page=2"), { carrier: null, carrierUnknown: true });
    expect(unknown.toString()).toBe("carrier_unknown=1");
    expect(writeCarrier(unknown, { carrier: "Y", carrierUnknown: false }).toString()).toBe("carrier=Y");
  });
});
