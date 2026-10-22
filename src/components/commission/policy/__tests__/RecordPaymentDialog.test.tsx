import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, Record<string, unknown>]>,
  responses: [] as Array<{ data: unknown; error: unknown }>,
  // A fake server for the lost-response case: receipts by request id (the real function returns the stored one).
  server: null as null | { receipts: Map<string, Record<string, unknown>>; loseNext: boolean },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      if (name === "record_policy_commission_receipt" && h.server) {
        const id = String(args.p_request_id);
        const existing = h.server.receipts.has(id);
        if (!existing) h.server.receipts.set(id, args);
        if (h.server.loseNext) { h.server.loseNext = false; return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } }; }
        return { data: { receipt_id: "00000000-0000-4000-8000-0000000000f1", status: "recorded", idempotent: existing }, error: null };
      }
      return h.responses.shift() ?? { data: null, error: { message: "unset" } };
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000a1" }, isImpersonating: false,
    profile: { id: "00000000-0000-4000-8000-0000000000a1", role: "Agent", organization_id: "00000000-0000-4000-8000-0000000000e1" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));

import { RecordPaymentDialog } from "../RecordPaymentDialog";
import { resetUnresolvedTrackingWrites } from "@/hooks/useClientPolicyCommissions";
import { validateReceipt } from "@/lib/commission/installments";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const installments = ["advance", "month_10", "month_11", "month_12"].map((kind, index) => ({
  id: id(), kind, expected_cents: index === 0 ? 42975 : 4775, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts: [],
})) as never[];
const receipt = { data: { receipt_id: "00000000-0000-4000-8000-0000000000f1", status: "recorded", idempotent: false }, error: null };
const lost = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };

let client: QueryClient;
const dialog = (isOpen: boolean, onOpenChange: (open: boolean) => void, list = installments, initial = (installments[1] as { id: string }).id) => (
  <QueryClientProvider client={client}>
    <RecordPaymentDialog open={isOpen} onOpenChange={onOpenChange} installments={list} initialInstallmentId={initial} />
  </QueryClientProvider>
);
function open(onOpenChange = vi.fn()) {
  render(dialog(true, onOpenChange));
  return onOpenChange;
}
const sent = () => h.calls.filter(([name]) => name === "record_policy_commission_receipt").map(([, args]) => args);

beforeEach(() => {
  h.calls = []; h.responses = []; h.server = null;
  resetUnresolvedTrackingWrites();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("RecordPaymentDialog", () => {
  it("validates the manual receipt", () => {
    const today = "2026-10-19";
    expect(validateReceipt({ amount: "0", receivedOn: today, reference: "" }, today)).toEqual({ error: expect.stringMatching(/above \$0.00/) });
    expect(validateReceipt({ amount: "10", receivedOn: "2026-10-20", reference: "" }, today)).toEqual({ error: expect.stringMatching(/future/) });
    expect(validateReceipt({ amount: "10", receivedOn: "1999-12-31", reference: "" }, today)).toEqual({ error: expect.stringMatching(/2000/) });
    expect(validateReceipt({ amount: "10", receivedOn: today, reference: "x".repeat(201) }, today)).toEqual({ error: expect.stringMatching(/200/) });
    expect(validateReceipt({ amount: "$1,047.75", receivedOn: today, reference: "  Statement 9 " }, today))
      .toEqual({ amountCents: 104775, receivedOn: today, reference: "Statement 9" });
  });

  it("prefills the remaining amount and records the payment against the chosen installment", async () => {
    h.responses = [receipt];
    const onOpenChange = open();
    expect((screen.getByLabelText("Amount received") as HTMLInputElement).value).toBe("47.75");
    fireEvent.change(screen.getByLabelText("Reference (optional)"), { target: { value: "Deposit 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()).toEqual([{
      p_request_id: expect.any(String), p_installment_id: (installments[1] as { id: string }).id, p_amount_cents: 4775,
      p_received_on: todayLocalIsoDate(), p_reference: "Deposit 3",
    }]);
    expect(screen.getByText("Enter a commission payment you received.")).toBeTruthy();
  });

  it("after an unknown outcome the inputs lock and Retry resends the same payment with the same request id", async () => {
    h.responses = [lost, receipt];
    const onOpenChange = open();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Amount received")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [first, second] = sent();
    expect(second).toEqual(first);
  });

  it("shows a refusal without sending an invalid amount", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/above \$0.00/);
    expect(sent()).toHaveLength(0);
  });

  it("a payment that committed but lost its response is never recorded twice after closing and reopening", async () => {
    h.server = { receipts: new Map(), loseNext: true };
    const onOpenChange = vi.fn();
    const view = render(dialog(true, onOpenChange));
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "40.00" } });
    fireEvent.change(screen.getByLabelText("Reference (optional)"), { target: { value: "Deposit 7" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't confirm/);
    // Routine dismissal and remount: the unresolved payment is kept, locked, with exactly what was submitted.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    view.rerender(dialog(false, onOpenChange));
    view.unmount();
    render(dialog(true, onOpenChange));
    expect((screen.getByLabelText("Amount received") as HTMLInputElement).value).toBe("40.00");
    expect((screen.getByLabelText("Reference (optional)") as HTMLInputElement).value).toBe("Deposit 7");
    expect(screen.getByLabelText("Amount received")).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toMatch(/Retry sends exactly the same change/);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
    const [first, second] = sent();
    expect(second).toEqual(first);
    expect(h.server.receipts.size).toBe(1);
  });

  it("opening the dialog re-reads the commission data", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    open();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["policy-commissions"] });
  });
});

describe("RecordPaymentDialog installment selection", () => {
  const paid = (amount: number) => ({ id: id(), amount_cents: amount, received_on: "2026-10-01", reference: null, recorded_by: id(),
    recorded_at: "2026-10-01T00:00:00Z", replaces_receipt_id: null, voided_at: null, void_reason: null });
  const list = () => [
    { id: id(), kind: "advance", expected_cents: 42975, receipts: [paid(20000)] },
    { id: id(), kind: "month_10", expected_cents: 4775, receipts: [] },
    { id: id(), kind: "month_11", expected_cents: 4775, receipts: [paid(4775)] },
    { id: id(), kind: "month_12", expected_cents: 4775, receipts: [] },
  ].map((installment) => ({ ...installment, timing_precision: "unknown", expected_on: null, timing_source: "unset" })) as never[];
  const choose = (target: { id: string }) => fireEvent.change(screen.getByLabelText("Expected payment"), { target: { value: target.id } });
  const amount = () => (screen.getByLabelText("Amount received") as HTMLInputElement).value;

  it("an untouched amount follows the selected installment: partial advance, Month 10, nothing remaining", () => {
    const items = list() as Array<{ id: string }>;
    render(dialog(true, vi.fn(), items as never[], items[0].id));
    expect(amount()).toBe("229.75");
    choose(items[1]);
    expect(amount()).toBe("47.75");
    choose(items[2]);
    expect(amount()).toBe("");
    choose(items[0]);
    expect(amount()).toBe("229.75");
  });

  it("an edited amount is cleared, with a note, when the installment changes; partial and excess amounts stay valid", async () => {
    const items = list() as Array<{ id: string }>;
    h.responses = [receipt];
    const onOpenChange = vi.fn();
    render(dialog(true, onOpenChange, items as never[], items[0].id));
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "100.00" } });
    choose(items[1]);
    expect(amount()).toBe("");
    expect(screen.getByRole("status").textContent).toMatch(/Amount cleared because you changed the expected payment/);
    choose(items[3]);
    expect(amount()).toBe("47.75");
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "60.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()[0]).toMatchObject({ p_installment_id: items[3].id, p_amount_cents: 6000 });
  });
});
