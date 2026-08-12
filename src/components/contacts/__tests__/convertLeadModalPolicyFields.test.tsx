/**
 * Convert to Client — Sold Date / Effective Date / Draft Date / Payment Frequency.
 *
 * Pins the approved policy-date UX (implementation_plan.md, D2/D3/D4):
 *  - Issue Date is gone from the modal; Sold Date replaces it and defaults to the
 *    agent's LOCAL today while staying editable for prior-date sales;
 *  - Effective Date stays blank unless entered or explicitly copied ("Same as sold");
 *  - Draft Date is a real optional date; Payment Frequency defaults to Monthly and
 *    only offers the four canonical values;
 *  - the payload handed to conversionSupabaseApi.convertLeadToClient carries the new
 *    fields, and the onSuccess(clientId) → onClose ordering the Dialer gate depends
 *    on (invariant #11) is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { format } from "date-fns";

const h = vi.hoisted(() => ({
  errorToasts: [] as string[],
  convertCalls: [] as Array<{ lead: unknown; payload: Record<string, unknown>; organizationId: unknown; campaignId: unknown }>,
  callOrder: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const result = { data: [{ name: "Acme" }, { name: "Zenith" }], error: null };
    const query: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const m of ["select", "eq", "order", "in", "limit"]) query[m] = () => query;
    return query;
  };
  return { supabase: { from: () => makeQuery() } };
});

vi.mock("sonner", () => ({
  toast: { error: (msg: string) => h.errorToasts.push(msg), success: vi.fn() },
}));

vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { first_name: "Dana", last_name: "Agent" }, user: { id: "u-1" } }),
}));
vi.mock("@/lib/activityLogger", () => ({ logActivity: vi.fn(async () => undefined) }));

vi.mock("@/lib/supabase-conversion", () => ({
  conversionSupabaseApi: {
    convertLeadToClient: vi.fn(async (lead: unknown, payload: Record<string, unknown>, organizationId: unknown, campaignId: unknown) => {
      h.convertCalls.push({ lead, payload, organizationId, campaignId });
      return "client-123";
    }),
  },
}));

import ConvertLeadModal from "@/components/contacts/ConvertLeadModal";
import { todayLocalIsoDate } from "@/lib/policyPaymentFields";

const LEAD = { id: "lead-1", firstName: "Pat", lastName: "Lee" } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const todayIso = todayLocalIsoDate();
const todayDisplay = format(new Date(), "MM/dd/yyyy");

function renderModal(overrides: Partial<React.ComponentProps<typeof ConvertLeadModal>> = {}) {
  const onSuccess = vi.fn(() => h.callOrder.push("onSuccess"));
  const onClose = vi.fn(() => h.callOrder.push("onClose"));
  render(
    <ConvertLeadModal open={true} onClose={onClose} lead={LEAD} onSuccess={onSuccess} {...overrides} />
  );
  return { onSuccess, onClose };
}

const dateInputs = () => screen.getAllByPlaceholderText("MM/DD/YYYY") as HTMLInputElement[];
// Closed DateInput popovers render no month/year selects, so the visible comboboxes are
// exactly: [0] Policy Type, [1] Carrier, [2] Payment Frequency (DOM order).
const selects = () => screen.getAllByRole("combobox") as HTMLSelectElement[];

async function pickCarrier() {
  await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
  fireEvent.change(selects()[1], { target: { value: "Acme" } });
}

const convertButton = () => screen.getByRole("button", { name: /convert lead/i });

beforeEach(() => {
  h.errorToasts.length = 0;
  h.convertCalls.length = 0;
  h.callOrder.length = 0;
});

afterEach(() => cleanup());

describe("ConvertLeadModal — policy date & payment schedule fields", () => {
  it("shows Sold/Effective/Draft/Payment Frequency and never Issue Date", async () => {
    renderModal();
    expect(screen.getByText("Sold Date *")).toBeTruthy();
    expect(screen.getByText("Effective Date")).toBeTruthy();
    expect(screen.getByText("Draft Date")).toBeTruthy();
    expect(screen.getByText("Payment Frequency")).toBeTruthy();
    expect(screen.queryByText(/issue date/i)).toBeNull();
  });

  it("Sold Date defaults to the agent-local today; Effective and Draft start blank", () => {
    renderModal();
    const [sold, effective, draft] = dateInputs();
    expect(sold.value).toBe(todayDisplay);
    expect(effective.value).toBe("");
    expect(draft.value).toBe("");
  });

  it("Payment Frequency defaults to Monthly and offers exactly the four canonical values", () => {
    renderModal();
    const freq = selects()[2];
    expect(freq.value).toBe("monthly");
    const options = Array.from(freq.options).map((o) => [o.value, o.text]);
    expect(options).toEqual([
      ["monthly", "Monthly"],
      ["quarterly", "Quarterly"],
      ["semi_annual", "Semi-Annual"],
      ["annual", "Annual"],
    ]);
  });

  it("converts with the default schedule: soldDate=today, effective/draft blank, monthly", async () => {
    const { onSuccess, onClose } = renderModal({ campaignId: "camp-9" });
    await pickCarrier();
    fireEvent.click(convertButton());
    await waitFor(() => expect(h.convertCalls).toHaveLength(1));
    const { payload, organizationId, campaignId } = h.convertCalls[0];
    expect(payload.soldDate).toBe(todayIso);
    expect(payload.effectiveDate).toBe("");
    expect(payload.draftDate).toBe("");
    expect(payload.paymentFrequency).toBe("monthly");
    expect(payload.carrier).toBe("Acme");
    expect("issueDate" in payload).toBe(false);
    expect(organizationId).toBe("org-1");
    expect(campaignId).toBe("camp-9");
    // Dialer gate contract: onSuccess(clientId) fires BEFORE onClose.
    await waitFor(() => expect(h.callOrder).toEqual(["onSuccess", "onClose"]));
    expect(onSuccess).toHaveBeenCalledWith("client-123");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Sold Date is editable for prior-date sales; Sold ≠ Effective is allowed", async () => {
    renderModal();
    await pickCarrier();
    const [sold] = dateInputs();
    fireEvent.change(sold, { target: { value: "01/05/2026" } });
    fireEvent.change(dateInputs()[1], { target: { value: "02/03/2026" } });
    fireEvent.click(convertButton());
    await waitFor(() => expect(h.convertCalls).toHaveLength(1));
    expect(h.convertCalls[0].payload.soldDate).toBe("2026-01-05");
    expect(h.convertCalls[0].payload.effectiveDate).toBe("2026-02-03");
  });

  it("'Same as sold' copies the Sold Date into Effective Date without linking them", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /same as sold/i }));
    expect(dateInputs()[1].value).toBe(todayDisplay);
    // Still independently editable afterwards.
    fireEvent.change(dateInputs()[1], { target: { value: "03/01/2026" } });
    expect(dateInputs()[0].value).toBe(todayDisplay);
  });

  it("Draft Date and a non-monthly frequency persist to the payload (quarterly)", async () => {
    renderModal();
    await pickCarrier();
    fireEvent.change(dateInputs()[2], { target: { value: "02/15/2026" } });
    fireEvent.change(selects()[2], { target: { value: "quarterly" } });
    fireEvent.click(convertButton());
    await waitFor(() => expect(h.convertCalls).toHaveLength(1));
    expect(h.convertCalls[0].payload.draftDate).toBe("2026-02-15");
    expect(h.convertCalls[0].payload.paymentFrequency).toBe("quarterly");
  });

  it("carrier is still required (Zod) — no conversion call, error toast", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy());
    fireEvent.click(convertButton());
    await waitFor(() => expect(h.errorToasts.some((m) => /carrier is required/i.test(m))).toBe(true));
    expect(h.convertCalls).toHaveLength(0);
  });
});
