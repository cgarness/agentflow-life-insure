import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
import {
  rowToClient,
  clientToRow,
  clientUpdatePatch,
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

  it("preserves a known zero premium through editing; face display remains blank", () => {
    const c = rowToClient({
      id: "c3",
      first_name: "x",
      last_name: "y",
      premium: 0,
      face_amount: 0,
      created_at: "2020-01-01",
    });
    expect(c.premiumAmount).toBe("$0.00");
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

describe("lead details preserved at conversion (20261021200000)", () => {
  const converted = {
    id: "c9", first_name: "Pat", last_name: "Lee", created_at: "2026-10-21", state: "CA",
    date_of_birth: "1961-04-12", age: 64, best_time_to_call: "Morning", spouse_info: { name: "Sam", age: 60 },
    lead_conversion: { version: 1, lead_id: "lead-9", converted_at: "2026-10-21T20:00:00+00:00", converted_by: "agent-1",
      lead_status: "Interested", lead_source: "Facebook", lead_score: 8, lead_notes: "Original notes" },
  };

  it("maps the person fields and the parsed history", () => {
    const c = rowToClient(converted);
    expect(c.dateOfBirth).toBe("1961-04-12");
    expect(c.age).toBe(64);
    expect(c.bestTimeToCall).toBe("Morning");
    expect(c.spouseInfo).toEqual({ name: "Sam", age: 60 });
    expect(c.leadConversion?.leadSource).toBe("Facebook");
    expect(c.leadConversion?.leadNotes).toBe("Original notes");
  });

  it("a historical client without the new columns renders exactly as before (all undefined)", () => {
    const c = rowToClient({ id: "c10", first_name: "Old", last_name: "Client", created_at: "2025-01-01" });
    expect([c.dateOfBirth, c.age, c.bestTimeToCall, c.spouseInfo, c.leadConversion]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const nulls = rowToClient({ id: "c11", first_name: "Old", last_name: "Client", created_at: "2025-01-01",
      date_of_birth: null, age: null, best_time_to_call: null, spouse_info: null, lead_conversion: null });
    expect([nulls.dateOfBirth, nulls.age, nulls.bestTimeToCall, nulls.spouseInfo, nulls.leadConversion]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("an unrelated edit of a historical client sends none of the new keys (old servers keep accepting it)", () => {
    const c = rowToClient({ id: "c12", first_name: "Old", last_name: "Client", created_at: "2025-01-01" });
    const patch = clientUpdatePatch({ ...c, firstName: "Renamed" });
    for (const key of ["date_of_birth", "age", "best_time_to_call", "spouse_info", "lead_conversion"]) expect(patch).not.toHaveProperty(key);
  });

  it("sends edited person fields: text trimmed but never re-formatted, blanks as NULL, age as an integer", () => {
    expect(clientUpdatePatch({ dateOfBirth: " 03/04/1960 ", age: 55, bestTimeToCall: "Anytime", spouseInfo: "Jamie" })).toMatchObject({
      date_of_birth: "03/04/1960", age: 55, best_time_to_call: "Anytime", spouse_info: "Jamie" });
    expect(clientUpdatePatch({ dateOfBirth: "", age: "" as never, bestTimeToCall: " ", spouseInfo: "" })).toMatchObject({
      date_of_birth: null, age: null, best_time_to_call: null, spouse_info: null });
    expect(clientUpdatePatch({ age: "47" as never }).age).toBe(47);
    expect(() => clientUpdatePatch({ age: 4.5 })).toThrow("Age must be a whole number.");
  });

  it("never sends a structured spouse value back and never sends conversion history", () => {
    const c = rowToClient(converted);
    const patch = clientUpdatePatch({ ...c, notes: "Edited" });
    expect(patch).not.toHaveProperty("spouse_info");
    expect(patch).not.toHaveProperty("lead_conversion");
    expect(patch).toMatchObject({ date_of_birth: "1961-04-12", age: 64, best_time_to_call: "Morning", notes: "Edited" });
  });
});
