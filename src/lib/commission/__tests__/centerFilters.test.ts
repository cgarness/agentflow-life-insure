import { describe, expect, it } from "vitest";
import {
  customPeriod, historyHref, parseHistory, parsePeriod, parsePolicies, parseScheduled, periodArgs, periodReady, policiesHref,
  scheduledHref, tabPath, withParam, writePeriod,
} from "../centerFilters";

const q = (s: string) => new URLSearchParams(s);

describe("commissions center URL filters", () => {
  it("defaults to This month and never trusts an unknown value", () => {
    expect(parsePeriod(q(""), false)).toEqual({ preset: "this_month", from: null, to: null });
    expect(parsePeriod(q("period=weekly"), true).preset).toBe("this_month");
    expect(parsePeriod(q("period=all"), false).preset).toBe("this_month");
    expect(parsePeriod(q("period=all"), true).preset).toBe("all");
    expect(parsePeriod(q("period=custom&from=2026-10-05&to=1999-01-01"), true)).toEqual({ preset: "custom", from: "2026-10-05", to: null });
  });

  it("requests nothing until a custom range is complete and in order", () => {
    expect(periodReady({ preset: "custom", from: "2026-10-05", to: null })).toBe(false);
    expect(periodReady({ preset: "custom", from: "2026-10-05", to: "2026-10-01" })).toBe(false);
    expect(periodReady(customPeriod("2026-10-01", "2026-10-05"))).toBe(true);
    expect(periodArgs({ preset: "last_month", from: "2026-01-01", to: "2026-01-02" })).toEqual({ p_period: "last_month", p_from: null, p_to: null });
    expect(periodArgs(customPeriod("2026-10-01", "2026-10-05"))).toEqual({ p_period: "custom", p_from: "2026-10-01", p_to: "2026-10-05" });
  });

  it("parses list filters with defaults; a filter change returns to page 1", () => {
    expect(parseScheduled(q(""))).toEqual({ period: { preset: "this_month", from: null, to: null }, scope: "period", status: "all", kind: null, carrier: null, page: 1 });
    expect(parseScheduled(q("dates=next_90&status=check_payment&kind=later&carrier=Harbor%20Mutual&page=3"))).toMatchObject(
      { scope: "next_90", status: "check_payment", kind: "later", carrier: "Harbor Mutual", page: 3 });
    expect(parseScheduled(q("dates=sideways&status=overdue&kind=month_13&page=-2"))).toMatchObject({ scope: "period", status: "all", kind: null, page: 1 });
    expect(parseHistory(q("voided=1&period=all"))).toMatchObject({ includeVoided: true, period: { preset: "all" } });
    expect(parsePolicies(q("setup=missing"))).toMatchObject({ setup: "missing", carrier: null, page: 1 });
    expect(parsePolicies(q("setup=paid")).setup).toBe("all");
    expect(withParam(q("status=received&page=4"), "kind", "advance").toString()).toBe("status=received&kind=advance");
    expect(withParam(q("status=received"), "status", "all", "all").toString()).toBe("");
    expect(writePeriod(q("page=2&status=all"), { preset: "this_month", from: null, to: null }).toString()).toBe("status=all");
  });

  it("builds the exact list behind each card, chart month and review item", () => {
    const period = { preset: "last_month", from: null, to: null } as const;
    expect(tabPath("overview")).toBe("/commissions");
    expect(scheduledHref({ period })).toBe("/commissions/payments?period=last_month");
    expect(scheduledHref({ period, status: "remaining" })).toBe("/commissions/payments?period=last_month&status=remaining");
    expect(scheduledHref({ scope: "next_90" })).toBe("/commissions/payments?dates=next_90");
    expect(scheduledHref({ scope: "any", status: "check_payment" })).toBe("/commissions/payments?dates=any&status=check_payment");
    expect(historyHref(customPeriod("2026-10-01", "2026-10-31"))).toBe("/commissions/payments?view=history&period=custom&from=2026-10-01&to=2026-10-31");
    expect(policiesHref("missing")).toBe("/commissions/policies?setup=missing");
    expect(policiesHref("all")).toBe("/commissions/policies");
  });
});
