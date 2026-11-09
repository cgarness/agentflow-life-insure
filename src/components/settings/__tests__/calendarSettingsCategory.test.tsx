/** CalendarSettings category flow (Reports V2 PKG-D, D4 §4): classify a custom type; locked defaults are read-only. */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ updates: [] as Array<{ table: string; values: unknown; eq: Record<string, unknown> }>, reloads: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const rec = { table, values: null as unknown, eq: {} as Record<string, unknown> };
    const b: Record<string, unknown> = {};
    for (const k of ["order", "limit", "in", "gte", "lte", "neq", "or", "is"]) b[k] = () => b;
    b.eq = (c: string, v: unknown) => { rec.eq[c] = v; return b; };
    b.update = (v: unknown) => { rec.values = v; h.updates.push(rec); return b; };
    b.select = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (y: (v: unknown) => unknown) => Promise.resolve({ data: rec.values ? [{ id: "t-custom" }] : [], error: null }).then(y);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { id: "u1", role: "Admin", organization_id: ORG, first_name: "A", last_name: "B" } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Admin", isAdmin: true }) }));
vi.mock("@/contexts/UnsavedChangesContext", () => ({ useUnsavedChanges: () => ({ registerDirty: () => () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn(), info: vi.fn() } }));
const TYPES = [
  { id: "t-locked", organizationId: ORG, name: "Sales Call", color: "#3B82F6", durationMinutes: 30, sortOrder: 10, isDefault: true, isLocked: true,
    isActive: true, businessCategory: "sales", createdBy: null, createdAt: null, updatedAt: null },
  { id: "t-custom", organizationId: ORG, name: "Discovery", color: "#123456", durationMinutes: 30, sortOrder: 20, isDefault: false, isLocked: false,
    isActive: true, businessCategory: "unclassified", createdBy: null, createdAt: null, updatedAt: null },
];
vi.mock("@/hooks/useAppointmentTypes", () => ({ useAppointmentTypes: () => ({ types: TYPES, loading: false, error: null, reload: async () => { h.reloads += 1; } }) }));
import CalendarSettings from "@/components/settings/CalendarSettings";

afterEach(cleanup);
describe("CalendarSettings category control", () => {
  it("classifies a custom type and reloads; a locked default shows its category read-only", async () => {
    render(<MemoryRouter><CalendarSettings /></MemoryRouter>);
    const select = await screen.findByLabelText("Category for Discovery") as HTMLSelectElement;
    // The locked default shows its category as text (a span), not a control.
    expect(screen.getAllByText("Sales appointment").some((e) => e.tagName === "SPAN")).toBe(true);
    expect(screen.queryByLabelText("Category for Sales Call")).toBeNull();
    fireEvent.change(select, { target: { value: "sales" } });
    await waitFor(() => expect(h.updates.some((u) => u.table === "appointment_types")).toBe(true));
    expect(h.updates.find((u) => u.table === "appointment_types")).toMatchObject({ values: { business_category: "sales" }, eq: { id: "t-custom", organization_id: ORG } });
    await waitFor(() => expect(h.reloads).toBeGreaterThan(0));
  });
});
