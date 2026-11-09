/** ConvertLeadModal closing-appointment flow (Reports V2 PKG-D, D4 §4): choose a held sales appointment for the sale. */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const APPT = "00000000-0000-4000-8000-0000000000a1";
const h = vi.hoisted(() => ({ requestIds: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "in", "limit", "gte", "lt"]) q[k] = () => q;
    const result = table === "appointment_types" ? { data: [{ name: "Sales Call" }], error: null }
      : table === "appointments" ? { data: [{ id: APPT, start_time: "2026-10-05T17:00:00Z", title: "Sales call", type: "Sales Call" }], error: null }
      : { data: [{ name: "Acme" }], error: null };
    q.abortSignal = () => Promise.resolve(result);
    q.then = (y: (v: unknown) => unknown) => Promise.resolve(result).then(y);
    return q;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { first_name: "Dana", last_name: "Agent" }, user: { id: "u-1" }, isImpersonating: false }) }));
vi.mock("@/lib/activityLogger", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/components/commission/preview/PolicyCommissionEstimate", () => ({ PolicyCommissionEstimate: () => null }));
vi.mock("@/lib/supabase-conversion", () => ({
  conversionSupabaseApi: {
    convertLeadToClientHandoff: vi.fn(async (_a: unknown, _l: unknown, _p: unknown, _o: unknown, _c: unknown, requestId: string) => {
      h.requestIds.push(requestId);
      return { clientId: "client-123", winIds: [], idempotent: false, client: null, commission: { status: "evidence_recorded", slots: [] } };
    }),
  },
}));
import ConvertLeadModal from "@/components/contacts/ConvertLeadModal";
import { hasClosingAppointmentSelection, resetAppointmentLinkRetry } from "@/lib/appointmentLinkRetry";

afterEach(() => { cleanup(); resetAppointmentLinkRetry(); });
describe("ConvertLeadModal closing appointment (D-A1)", () => {
  it("is optional; the chosen appointment is registered under the conversion's sale request id", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConvertLeadModal open onClose={vi.fn()} lead={{ id: "lead-1", firstName: "Pat", lastName: "Lee" } as never} onSuccess={vi.fn()} />
    </QueryClientProvider>);
    const field = await screen.findByLabelText("Closing appointment (optional)") as HTMLSelectElement;
    expect(field.value).toBe("not_recorded");
    fireEvent.change(field, { target: { value: APPT } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /convert/i }));
    await waitFor(() => expect(h.requestIds).toHaveLength(1));
    expect(hasClosingAppointmentSelection(h.requestIds[0])).toBe(true);
  });
});
