import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  read: null as unknown, readError: null as unknown, impersonating: false,
  calls: [] as Array<[string, Record<string, unknown>]>, writes: [] as Array<{ data: unknown; error: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const response = name === "get_client_policy_sale_premiums" ? { data: h.read, error: h.readError }
        : h.writes.shift() ?? { data: null, error: { code: "XX000" } };
      const request = Promise.resolve(response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const USER = "00000000-0000-4000-8000-0000000000a1";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isImpersonating: h.impersonating,
    profile: { id: USER, role: "Admin", organization_id: "00000000-0000-4000-8000-0000000000e1" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Admin" }) }));

import { PolicySalePremiumSection } from "../policy-correction/PolicySalePremiumSection";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const POLICY = "00000000-0000-4000-8000-0000000000d1";
const policy = (over: Record<string, unknown> = {}) => ({
  policy_id: POLICY, win_id: "00000000-0000-4000-8000-0000000000e2", policy_source: "primary", sold_date: "2026-03-10",
  seller_id: "00000000-0000-4000-8000-0000000000a2", seller_name: "Synthetic Seller",
  original: { monthly: 100, state: "known", source: "sale_snapshot" },
  effective: { monthly: 100, annual: 1200, source: "sale_snapshot", state: "known", revision: 0 },
  book: { raw: 100, monthly: 100, present: true, matches_sale: true }, history: [], ...over,
});
const payload = (canCorrect: boolean, p = policy()) => ({ client_id: CLIENT, can_correct: canCorrect, policies: [p] });
const onRecord = vi.fn();
function show(currentMonthly: number | null = 100) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <PolicySalePremiumSection clientId={CLIENT} policyId={POLICY} currentMonthly={currentMonthly} formatDate={(v) => `date:${v}`}
      onPolicyRecordChanged={onRecord} />
  </QueryClientProvider>);
}
beforeEach(() => { h.read = null; h.readError = null; h.impersonating = false; h.calls = []; h.writes = []; onRecord.mockReset(); });
afterEach(cleanup);

describe("policy sale premium section (D2 §6.2)", () => {
  it("shows 'as sold' only when the sale premium differs from the current premium, in whole cents", async () => {
    h.read = payload(false);
    const same = show(100.004);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(same.container).toBeEmptyDOMElement();
    cleanup();
    h.read = payload(false);
    show(130);
    expect(await screen.findByText("Sale premium $100.00/mo (as sold)")).toBeInTheDocument();
    expect(screen.queryByText("Correct sale premium")).toBeNull();
    expect(screen.queryByText("Corrected")).toBeNull();
  });

  it("an unknown sale premium differs from a known current premium", async () => {
    h.read = payload(false, policy({ effective: { monthly: null, annual: null, source: "sale_snapshot", state: "missing", revision: 0 } }));
    show(80);
    expect(await screen.findByText("Sale premium unknown (as sold)")).toBeInTheDocument();
  });

  it("a revision shows the Corrected badge and History (n), even when the amounts match", async () => {
    h.read = payload(false, policy({ effective: { monthly: 120, annual: 1440, source: "correction", state: "known", revision: 1 },
      history: [{ revision: 1, created_at: "2026-11-04T10:00:00Z", actor_name: "Synthetic Admin", previous_effective_monthly: 100,
                  corrected_monthly: 120, reason_code: "entry_error", note: "Entered wrong", book_mode: "match_sale",
                  book_action: "updated", request_id: null }] }));
    show(120);
    expect(await screen.findByText("Corrected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    expect(screen.getByText("$100.00/mo → $120.00/mo")).toBeInTheDocument();
    expect(screen.getByText(/Synthetic Admin · Policy record updated/)).toBeInTheDocument();
    expect(screen.queryByText(/^Request /)).toBeNull();  // request ids only for Admins
  });

  it("is hidden under View As and on a read error", async () => {
    h.read = payload(true);
    h.impersonating = true;
    const viewAs = show(130);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls).toEqual([]);
    expect(viewAs.container).toBeEmptyDOMElement();
    cleanup();
    h.impersonating = false;
    h.readError = { code: "42501", message: "no" };
    const failed = show(130);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(failed.container).toBeEmptyDOMElement();
  });
});

describe("Correct sale premium dialog (D2 §5)", () => {
  it("only an Admin (can_correct) sees the button; the dialog states what a correction changes", async () => {
    h.read = payload(true);
    show(100);
    fireEvent.click(await screen.findByRole("button", { name: "Correct sale premium" }));
    expect(screen.getByText("Changes this sale's AP for its seller and Sold Date. No new sale is recorded.")).toBeInTheDocument();
    expect(screen.queryByText(/This older sale uses its current policy premium/)).toBeNull();
    for (const text of ["Synthetic Seller", "2026-03-10"]) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("sends the exact call, closes on success and reloads the contact when the policy record was updated", async () => {
    h.read = payload(true);
    h.writes.push({ data: { policy_id: POLICY, win_id: "00000000-0000-4000-8000-0000000000e2", request_id: "00000000-0000-4000-8000-0000000000f9",
      revision: 1, previous_effective_monthly: 100, corrected_monthly: 120, effective_annual: 1440, book_action: "updated", freeze: false,
      sold_date: "2026-03-10", seller_id: "00000000-0000-4000-8000-0000000000a2", corrected_at: "2026-11-04T10:00:00Z", idempotent: false }, error: null });
    show(100);
    fireEvent.click(await screen.findByRole("button", { name: "Correct sale premium" }));
    fireEvent.change(screen.getByLabelText("Corrected monthly premium"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Entered wrong at sale" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(onRecord).toHaveBeenCalledTimes(1));
    const write = h.calls.find(([name]) => name === "correct_policy_sale_premium")![1];
    expect({ ...write, p_request_id: "id" }).toEqual({ p_request_id: "id", p_policy_id: POLICY, p_expected_revision: 0,
      p_expected_effective_monthly: 100, p_expected_book_amount: 100, p_corrected_monthly: 120, p_reason_code: "entry_error",
      p_note: "Entered wrong at sale", p_book_mode: "match_sale" });
    await waitFor(() => expect(screen.queryByText("Save correction")).toBeNull());
  });

  it("disables 'update the record' when the record changed after the sale, and allows the legacy freeze", async () => {
    h.read = payload(true, policy({ effective: { monthly: 60, annual: 720, source: "legacy_record_fallback", state: "known", revision: 0 },
      book: { raw: 65, monthly: 65, present: true, matches_sale: false } }));
    show(65);
    fireEvent.click(await screen.findByRole("button", { name: "Correct sale premium" }));
    expect(screen.getByText("This older sale uses its current policy premium. Saving the same amount stops it following the policy record.")).toBeInTheDocument();
    expect(screen.getByText("The policy record was changed after the sale.")).toBeInTheDocument();
    expect(screen.getByLabelText("Update the policy record to match")).toBeDisabled();
    expect(screen.getByLabelText("Keep the current policy record")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Corrected monthly premium"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Freeze at the sold amount" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(h.calls.some(([name]) => name === "correct_policy_sale_premium")).toBe(true));
    expect(h.calls.find(([name]) => name === "correct_policy_sale_premium")![1]).toMatchObject({ p_corrected_monthly: 60, p_book_mode: "keep_current" });
  });

  it("refuses a same-amount correction of a snapshot sale before sending", async () => {
    h.read = payload(true);
    show(100);
    fireEvent.click(await screen.findByRole("button", { name: "Correct sale premium" }));
    fireEvent.change(screen.getByLabelText("Corrected monthly premium"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "No change" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText("This is already the sale premium.")).toBeInTheDocument();
    expect(h.calls.filter(([name]) => name === "correct_policy_sale_premium")).toEqual([]);
  });
});
