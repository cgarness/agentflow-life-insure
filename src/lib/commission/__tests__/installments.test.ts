import { describe, expect, it } from "vitest";
import { receiptFormSchema,
  attentionMessage,
  estimateTotals,
  excessCents,
  formatCents,
  formatDateRange,
  parseDollarsToCents,
  parsePaymentDateForm,
  parseStartDateForm,
  receivedCents,
  remainingCents,
  scheduleSummary,
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
  id: id(), kind, expected_cents: expected, timing_precision: "unknown", expected_on: null, expected_until: null, timing_source: "unset", receipts,
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

describe("expected dates", () => {
  it("formats windows within a month, across months and across years", () => {
    expect(formatDateRange("2026-10-05", "2026-10-07")).toBe("Oct 5 – 7, 2026");
    expect(formatDateRange("2026-11-27", "2026-12-01")).toBe("Nov 27 – Dec 1, 2026");
    expect(formatDateRange("2026-12-31", "2027-01-05")).toBe("Dec 31, 2026 – Jan 5, 2027");
    expect(formatDateRange("2026-10-05", "2026-10-05")).toBe("Oct 5, 2026");
  });

  it("labels dates without due or overdue states", () => {
    expect(timingLabel({ timing_precision: "unknown", expected_on: null, expected_until: null })).toBe("Date needed");
    expect(timingLabel({ timing_precision: "month", expected_on: "2026-10-01", expected_until: null })).toBe("Expected Oct 2026");
    expect(timingLabel({ timing_precision: "date", expected_on: "2026-10-20", expected_until: null })).toBe("Expected Oct 20, 2026");
    expect(timingLabel({ timing_precision: "date", expected_on: "2027-07-06", expected_until: "2027-07-08" })).toBe("Expected Jul 6 – 8, 2027");
    expect(attentionMessage("rate_changed")).toMatch(/rate changed/);
    expect(attentionMessage("something_new")).toMatch(/needs a check/);
  });

  it("says where the dates come from, estimated unless a person chose the start", () => {
    const base = { schedule_start_on: "2026-10-02", schedule_frequency: null } as const;
    expect(scheduleSummary({ ...base, schedule_start_source: "effective_date", schedule_assumed: true }))
      .toEqual({ text: "Estimated from effective date Oct 2, 2026", exception: null });
    expect(scheduleSummary({ ...base, schedule_start_source: "effective_date", schedule_assumed: false }).text).toBe("From effective date Oct 2, 2026");
    expect(scheduleSummary({ ...base, schedule_start_source: "manual", schedule_assumed: false }).text).toBe("From first premium date Oct 2, 2026");
    expect(scheduleSummary({ ...base, schedule_start_source: "effective_date", schedule_assumed: true, schedule_frequency: "quarterly" }).exception)
      .toBe("Quarterly premiums: Months 10–12 need dates.");
    expect(scheduleSummary({ ...base, schedule_start_source: "effective_date", schedule_assumed: true, schedule_frequency: "monthly" }).exception).toBeNull();
    expect(scheduleSummary({ schedule_start_on: null, schedule_start_source: null, schedule_assumed: false, schedule_frequency: null }))
      .toEqual({ text: "Date needed", exception: null });
  });

  it("validates Edit dates and per-payment dates", () => {
    expect(parseStartDateForm({ choice: "effective_date", startOn: "", effectiveDate: "2026-11-01" })).toEqual({ startOn: "2026-11-01", source: "effective_date" });
    expect(parseStartDateForm({ choice: "effective_date", startOn: "", effectiveDate: null })).toEqual({ error: "This policy has no effective date." });
    expect(parseStartDateForm({ choice: "manual", startOn: "2026-11-15", effectiveDate: null })).toEqual({ startOn: "2026-11-15", source: "manual" });
    expect(parseStartDateForm({ choice: "manual", startOn: "", effectiveDate: null })).toEqual({ error: "Enter the first premium date." });
    expect(parseStartDateForm({ choice: "manual", startOn: "1999-12-31", effectiveDate: null })).toEqual({ error: "Enter a date between 2000 and 2100." });
    expect(parseStartDateForm({ choice: "none", startOn: "2026-11-15", effectiveDate: null })).toEqual({ startOn: null, source: null });
    expect(parsePaymentDateForm({ choice: "automatic", month: "2027-08", date: "" })).toEqual({ precision: "automatic", expectedOn: null });
    expect(parsePaymentDateForm({ choice: "unknown", month: "", date: "2027-08-02" })).toEqual({ precision: "unknown", expectedOn: null });
    expect(parsePaymentDateForm({ choice: "month", month: "2027-08", date: "" })).toEqual({ precision: "month", expectedOn: "2027-08-01" });
    expect(parsePaymentDateForm({ choice: "month", month: "", date: "" })).toEqual({ error: "Choose the expected month." });
    expect(parsePaymentDateForm({ choice: "date", month: "", date: "2101-01-01" })).toEqual({ error: "Choose a date between 2000 and 2100." });
    expect(parsePaymentDateForm({ choice: "date", month: "", date: "2027-08-20" })).toEqual({ precision: "date", expectedOn: "2027-08-20" });
  });
});

describe("receiptFormSchema", () => {
  it("reports the first problem in field order and parses a valid receipt", () => {
    const today = "2026-10-19";
    const first = (input: { amount: string; receivedOn: string; reference: string }) => {
      const parsed = receiptFormSchema(today).safeParse(input);
      return parsed.success ? null : parsed.error.issues[0].message;
    };
    expect(first({ amount: "", receivedOn: "nope", reference: "" })).toMatch(/above \$0\.00/);
    expect(first({ amount: "1", receivedOn: "nope", reference: "" })).toBe("Enter the date the payment was received.");
    expect(first({ amount: "1", receivedOn: "2026-10-20", reference: "" })).toMatch(/future/);
    expect(receiptFormSchema(today).parse({ amount: "1,000.5", receivedOn: today, reference: " r " }))
      .toEqual({ amount: 100050, receivedOn: today, reference: "r" });
  });
});
