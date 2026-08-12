import { describe, it, expect } from "vitest";
import {
  rowToClient,
  clientToRow,
  formatCurrencyValue,
  parseCurrencyToNumberOrNull,
  normalizeDateOrNull,
} from "@/lib/supabase-clients";
import { normalizePaymentFrequencyOrNull, formatPaymentFrequency } from "@/lib/policyPaymentFields";

describe("rowToClient — canonical policy columns", () => {
  it("reads premium, face_amount, issue_date, effective_date from the canonical columns", () => {
    const c = rowToClient({
      id: "c1",
      first_name: "Ada",
      last_name: "Lovelace",
      premium: 150,
      face_amount: 500000,
      issue_date: "2024-01-15",
      effective_date: "2024-02-01",
      created_at: "2020-09-09T00:00:00Z",
      updated_at: "2020-09-09T00:00:00Z",
    });
    expect(c.premiumAmount).toBe("$150.00");
    expect(c.faceAmount).toBe("$500,000.00");
    expect(c.issueDate).toBe("2024-01-15");
    expect(c.effectiveDate).toBe("2024-02-01");
  });

  it("reads sold_date, draft_date, payment_frequency; missing → blank (never fabricated)", () => {
    const c = rowToClient({
      id: "c5",
      first_name: "x",
      last_name: "y",
      sold_date: "2026-08-01",
      draft_date: "2026-08-15",
      payment_frequency: "quarterly",
      created_at: "2020-01-01",
    });
    expect(c.soldDate).toBe("2026-08-01");
    expect(c.draftDate).toBe("2026-08-15");
    expect(c.paymentFrequency).toBe("quarterly");

    const blank = rowToClient({ id: "c6", first_name: "x", last_name: "y", created_at: "2020-01-01" });
    expect(blank.soldDate).toBe("");
    expect(blank.draftDate).toBe("");
    expect(blank.paymentFrequency).toBe("");
  });

  it("renders missing premium/face as blank — never a fabricated $0", () => {
    const c = rowToClient({
      id: "c2",
      first_name: "x",
      last_name: "y",
      premium: null,
      face_amount: null,
      created_at: "2020-01-01",
    });
    expect(c.premiumAmount).toBe("");
    expect(c.faceAmount).toBe("");
    expect(c.premiumAmount).not.toBe("$0");
    expect(c.faceAmount).not.toBe("$0");
  });

  it("treats a stored 0 as blank (Build 1 decision D1)", () => {
    const c = rowToClient({
      id: "c3",
      first_name: "x",
      last_name: "y",
      premium: 0,
      face_amount: 0,
      created_at: "2020-01-01",
    });
    expect(c.premiumAmount).toBe("");
    expect(c.faceAmount).toBe("");
  });

  it("never substitutes created_at for missing policy dates", () => {
    const created = "2020-09-09T00:00:00Z";
    const c = rowToClient({
      id: "c4",
      first_name: "x",
      last_name: "y",
      issue_date: null,
      effective_date: null,
      created_at: created,
    });
    expect(c.issueDate).toBe("");
    expect(c.effectiveDate).toBe("");
    expect(c.issueDate).not.toBe(created);
    expect(c.effectiveDate).not.toBe(created);
  });
});

describe("clientToRow — writes canonical columns", () => {
  it("maps display fields to premium/face_amount/issue_date/effective_date/policy_number", () => {
    const row = clientToRow({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "5551234567",
      email: "a@b.com",
      state: "TX",
      policyType: "Term",
      carrier: "Acme",
      policyNumber: "POL-1",
      premiumAmount: "$150.00",
      faceAmount: "$500,000",
      issueDate: "2024-01-15",
      effectiveDate: "2024-02-01",
    });
    expect(row.premium).toBe(150);
    expect(row.face_amount).toBe(500000);
    expect(row.issue_date).toBe("2024-01-15");
    expect(row.effective_date).toBe("2024-02-01");
    expect(row.policy_number).toBe("POL-1");
    // Never write the deferred-debt column.
    expect(row).not.toHaveProperty("premium_amount");
  });

  it("persists blank optional values as NULL (never 0 / created_at)", () => {
    const row = clientToRow({
      firstName: "x",
      lastName: "y",
      premiumAmount: "",
      faceAmount: "",
      issueDate: "",
      effectiveDate: "",
      policyNumber: "",
      soldDate: "",
      draftDate: "",
      paymentFrequency: "",
    });
    expect(row.premium).toBeNull();
    expect(row.face_amount).toBeNull();
    expect(row.issue_date).toBeNull();
    expect(row.effective_date).toBeNull();
    expect(row.policy_number).toBeNull();
    expect(row.sold_date).toBeNull();
    expect(row.draft_date).toBeNull();
    expect(row.payment_frequency).toBeNull();
  });

  it("writes sold_date/draft_date as YYYY-MM-DD and payment_frequency as a canonical value only", () => {
    const row = clientToRow({
      firstName: "x",
      lastName: "y",
      soldDate: "2026-08-01",
      draftDate: "2026-08-15T08:00:00Z",
      paymentFrequency: "Semi-Annual",
    });
    expect(row.sold_date).toBe("2026-08-01");
    expect(row.draft_date).toBe("2026-08-15"); // date part kept
    expect(row.payment_frequency).toBe("semi_annual"); // normalized, CHECK-safe

    // Unknown frequency never reaches the DB as free text.
    expect(clientToRow({ firstName: "x", lastName: "y", paymentFrequency: "biweekly" }).payment_frequency).toBeNull();
  });

  it("does not crash when amount fields are undefined", () => {
    expect(() => clientToRow({ firstName: "x", lastName: "y" })).not.toThrow();
    const row = clientToRow({ firstName: "x", lastName: "y" });
    expect(row.premium).toBeNull();
    expect(row.face_amount).toBeNull();
  });
});

describe("value helpers", () => {
  it("formatCurrencyValue blanks null/undefined/0 and formats real numbers", () => {
    expect(formatCurrencyValue(null)).toBe("");
    expect(formatCurrencyValue(undefined)).toBe("");
    expect(formatCurrencyValue(0)).toBe("");
    expect(formatCurrencyValue(1200.5)).toBe("$1,200.50");
  });

  it("parseCurrencyToNumberOrNull never coerces blank to 0", () => {
    expect(parseCurrencyToNumberOrNull("")).toBeNull();
    expect(parseCurrencyToNumberOrNull(undefined)).toBeNull();
    expect(parseCurrencyToNumberOrNull("$1,200.50")).toBe(1200.5);
  });

  it("normalizeDateOrNull yields YYYY-MM-DD or null", () => {
    expect(normalizeDateOrNull("")).toBeNull();
    expect(normalizeDateOrNull(null)).toBeNull();
    expect(normalizeDateOrNull("2024-01-15")).toBe("2024-01-15");
    expect(normalizeDateOrNull("2024-01-15T08:00:00Z")).toBe("2024-01-15");
  });

  it("normalizePaymentFrequencyOrNull accepts canonical values + label spellings, rejects unknowns", () => {
    expect(normalizePaymentFrequencyOrNull("monthly")).toBe("monthly");
    expect(normalizePaymentFrequencyOrNull("Quarterly")).toBe("quarterly");
    expect(normalizePaymentFrequencyOrNull("Semi-Annual")).toBe("semi_annual");
    expect(normalizePaymentFrequencyOrNull("semi annual")).toBe("semi_annual");
    expect(normalizePaymentFrequencyOrNull("Annual")).toBe("annual");
    expect(normalizePaymentFrequencyOrNull("")).toBeNull();
    expect(normalizePaymentFrequencyOrNull(null)).toBeNull();
    expect(normalizePaymentFrequencyOrNull("weekly")).toBeNull();
  });

  it("formatPaymentFrequency renders labels, blank for unknown/missing", () => {
    expect(formatPaymentFrequency("monthly")).toBe("Monthly");
    expect(formatPaymentFrequency("semi_annual")).toBe("Semi-Annual");
    expect(formatPaymentFrequency(null)).toBe("");
    expect(formatPaymentFrequency("weekly")).toBe("");
  });
});
