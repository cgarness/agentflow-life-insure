import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Phone } from "lucide-react";

/**
 * The shared detail-modal frame (an accessible dialog), and plan rev 1 §2A: a detail
 * modal uses the scope of the surface that opened it.
 */

const h = vi.hoisted(() => ({ page: vi.fn(), reportsScope: "team" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/dashboard-callbacks", async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchCallbackPage: h.page }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ getDataScope: () => h.reportsScope }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { organization_id: "org-1" }, isImpersonating: false }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DashboardModalShell } from "@/components/dashboard/ui/DashboardModalShell";
import DashboardDetailModal from "@/components/dashboard/DashboardDetailModal";

const USER = "aaaa0000-0000-4000-8000-000000000001";

beforeEach(() => {
  h.page.mockReset().mockResolvedValue([]);
  h.reportsScope = "team";
});
afterEach(cleanup);

describe("DashboardModalShell", () => {
  it("is a labelled dialog that moves focus inside and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <DashboardModalShell open onClose={onClose} tone="blue" icon={Phone} title="Calls Made (day)" description="Team"
        footer={<button type="button">Close</button>}>
        <p>rows</p>
      </DashboardModalShell>,
    );
    const dialog = screen.getByRole("dialog", { name: "Calls Made (day)" });
    expect(dialog).toHaveAccessibleDescription("Team");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("detail modal scope follows its opener (§2A)", () => {
  const open = (origin: "kpi" | "widget", role: string, adminToggle: "team" | "my") =>
    render(
      <MemoryRouter>
        <DashboardDetailModal isOpen onClose={() => {}} type="callbacks" origin={origin} userId={USER} role={role} adminToggle={adminToggle} />
      </MemoryRouter>,
    );

  it("a Team Leader's widget-opened list matches the widget: own items, with a note", async () => {
    open("widget", "Team Leader", "team");
    await waitFor(() => expect(h.page).toHaveBeenCalled());
    expect(h.page.mock.calls[0][0]).toMatchObject({ isFiltered: true, userId: USER });
    expect(await screen.findByText(/^Showing your own callbacks\./)).toBeInTheDocument();
  });

  it("a KPI-opened modal keeps the KPI rule", async () => {
    open("kpi", "Team Leader", "team");
    await waitFor(() => expect(h.page).toHaveBeenCalled());
    expect(h.page.mock.calls[0][0]).toMatchObject({ isFiltered: false });
    expect(screen.queryByText(/^Showing your own/)).not.toBeInTheDocument();
  });

  it("an Admin's Team perspective is unfiltered from either opener", async () => {
    open("widget", "Admin", "team");
    await waitFor(() => expect(h.page).toHaveBeenCalled());
    expect(h.page.mock.calls[0][0]).toMatchObject({ isFiltered: false });
  });
});
