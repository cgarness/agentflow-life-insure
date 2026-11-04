import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import {
  clientSalePremiumsSchema, correctionError, parseCorrectedAmount, premiumCorrectionFormSchema, prepareCorrection,
  type PremiumCorrectionForm, type SalePremiumPolicy,
} from "@/lib/policySaleCorrection";

const POLICY = "00000000-0000-4000-8000-0000000000d1";
const sale = (over: Partial<SalePremiumPolicy> = {}): SalePremiumPolicy => ({
  policy_id: POLICY, win_id: "00000000-0000-4000-8000-0000000000e1", policy_source: "primary", sold_date: "2026-03-10",
  seller_id: "00000000-0000-4000-8000-0000000000a1", seller_name: "Synthetic Seller",
  original: { monthly: 100, state: "known", source: "sale_snapshot" },
  effective: { monthly: 100, annual: 1200, source: "sale_snapshot", state: "known", revision: 0 },
  book: { raw: 100, monthly: 100, present: true, matches_sale: true }, history: [], ...over,
});
const form = (over: Partial<PremiumCorrectionForm> = {}): PremiumCorrectionForm =>
  ({ amount: "120", unknown: false, reason: "entry_error", note: "Entered wrong at sale", bookMode: "match_sale", ...over });
const issues = (s: SalePremiumPolicy, f: PremiumCorrectionForm) => {
  const r = premiumCorrectionFormSchema(s).safeParse(f);
  return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}:${i.message}`);
};

describe("sale premium correction: amounts and form rules (D2 §5)", () => {
  it("accepts $0 to $1,000,000 with at most two decimals, with $ and thousands commas", () => {
    expect(["0", "120", "$120.50", "1,234.56", "$1,000,000"].map(parseCorrectedAmount)).toEqual([0, 120, 120.5, 1234.56, 1000000]);
    for (const bad of ["", "-1", "1.234", "1,00", "1000000.01", "12a", "$", "1e3"]) expect(parseCorrectedAmount(bad), bad).toBeNull();
  });

  it("refuses no change, except a same-amount freeze of a legacy fallback sale", () => {
    expect(issues(sale(), form({ amount: "100" }))).toEqual(["amount:This is already the sale premium."]);
    const legacy = sale({ effective: { monthly: 60, annual: 720, source: "legacy_record_fallback", state: "known", revision: 0 },
                          book: { raw: 60, monthly: 60, present: true, matches_sale: true } });
    expect(issues(legacy, form({ amount: "60", bookMode: "keep_current" }))).toEqual([]);
    expect(issues(sale({ effective: { ...sale().effective, source: "correction", revision: 1 } }), form({ amount: "100" }))).toHaveLength(1);
  });

  it("offers match_sale only for a record that matches the sale or already holds the corrected amount", () => {
    const diverged = sale({ book: { raw: 90, monthly: 90, present: true, matches_sale: false } });
    expect(issues(diverged, form())).toEqual(["bookMode:The policy record was changed after the sale."]);
    expect(issues(diverged, form({ amount: "90" }))).toEqual([]);  // already_matched
    expect(issues(diverged, form({ bookMode: "keep_current" }))).toEqual([]);
    expect(issues(sale({ book: { raw: null, monthly: null, present: false, matches_sale: false } }), form()))
      .toEqual(["bookMode:There is no current policy record to update."]);
    expect(issues(sale(), form({ amount: "0" }))[0]).toMatch(/^bookMode:A primary policy premium of \$0/);
    expect(issues(sale({ policy_source: "additional" }), form({ amount: "0" }))).toEqual([]);
  });

  it("requires a reason and a 3–500 character note; unknown needs no amount", () => {
    expect(issues(sale(), form({ note: " a " }))).toEqual(["note:Add a note of at least 3 characters."]);
    expect(issues(sale(), form({ note: "x".repeat(501) }))).toEqual(["note:Keep the note under 500 characters."]);
    expect(issues(sale(), form({ amount: "", unknown: true, bookMode: "keep_current" }))).toEqual([]);
    expect(issues(sale(), form({ amount: "abc" }))[0]).toMatch(/^amount:Enter a monthly amount/);
  });

  it("prepares the exact, deep-frozen call from the sale it corrects", () => {
    const args = prepareCorrection(sale({ book: { raw: "$100/mo", monthly: 100, present: true, matches_sale: true } }),
      form({ note: "  Entered wrong at sale  " }), "00000000-0000-4000-8000-0000000000f1");
    expect(args).toEqual({
      p_request_id: "00000000-0000-4000-8000-0000000000f1", p_policy_id: POLICY, p_expected_revision: 0,
      p_expected_effective_monthly: 100, p_expected_book_amount: "$100/mo", p_corrected_monthly: 120,
      p_reason_code: "entry_error", p_note: "Entered wrong at sale", p_book_mode: "match_sale",
    });
    expect(Object.isFrozen(args)).toBe(true);
    expect(() => prepareCorrection(sale(), form({ amount: "100" }), "00000000-0000-4000-8000-0000000000f1")).toThrow();
  });
});

describe("sale premium correction: errors and payloads", () => {
  it("maps the server's DETAIL codes; an unconfirmed outcome is unknown", () => {
    const e = (code: string | null, details: string | null = null) => correctionError(code ? { code, details } : null, true);
    expect([e("PT409", "stale_revision"), e("PT409", "request_conflict")].map((x) => [x.errorClass, x.detail]))
      .toEqual([["conflict", "stale_revision"], ["conflict", "request_conflict"]]);
    expect(e("22023", "book_diverged").message).toMatch(/no longer matches the sale/);
    expect([e("42501").errorClass, e("42501").message]).toEqual(["rejected", "Only an Admin can correct a sale premium."]);
    expect(e("PT404", "sale_not_found").errorClass).toBe("rejected");
    expect([e(null).errorClass, e("08006").errorClass]).toEqual(["unknown", "unknown"]);
    expect(e(null).message).toBe("We couldn't confirm the correction. Retry sends exactly the same correction.");
  });

  it("parses the history reader, with a policy record held as a number or a currency string", () => {
    const parsed = clientSalePremiumsSchema.parse({ client_id: "00000000-0000-4000-8000-0000000000c1", can_correct: true,
      policies: [sale(), sale({ policy_id: "00000000-0000-4000-8000-0000000000d2", book: { raw: "$150/mo", monthly: 150, present: true, matches_sale: true } }),
                 sale({ policy_id: "00000000-0000-4000-8000-0000000000d3", book: null })] });
    expect(parsed.policies.map((p) => p.book?.raw ?? null)).toEqual([100, "$150/mo", null]);
  });

  it("correction code never reaches a sale notification or the win trigger", () => {
    const root = join(__dirname, "..", "..");
    const files = ["lib/policySaleCorrection.ts", "hooks/usePolicySalePremiums.ts", "hooks/usePremiumCorrectionSubmission.ts",
      ...readdirSync(join(root, "components/contacts/policy-correction")).map((n) => `components/contacts/policy-correction/${n}`)];
    for (const f of files) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/notify_win|win-trigger|record_client_policy|create_client_with_sale/);
  });
});
