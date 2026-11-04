/** AppointmentModal outcome flow (Reports V2 PKG-D, D4 §4): Held / No show on a started slot; the link prompt mount. */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAppointment } from "@/contexts/CalendarContext";

const ORG = "11111111-1111-4111-8111-111111111111";
const APPT = "00000000-0000-4000-8000-0000000000a1";
const h = vi.hoisted(() => ({ types: [] as unknown[], rpc: [] as Array<[string, Record<string, unknown>]>, response: null as unknown, toasts: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "or", "order", "limit", "gte", "lte", "in"]) b[k] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (y: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(y);
    return b;
  };
  return { supabase: { from: () => builder(), rpc: (n: string, a: Record<string, unknown>) => { h.rpc.push([n, a]); return Promise.resolve(h.response); },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { id: "u1", first_name: "A", last_name: "B", role: "Admin", organization_id: ORG } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG }) }));
// A stable reference: the modal's init effect depends on the types array.
vi.mock("@/hooks/useAppointmentTypes", () => ({ useAppointmentTypes: () => ({ types: h.types }) }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.toasts.push(m), error: (m: string) => h.toasts.push(`error:${m}`), message: () => {}, info: () => {} } }));
import AppointmentModal from "@/components/calendar/AppointmentModal";

const editing = (over: Partial<CalendarAppointment> = {}): CalendarAppointment => ({
  id: APPT, title: "Sales call", type: "Sales Call", status: "Scheduled", date: new Date("2026-10-05T17:00:00Z"), startTime: "10:00", endTime: "10:30",
  contactName: "Pat", contactId: "", agent: "u1", notes: "", start_time: "2026-10-05T17:00:00Z", raw_status: "Scheduled", user_id: "u1", ...over });
const show = (e: CalendarAppointment, onClose = vi.fn()) => {
  render(<MemoryRouter><AppointmentModal open onClose={onClose} onSave={vi.fn()} editing={e} /></MemoryRouter>);
  return onClose;
};
beforeEach(() => { h.rpc = []; h.toasts = []; });
afterEach(cleanup);

describe("AppointmentModal outcome (D4 §4)", () => {
  it("records Held for a started open slot and closes", async () => {
    h.response = { data: { appointment_id: APPT, request_id: APPT, outcome: "held", status: "Completed", start_time: "2026-10-05T17:00:00Z" }, error: null };
    const onClose = show(editing());
    fireEvent.click(screen.getByRole("button", { name: "Held" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.rpc).toEqual([["record_appointment_outcome", expect.objectContaining({ p_appointment_id: APPT, p_expected_start: "2026-10-05T17:00:00Z", p_outcome: "held" })]]);
    expect(h.toasts).toContain("Outcome recorded");
  });
  it("records No show; a refused outcome keeps the modal open with the D4 copy", async () => {
    h.response = { data: null, error: { code: "PT409", message: "changed" } };
    const onClose = show(editing());
    fireEvent.click(screen.getByRole("button", { name: "No show" }));
    expect(await screen.findByText("Outcome recording is temporarily unavailable")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.rpc[0][1]).toMatchObject({ p_outcome: "no_show" });
  });
  it("offers no outcome on a future or resolved slot", () => {
    show(editing({ start_time: "2999-01-01T00:00:00Z" }));
    expect(screen.queryByRole("button", { name: "Held" })).toBeNull(); cleanup();
    show(editing({ status: "Completed", raw_status: "Completed" }));
    expect(screen.queryByRole("button", { name: "Held" })).toBeNull();
  });
});
