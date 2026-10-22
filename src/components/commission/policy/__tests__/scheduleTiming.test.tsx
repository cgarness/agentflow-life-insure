import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, responses: [] as Array<{ data: unknown; error: unknown }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: Record<string, unknown>) => (h.calls.push([name, args]), h.responses.shift() ?? { data: null, error: { message: "unset" } }) },
}));

import { InstallmentTimingDialog } from "../InstallmentTimingDialog";
import { ScheduleBasisControl } from "../ScheduleBasisControl";

const ESTIMATE = "00000000-0000-4000-8000-0000000000e1";
const ok = { data: { estimate_id: ESTIMATE, state_revision: 3, status: "ok" }, error: null };
const installment = { id: "00000000-0000-4000-8000-0000000000f1", kind: "month_10", expected_cents: 4775, timing_precision: "date",
  expected_on: "2027-08-02", expected_until: "2027-08-04", timing_source: "schedule_basis", receipts: [] };
const estimate = (startOn: string | null, source: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: ESTIMATE, state_revision: 2, schedule_start_on: startOn, schedule_start_source: source, schedule_assumed: false,
  schedule_frequency: null, ...extra,
}) as never;
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const callsTo = (name: string) => h.calls.filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => { h.calls = []; h.responses = []; });
afterEach(cleanup);

describe("payment date", () => {
  it("starts on Automatic for a scheduled payment; a month is stored as the first of that month", async () => {
    h.responses = [ok];
    const onOpenChange = vi.fn();
    mount(<InstallmentTimingDialog open onOpenChange={onOpenChange} installment={installment as never} estimateRevision={2} />);
    expect(screen.getByRole("dialog", { name: "Month 10 date" })).toBeTruthy();
    expect((screen.getByLabelText("Automatic") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Month"));
    fireEvent.change(screen.getByLabelText("Month", { selector: "input[type=month]" }), { target: { value: "2027-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(callsTo("set_policy_commission_installment_timing")[0]).toEqual({
      p_request_id: expect.any(String), p_installment_id: installment.id, p_expected_revision: 2, p_precision: "month", p_expected_on: "2027-08-01",
    });
  });

  it("an exact date is validated; Date needed and Automatic send no date", async () => {
    h.responses = [ok, ok, ok];
    mount(<InstallmentTimingDialog open onOpenChange={vi.fn()} installment={installment as never} estimateRevision={2} />);
    fireEvent.click(screen.getByLabelText("Exact date"));
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose the expected date/);
    expect(h.calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(callsTo("set_policy_commission_installment_timing")).toHaveLength(1));
    expect(callsTo("set_policy_commission_installment_timing")[0]).toMatchObject({ p_precision: "date", p_expected_on: "2027-08-20" });
    cleanup();
    const manual = { ...installment, timing_precision: "unknown", expected_on: null, expected_until: null, timing_source: "manual" };
    mount(<InstallmentTimingDialog open onOpenChange={vi.fn()} installment={manual as never} estimateRevision={3} />);
    expect((screen.getByLabelText("Date needed") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Automatic"));
    fireEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(callsTo("set_policy_commission_installment_timing")).toHaveLength(2));
    expect(callsTo("set_policy_commission_installment_timing")[1]).toMatchObject({ p_precision: "automatic", p_expected_on: null, p_expected_revision: 3 });
  });
});

describe("Edit dates", () => {
  it("shows where dates come from and never writes until saved", () => {
    mount(<ScheduleBasisControl estimate={estimate("2026-11-01", "effective_date", { schedule_assumed: true })} effectiveDate="2026-11-01" canWrite />);
    expect(screen.getByText("Estimated from effective date Nov 1, 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit dates" }));
    expect((screen.getByLabelText("Effective date (Nov 1, 2026)") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.calls).toHaveLength(0);
  });

  it("confirms the effective date, sets a first premium date, or clears to Date needed", async () => {
    h.responses = [ok, ok, ok];
    mount(<ScheduleBasisControl estimate={estimate("2026-11-01", "effective_date", { schedule_assumed: true })} effectiveDate="2026-11-01" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Edit dates" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(1));
    expect(callsTo("set_policy_commission_schedule_basis")[0]).toEqual({
      p_request_id: expect.any(String), p_estimate_id: ESTIMATE, p_expected_revision: 2, p_start_on: "2026-11-01", p_source: "effective_date",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit dates" }));
    fireEvent.click(screen.getByLabelText("First premium date", { selector: "input[type=radio]" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter the first premium date.");
    fireEvent.change(screen.getByLabelText("First premium date", { selector: "input[type=date]" }), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(2));
    expect(callsTo("set_policy_commission_schedule_basis")[1]).toMatchObject({ p_start_on: "2026-11-15", p_source: "manual" });
    fireEvent.click(await screen.findByRole("button", { name: "Edit dates" }));
    fireEvent.click(screen.getByLabelText("Date needed"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(3));
    expect(callsTo("set_policy_commission_schedule_basis")[2]).toMatchObject({ p_start_on: null, p_source: null });
  });

  it("without dates: Date needed, and the effective date cannot be chosen when the policy has none", () => {
    mount(<ScheduleBasisControl estimate={estimate(null)} effectiveDate={null} canWrite />);
    expect(screen.getByText("Date needed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit dates" }));
    expect((screen.getByLabelText("Effective date (none on the policy)") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("First premium date", { selector: "input[type=radio]" }) as HTMLInputElement).checked).toBe(true);
  });

  it("a first premium date and a non-monthly exception; read-only viewers get no controls", () => {
    mount(<ScheduleBasisControl estimate={estimate("2026-11-15", "manual", { schedule_frequency: "annual" })} effectiveDate="2026-11-01" canWrite={false} />);
    expect(screen.getByText("From first premium date Nov 15, 2026")).toBeTruthy();
    expect(screen.getByText("Annual premiums: Months 10–12 need dates.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
