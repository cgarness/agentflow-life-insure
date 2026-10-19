import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, responses: [] as Array<{ data: unknown; error: unknown }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: Record<string, unknown>) => (h.calls.push([name, args]), h.responses.shift() ?? { data: null, error: { message: "unset" } }) },
}));

import { RecordPaymentDialog } from "../RecordPaymentDialog";
import { validateReceipt } from "@/lib/commission/installments";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const installments = ["advance", "month_10", "month_11", "month_12"].map((kind, index) => ({
  id: id(), kind, expected_cents: index === 0 ? 42975 : 4775, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts: [],
})) as never[];
const receipt = { data: { receipt_id: "00000000-0000-4000-8000-0000000000f1", status: "recorded", idempotent: false }, error: null };
const lost = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };

function open(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <RecordPaymentDialog open onOpenChange={onOpenChange} installments={installments} initialInstallmentId={(installments[1] as { id: string }).id} />
  </QueryClientProvider>);
  return onOpenChange;
}
const sent = () => h.calls.filter(([name]) => name === "record_policy_commission_receipt").map(([, args]) => args);

beforeEach(() => { h.calls = []; h.responses = []; });
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
    expect(screen.getByText(/manual record, not a carrier statement/)).toBeTruthy();
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
});
