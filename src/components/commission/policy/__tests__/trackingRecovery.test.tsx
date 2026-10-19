import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Every dialog on the shared tracking helper: after an unknown outcome, closing and reopening (or remounting) keeps
 * the submitted change locked, and Retry resends exactly that change with its request id.
 */
const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, responses: [] as Array<{ data: unknown; error: unknown }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: Record<string, unknown>) => (h.calls.push([name, args]), h.responses.shift() ?? { data: null, error: { message: "unset" } }) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000a1" }, isImpersonating: false,
    profile: { id: "00000000-0000-4000-8000-0000000000a1", role: "Agent", organization_id: "00000000-0000-4000-8000-0000000000e1" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));
vi.mock("@/components/commission/preview/PolicyCommissionEstimate", () => ({
  PolicyCommissionEstimate: ({ onCaptureChange }: { onCaptureChange: (inputs: unknown) => void }) => (
    <button type="button" onClick={() => onCaptureChange({ product_id: "p", first_year_cents: 57300, advance_cents: 42975 })}>Pick estimate</button>
  ),
}));

import { resetUnresolvedTrackingWrites } from "@/hooks/useClientPolicyCommissions";
import { CaptureAttentionNotice } from "../CaptureAttentionNotice";
import { CommissionHoldDialog } from "../CommissionHoldDialog";
import { InstallmentTimingDialog } from "../InstallmentTimingDialog";
import { RecordEstimateDialog } from "../RecordEstimateDialog";
import { ScheduleBasisControl } from "../ScheduleBasisControl";
import { VoidReceiptDialog } from "../VoidReceiptDialog";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lost = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
const state = { data: { estimate_id: ID(1), state_revision: 3, status: "ok" }, error: null };
const receipt = { id: ID(30), amount_cents: 5000, received_on: "2026-10-01", reference: null, recorded_by: ID(2), recorded_at: "2026-10-01T00:00:00Z",
  replaces_receipt_id: null, voided_at: null, void_reason: null };
const installment = { id: ID(20), kind: "advance", expected_cents: 42975, timing_precision: "unknown", expected_on: null, timing_source: "unset",
  receipts: [receipt] };
const estimate = { id: ID(1), status: "active", status_reason: null, state_revision: 2, schedule_start_on: null, schedule_start_source: null,
  installments: [installment] };
const capture = { id: ID(40), status: "awaiting_confirmation", attention_code: null, first_year_cents: 57300, advance_cents: 42975 };
const policy = { policy_id: ID(50), access: "write", credited_agent_id: ID(2), estimate: null, capture,
  basis: { policy_type: "Term", carrier: "Synthetic Life", monthly_premium: "50.00", premium_source: "sale_snapshot", effective_date: null } };

let client: QueryClient;
const wrap = (node: React.ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
const sent = (name: string) => h.calls.filter(([n]) => n === name).map(([, args]) => args);

/** Submit, lose the response, unmount, remount, and check the locked retry resends the identical call. */
async function lostThenRetried(name: string, mount: () => React.ReactNode, submit: () => void, retryLabel: RegExp,
  whileUnresolved?: () => void) {
  const first = render(wrap(mount()));
  submit();
  await waitFor(() => expect(sent(name)).toHaveLength(1));
  await screen.findByText(/couldn't confirm/);
  first.unmount();
  render(wrap(mount()));
  const retry = await screen.findByRole("button", { name: retryLabel });
  whileUnresolved?.();
  fireEvent.click(retry);
  await waitFor(() => expect(sent(name)).toHaveLength(2));
  const [a, b] = sent(name);
  expect(b).toEqual(a);
}

beforeEach(() => {
  h.calls = [];
  h.responses = [];
  resetUnresolvedTrackingWrites();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("unknown outcomes survive dismissal and remount in every tracking dialog", () => {
  it("void: the reason stays locked and Retry resends the same void", async () => {
    h.responses = [lost, { data: { ...state.data, replacement_receipt_id: null }, error: null }];
    await lostThenRetried("void_policy_commission_receipt",
      () => <VoidReceiptDialog open onOpenChange={vi.fn()} receipt={receipt as never} installments={[installment] as never} estimateRevision={2} />,
      () => {
        fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Entered twice" } });
        fireEvent.click(screen.getByRole("button", { name: "Void payment" }));
      }, /^Retry$/);
    expect(sent("void_policy_commission_receipt")[0]).toMatchObject({ p_reason: "Entered twice" });
  });

  it("void: the remounted dialog shows the submitted reason, locked", async () => {
    h.responses = [lost];
    const first = render(wrap(<VoidReceiptDialog open onOpenChange={vi.fn()} receipt={receipt as never} installments={[installment] as never} estimateRevision={2} />));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Entered twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Void payment" }));
    await screen.findByText(/couldn't confirm/);
    first.unmount();
    render(wrap(<VoidReceiptDialog open onOpenChange={vi.fn()} receipt={receipt as never} installments={[installment] as never} estimateRevision={2} />));
    expect((screen.getByLabelText("Reason") as HTMLInputElement).value).toBe("Entered twice");
    expect(screen.getByLabelText("Reason")).toBeDisabled();
  });

  it("timing", async () => {
    h.responses = [lost, state];
    await lostThenRetried("set_policy_commission_installment_timing",
      () => <InstallmentTimingDialog open onOpenChange={vi.fn()} installment={installment as never} estimateRevision={2} />,
      () => {
        fireEvent.click(screen.getByLabelText("Exact date"));
        fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-20" } });
        fireEvent.click(screen.getByRole("button", { name: "Save timing" }));
      }, /^Retry$/);
  });

  it("hold", async () => {
    h.responses = [lost, state];
    await lostThenRetried("set_policy_commission_hold",
      () => <CommissionHoldDialog open onOpenChange={vi.fn()} estimate={estimate as never} />,
      () => {
        fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Carrier review" } });
        fireEvent.click(screen.getByRole("button", { name: "Place on hold" }));
      }, /^Retry$/);
  });

  it("schedule start (inline control remounted with the detail)", async () => {
    h.responses = [lost, state];
    await lostThenRetried("set_policy_commission_schedule_basis",
      () => <ScheduleBasisControl estimate={estimate as never} effectiveDate="2026-11-01" canWrite />,
      () => fireEvent.click(screen.getByRole("button", { name: /Use effective date/ })), /^Retry$/,
      () => {
        expect(screen.getByText(/Unconfirmed change: start Nov 1, 2026/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Use effective date/ })).toBeNull();
      });
  });

  it("record estimate: the submitted figures are shown and resent unchanged", async () => {
    h.responses = [lost, { data: { estimate_id: ID(60), status: "recorded" }, error: null }];
    await lostThenRetried("record_policy_commission_estimate_later",
      () => <RecordEstimateDialog open onOpenChange={vi.fn()} policy={policy as never} replace={false} />,
      () => {
        fireEvent.click(screen.getByRole("button", { name: "Pick estimate" }));
        fireEvent.click(screen.getByRole("button", { name: "Record estimate" }));
      }, /^Retry$/,
      () => {
        expect(screen.getByRole("status").textContent).toMatch(/Submitted estimate: \$573\.00 first-year, \$429\.75 advance/);
        expect(screen.queryByRole("button", { name: "Pick estimate" })).toBeNull();
      });
  });

  it("capture confirmation and dismissal", async () => {
    h.responses = [lost, { data: { estimate_id: ID(61), status: "recorded" }, error: null }];
    await lostThenRetried("confirm_policy_commission_capture",
      () => <CaptureAttentionNotice policy={policy as never} onRecordLater={vi.fn()} />,
      () => fireEvent.click(screen.getByRole("button", { name: "Confirm estimate" })), /Retry confirm/);

    cleanup();
    h.calls = [];
    h.responses = [lost, { data: { status: "dismissed", capture_id: capture.id }, error: null }];
    await lostThenRetried("dismiss_policy_commission_capture",
      () => <CaptureAttentionNotice policy={policy as never} onRecordLater={vi.fn()} />,
      () => {
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        fireEvent.change(screen.getByLabelText("Reason for dismissing"), { target: { value: "Rate was corrected" } });
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      }, /^Retry$/);
  });
});
