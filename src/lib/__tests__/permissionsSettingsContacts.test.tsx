/**
 * Contacts Build 5 (CP2) — Settings → Permissions: Contacts module.
 *
 * Verifies the Contacts permission module renders from the shared catalog,
 * shows danger copy, surfaces conversion as a non-configurable system rule
 * (never a toggle), and persists a normalized `permissions.contacts` block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({ upsertArgs: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => Promise.resolve({ data: [], error: null }), // load → no stored rows → defaults
    upsert: (payload: Record<string, unknown>) => {
      h.upsertArgs.push(payload);
      return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "rp1" }, error: null }) }) };
    },
    insert: () => Promise.resolve({ data: null, error: null }), // activity_logs
  };
  return { supabase: { from: () => chain, auth: {} } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { organization_id: "o1", first_name: "A", last_name: "B" } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import Permissions from "@/components/settings/Permissions";

describe("Settings → Permissions — Contacts module", () => {
  beforeEach(() => {
    h.upsertArgs.length = 0;
  });

  it("renders the Contacts module from the catalog with danger copy, and conversion as a rule (not a toggle)", async () => {
    render(<Permissions />);
    // Waits for loadPermissions to resolve (loading spinner → content).
    expect(await screen.findByText("Contacts Permissions")).toBeInTheDocument();

    // Catalog-driven permissions render.
    expect(screen.getByText("View assigned leads")).toBeInTheDocument();
    expect(screen.getByText("Delete leads")).toBeInTheDocument();
    expect(screen.getByText("Import leads")).toBeInTheDocument();

    // Dangerous permissions show warning copy.
    expect(screen.getAllByText("Sensitive").length).toBeGreaterThan(0);

    // System rules panel surfaces the hardcoded boundaries, incl. universal conversion.
    expect(screen.getByText(/System rules/i)).toBeInTheDocument();

    // Conversion is NOT a permission toggle — no catalog row labelled as a convert action.
    expect(screen.queryByText(/^Convert lead/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Convert leads")).not.toBeInTheDocument();
  });

  it("persists a normalized permissions.contacts block on save", async () => {
    render(<Permissions />);
    await screen.findByText("Contacts Permissions");

    // Toggle any permission switch to mark the form dirty, then save.
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    fireEvent.click(switches[0]);

    const saveBtn = await screen.findByText("Save Permissions");
    fireEvent.click(saveBtn);

    await waitFor(() => expect(h.upsertArgs.length).toBeGreaterThan(0));
    const payload = h.upsertArgs[0] as { permissions?: { contacts?: Record<string, boolean> } };
    expect(payload.permissions?.contacts).toBeTypeOf("object");
    expect(payload.permissions?.contacts).toHaveProperty("contacts.leads.delete");
    expect(payload.permissions?.contacts).toHaveProperty("contacts.leads.view_assigned");
  });
});
