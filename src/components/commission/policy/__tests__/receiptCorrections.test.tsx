import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, responses: [] as Array<{ data: unknown; error: unknown }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: Record<string, unknown>) => (h.calls.push([name, args]), h.responses.shift() ?? { data: null, error: { message: "unset" } }) },
}));

import { VoidReceiptDialog } from "../VoidReceiptDialog";
import { ReceiptList } from "../ReceiptList";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const receipt = (extra: Record<string, unknown> = {}) => ({
  id: id(), amount_cents: 30000, received_on: "2026-10-18", reference: "Statement 42", recorded_by: id(), recorded_at: "2026-10-18T12:00:00Z",
  replaces_receipt_id: null, voided_at: null, void_reason: null, ...extra,
});
const active = receipt();
const installments = [
  { id: id(), kind: "advance", expected_cents: 42975, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts: [active] },
  { id: id(), kind: "month_10", expected_cents: 4775, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts: [] },
] as never[];
const voided = { data: { estimate_id: id(), state_revision: 6, status: "ok", replacement_receipt_id: null }, error: null };

function openVoid(onOpenChange = vi.fn()) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}>
    <VoidReceiptDialog open onOpenChange={onOpenChange} receipt={active as never} installments={installments} estimateRevision={5} />
  </QueryClientProvider>);
  return onOpenChange;
}
const sent = () => h.calls.filter(([name]) => name === "void_policy_commission_receipt").map(([, args]) => args);

beforeEach(() => { h.calls = []; h.responses = []; });
afterEach(cleanup);

describe("receipt corrections", () => {
  it("a void needs a reason; it is sent with the revision the user saw", async () => {
    h.responses = [voided];
    const onOpenChange = openVoid();
    fireEvent.click(screen.getByRole("button", { name: "Void payment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason of 3 to 200/);
    expect(sent()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Entered the wrong amount" } });
    fireEvent.click(screen.getByRole("button", { name: "Void payment" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()[0]).toEqual({ p_request_id: expect.any(String), p_receipt_id: active.id, p_expected_revision: 5,
      p_reason: "Entered the wrong amount", p_replacement: null });
  });

  it("can carry a corrected replacement in the same change", async () => {
    h.responses = [voided];
    const onOpenChange = openVoid();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong amount" } });
    fireEvent.click(screen.getByLabelText("Record a corrected payment in its place"));
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "429.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Void and replace" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()[0].p_replacement).toEqual({ installment_id: (installments[0] as { id: string }).id, amount_cents: 42975,
      received_on: "2026-10-18", reference: "Statement 42" });
  });

  it("a stale revision is explained and the dialog stays open", async () => {
    h.responses = [{ data: null, error: { code: "PT409", message: "Commission changed elsewhere; refresh and try again" } }];
    const onOpenChange = openVoid();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong amount" } });
    fireEvent.click(screen.getByRole("button", { name: "Void payment" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This commission changed elsewhere. Refresh and try again.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("lists voided receipts struck through with their reason, and offers Void only to writers", () => {
    const old = receipt({ voided_at: "2026-10-19T00:00:00Z", void_reason: "Duplicate entry" });
    const replacement = receipt({ replaces_receipt_id: old.id, reference: null });
    const onVoid = vi.fn();
    const { rerender } = render(<ReceiptList receipts={[old, replacement] as never[]} canWrite onVoid={onVoid} />);
    expect(screen.getByText("· void: Duplicate entry")).toBeTruthy();
    expect(screen.getByText("· correction")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Void" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(onVoid).toHaveBeenCalledWith(replacement);
    rerender(<ReceiptList receipts={[old, replacement] as never[]} canWrite={false} onVoid={onVoid} />);
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });
});
