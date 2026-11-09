import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown, types: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "gte", "lt", "order", "limit"]) q[k] = () => q;
  q.abortSignal = () => Promise.resolve(table === "appointment_types"
    ? { data: (h.types as Array<{ name: string; businessCategory: string }>).filter((t) => t.businessCategory === "sales"), error: null }
    : { data: h.rows, error: h.error });
  return q;
} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isImpersonating: false }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "o1" }) }));
import { ClosingAppointmentField } from "../ClosingAppointmentField";
import { hasClosingAppointmentSelection, resetAppointmentLinkRetry } from "@/lib/appointmentLinkRetry";

const APPT = "00000000-0000-4000-8000-0000000000a1";
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <ClosingAppointmentField saleRequestId="sale-1" contactIds={["c1"]} soldDate="2026-10-12" /></QueryClientProvider>);
beforeEach(() => { resetAppointmentLinkRetry(); h.error = null; h.rows = [{ id: APPT, start_time: "2026-10-05T17:00:00Z", title: "Sales call", type: "Sales Call" }];
  h.types = [{ name: "Sales Call", businessCategory: "sales" }, { name: "Follow Up", businessCategory: "follow_up" }]; });
afterEach(cleanup);

describe("ClosingAppointmentField (D-A1)", () => {
  it("is optional, defaults to Not recorded, and registers a chosen held appointment under the sale request id", async () => {
    show();
    const select = await screen.findByLabelText("Closing appointment (optional)") as HTMLSelectElement;
    expect(select.value).toBe("not_recorded");
    expect(hasClosingAppointmentSelection("sale-1")).toBe(false);
    fireEvent.change(select, { target: { value: APPT } });
    expect(hasClosingAppointmentSelection("sale-1")).toBe(true);
    fireEvent.change(select, { target: { value: "not_recorded" } });
    expect(hasClosingAppointmentSelection("sale-1")).toBe(false);
  });
  it("is hidden with no candidates, on a load failure and without a sales type", async () => {
    h.rows = [];
    const empty = show();
    await waitFor(() => expect(empty.container).toBeEmptyDOMElement());
    cleanup(); h.rows = []; h.error = { message: "denied" };
    expect(show().container).toBeEmptyDOMElement();
    cleanup(); h.error = null; h.types = [{ name: "Follow Up", businessCategory: "follow_up" }];
    expect(show().container).toBeEmptyDOMElement();
  });
});
