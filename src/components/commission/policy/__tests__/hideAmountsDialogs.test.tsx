/**
 * Hide amounts inside the reused commission controls (Commissions Center only): no blind payment, void, confirmation
 * or date edit; nothing is revealed by opening a dialog; typed values, the request id and an unresolved payment survive
 * hiding and showing; the calculator masks its level and figures and keeps its inputs. Outside the provider (the
 * contact view) everything is shown as before.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, loseNext: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      if (h.loseNext) { h.loseNext = false; return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } }; }
      return { data: { receipt_id: "00000000-0000-4000-8000-0000000000f1", status: "recorded", idempotent: false }, error: null };
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000a1" }, isImpersonating: false,
    profile: { id: "00000000-0000-4000-8000-0000000000a1", role: "Agent", organization_id: "00000000-0000-4000-8000-0000000000e1" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));

import { AmountsVisibilityProvider } from "@/components/commission/ui/AmountsVisibility";
import CalculatorWorkspace from "@/components/commission/calculator/CalculatorWorkspace";
import { resetUnresolvedTrackingWrites } from "@/hooks/useClientPolicyCommissions";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import { amountsPreferenceKey } from "@/lib/commission/amountsPreference";
import { CaptureAttentionNotice } from "../CaptureAttentionNotice";
import { RecordPaymentDialog } from "../RecordPaymentDialog";
import { ScheduleBasisControl } from "../ScheduleBasisControl";
import { VoidReceiptDialog } from "../VoidReceiptDialog";

const USER = "00000000-0000-4000-8000-0000000000a1";
const ORG = "00000000-0000-4000-8000-0000000000e1";
const KEY = amountsPreferenceKey(USER, ORG);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receipt = { id: ID(90), amount_cents: 12345, received_on: "2026-10-01", reference: null, recorded_by: USER, recorded_at: "2026-10-01T00:00:00Z",
  replaces_receipt_id: null, voided_at: null, void_reason: null };
const installments = ["advance", "month_10", "month_11", "month_12"].map((kind, i) => ({
  id: ID(i + 1), kind, expected_cents: i === 0 ? 42975 : 4775, timing_precision: "unknown", expected_on: null, timing_source: "unset",
  receipts: i === 0 ? [receipt] : [],
})) as never[];
const estimate = { id: ID(70), status: "active", schedule_start_on: "2026-11-01", schedule_start_source: "effective_date", schedule_assumed: true,
  schedule_frequency: null, state_revision: 2, installments } as never;
const policy = { policy_id: ID(80), access: "write", state: "awaiting_confirmation", credited_agent_id: USER,
  capture: { id: ID(81), status: "awaiting_confirmation", attention_code: null, first_year_cents: 57300, advance_cents: 42975 } } as never;

const MONEY = /\$\s?\d/;
let client: QueryClient;
function wrap(node: React.ReactNode, provider = true) {
  const body = <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  return render(provider ? <AmountsVisibilityProvider userId={USER} organizationId={ORG}>{body}</AmountsVisibilityProvider> : body);
}
/** Another tab of this browser hides amounts (the page's eye control is behind the modal). */
const hideElsewhere = () => act(() => {
  window.localStorage.setItem(KEY, "1");
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
});
const amountBox = () => screen.queryByRole("textbox", { name: "Amount received" }) as HTMLInputElement | null;
const sent = () => h.calls.filter(([n]) => n === "record_policy_commission_receipt").map(([, a]) => a);

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  h.calls = []; h.loseNext = false;
  resetUnresolvedTrackingWrites();
  window.localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("Hide amounts in commission dialogs", () => {
  it("opening Record payment while hidden reveals nothing and offers no submit; Show amounts is explicit", () => {
    window.localStorage.setItem(KEY, "1");
    wrap(<RecordPaymentDialog open onOpenChange={vi.fn()} installments={installments} initialInstallmentId={ID(2)} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Amounts are hidden")).toBeInTheDocument();
    expect(amountBox()).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Record payment" })).toBeNull();
    expect(dialog.textContent).not.toMatch(MONEY);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show amounts" }));
    expect(amountBox()?.value).toBe("47.75");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("typed values, the request id and an unresolved payment survive hiding and showing; Retry resends the same payment", async () => {
    wrap(<RecordPaymentDialog open onOpenChange={vi.fn()} installments={installments} initialInstallmentId={ID(2)} />);
    fireEvent.change(amountBox()!, { target: { value: "12.34" } });
    hideElsewhere();
    expect(amountBox()).toBeNull();
    expect(screen.getByRole("dialog").textContent).not.toMatch(MONEY);
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect(amountBox()?.value).toBe("12.34");
    h.loseNext = true;
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't confirm/);
    hideElsewhere();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect(amountBox()?.value).toBe("12.34");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toEqual(sent()[0]);
    expect(sent()[0]).toMatchObject({ p_amount_cents: 1234, p_installment_id: ID(2) });
  });

  it("Void: the description's amount is masked and the form gated", () => {
    window.localStorage.setItem(KEY, "1");
    wrap(<VoidReceiptDialog open onOpenChange={vi.fn()} receipt={receipt as never} installments={installments} estimateRevision={2} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("•••• received Oct 1, 2026");
    expect(within(dialog).queryByRole("button", { name: "Void payment" })).toBeNull();
    expect(dialog.textContent).not.toMatch(MONEY);
  });

  it("an estimate awaiting confirmation is never confirmed blind; Edit dates waits for Show amounts", () => {
    window.localStorage.setItem(KEY, "1");
    wrap(<><CaptureAttentionNotice policy={policy} onRecordLater={vi.fn()} /><ScheduleBasisControl estimate={estimate} effectiveDate="2026-11-01" canWrite /></>);
    expect(screen.queryByRole("button", { name: "Confirm estimate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit dates" })).toBeNull();
    expect(document.body.textContent).not.toMatch(MONEY);
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect(screen.getByRole("button", { name: "Confirm estimate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit dates" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("$573.00 first-year");
  });

  it("outside the Commissions Center (no provider) everything is shown as before", () => {
    window.localStorage.setItem(KEY, "1");
    wrap(<RecordPaymentDialog open onOpenChange={vi.fn()} installments={installments} initialInstallmentId={ID(2)} />, false);
    expect(amountBox()?.value).toBe("47.75");
    expect(screen.queryByText("Amounts are hidden")).toBeNull();
  });

  it("Calculator: level and figures masked, inputs kept but closed while hidden", () => {
    wrap(<CalculatorWorkspace context={syntheticContext("100")} />);
    fireEvent.change(screen.getByLabelText("Client age"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Monthly premium"), { target: { value: "100" } });
    hideElsewhere();
    expect(screen.getByText("Your level:").textContent).toBe("Your level: ••••");
    expect(screen.queryByRole("textbox", { name: "Monthly premium" })).toBeNull();
    expect(document.body.textContent).not.toMatch(MONEY);
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect((screen.getByLabelText("Monthly premium") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Client age") as HTMLInputElement).value).toBe("40");
    expect(screen.getByText("Your level:").textContent).toBe("Your level: 100");
  });
});
