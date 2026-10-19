import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  attentionMessage,
  estimateTotals,
  excessCents,
  formatCents,
  parseDollarsToCents,
  receivedCents,
  remainingCents,
  scheduledMonths,
  timingLabel,
} from "../installments";
import type { CommissionEstimateRecord, CommissionInstallment, CommissionReceipt } from "../trackingSchemas";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const receipt = (amount: number, voided = false): CommissionReceipt => ({
  id: id(), amount_cents: amount, received_on: "2026-10-19", reference: null, recorded_by: id(), recorded_at: "2026-10-19T00:00:00Z",
  replaces_receipt_id: null, voided_at: voided ? "2026-10-19T01:00:00Z" : null, void_reason: voided ? "Wrong amount" : null,
});
const installment = (kind: CommissionInstallment["kind"], expected: number, receipts: CommissionReceipt[] = []): CommissionInstallment => ({
  id: id(), kind, expected_cents: expected, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts,
});

describe("expected payments and manual receipts", () => {
  it("counts only active receipts; remaining never goes below zero; excess stays on its installment", () => {
    const advance = installment("advance", 42975, [receipt(40000), receipt(5000), receipt(9999, true)]);
    expect(receivedCents(advance)).toBe(45000);
    expect(remainingCents(advance)).toBe(0);
    expect(excessCents(advance)).toBe(2025);
    const month10 = installment("month_10", 4775, [receipt(1000)]);
    expect([receivedCents(month10), remainingCents(month10), excessCents(month10)]).toEqual([1000, 3775, 0]);
  });

  it("an advance overpayment never marks Months 10–12 received", () => {
    const estimate = {
      first_year_cents: 57300,
      installments: [installment("advance", 42975, [receipt(57300)]), installment("month_10", 4775), installment("month_11", 4775),
        installment("month_12", 4775)],
    } as unknown as CommissionEstimateRecord;
    expect(estimateTotals(estimate)).toEqual({ expected: 57300, received: 57300, remaining: 14325, excess: 14325 });
  });

  it("formats and parses whole cents strictly", () => {
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(5)).toBe("$0.05");
    expect(parseDollarsToCents("$1,250.5")).toBe(125050);
    expect(parseDollarsToCents("150")).toBe(15000);
    expect(parseDollarsToCents("1000000")).toBe(100000000);
    for (const bad of ["", "0", "0.00", "-5", "1.234", "1,25", "abc", "1000000.01", "$ 5"]) expect(parseDollarsToCents(bad)).toBeNull();
  });
});

describe("timing", () => {
  it("places Months 10/11/12 at the basis month + 9/10/11, ignoring the day and crossing years", () => {
    expect(scheduledMonths("2026-11-15")).toEqual({ month_10: "2027-08-01", month_11: "2027-09-01", month_12: "2027-10-01" });
    expect(scheduledMonths("2027-01-31")).toEqual({ month_10: "2027-10-01", month_11: "2027-11-01", month_12: "2027-12-01" });
    expect(addCalendarMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addCalendarMonths("bad", 1)).toBeNull();
  });

  it("labels timing without due or overdue states", () => {
    expect(timingLabel({ timing_precision: "unknown", expected_on: null })).toBe("Payment timing unconfirmed");
    expect(timingLabel({ timing_precision: "month", expected_on: "2026-10-01" })).toBe("Expected Oct 2026");
    expect(timingLabel({ timing_precision: "date", expected_on: "2026-10-20" })).toBe("Expected Oct 20, 2026");
    expect(attentionMessage("rate_changed")).toMatch(/rate changed/);
    expect(attentionMessage("something_new")).toMatch(/needs a check/);
  });
});
