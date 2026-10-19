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
const installment = { id: "00000000-0000-4000-8000-0000000000f1", kind: "month_10", expected_cents: 4775, timing_precision: "unknown",
  expected_on: null, timing_source: "unset", receipts: [] };
const estimate = (startOn: string | null, source: string | null = null) => ({
  id: ESTIMATE, state_revision: 2, schedule_start_on: startOn, schedule_start_source: source,
}) as never;
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const callsTo = (name: string) => h.calls.filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => { h.calls = []; h.responses = []; });
afterEach(cleanup);

describe("installment timing", () => {
  it("a month is stored as the first of that month", async () => {
    h.responses = [ok];
    const onOpenChange = vi.fn();
    mount(<InstallmentTimingDialog open onOpenChange={onOpenChange} installment={installment as never} estimateRevision={2} />);
    fireEvent.click(screen.getByLabelText("Expected month"));
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2027-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Save timing" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(callsTo("set_policy_commission_installment_timing")[0]).toEqual({
      p_request_id: expect.any(String), p_installment_id: installment.id, p_expected_revision: 2, p_precision: "month", p_expected_on: "2027-08-01",
    });
  });

  it("an exact date, or back to unconfirmed", async () => {
    h.responses = [ok, ok];
    mount(<InstallmentTimingDialog open onOpenChange={vi.fn()} installment={installment as never} estimateRevision={2} />);
    fireEvent.click(screen.getByLabelText("Exact date"));
    fireEvent.click(screen.getByRole("button", { name: "Save timing" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose the expected date/);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save timing" }));
    await waitFor(() => expect(callsTo("set_policy_commission_installment_timing")).toHaveLength(1));
    expect(callsTo("set_policy_commission_installment_timing")[0]).toMatchObject({ p_precision: "date", p_expected_on: "2027-08-20" });
  });
});

describe("schedule basis", () => {
  it("offers the effective date but never applies it on its own", async () => {
    h.responses = [ok];
    mount(<ScheduleBasisControl estimate={estimate(null)} effectiveDate="2026-11-01" canWrite />);
    expect(screen.getByText(/Schedule start not confirmed/)).toBeTruthy();
    expect(h.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use effective date (Nov 1, 2026)" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(1));
    expect(callsTo("set_policy_commission_schedule_basis")[0]).toEqual({
      p_request_id: expect.any(String), p_estimate_id: ESTIMATE, p_expected_revision: 2, p_start_on: "2026-11-01", p_source: "effective_date",
    });
  });

  it("shows the resulting months, accepts a manual start and can be cleared", async () => {
    h.responses = [ok, ok];
    mount(<ScheduleBasisControl estimate={estimate("2026-11-15", "manual")} effectiveDate={null} canWrite />);
    expect(screen.getByText(/Months 10–12: Aug 2027 – Oct 2027/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change start" }));
    fireEvent.change(screen.getByLabelText("Schedule start date"), { target: { value: "2027-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(1));
    expect(callsTo("set_policy_commission_schedule_basis")[0]).toMatchObject({ p_start_on: "2027-01-31", p_source: "manual" });
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(callsTo("set_policy_commission_schedule_basis")).toHaveLength(2));
    expect(callsTo("set_policy_commission_schedule_basis")[1]).toMatchObject({ p_start_on: null, p_source: null });
  });

  it("read-only viewers see the basis without controls", () => {
    mount(<ScheduleBasisControl estimate={estimate("2026-11-15", "effective_date")} effectiveDate="2026-11-01" canWrite={false} />);
    expect(screen.getByText(/\(effective date\)/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
