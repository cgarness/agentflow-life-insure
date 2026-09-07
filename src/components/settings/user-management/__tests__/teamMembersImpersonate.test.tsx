/**
 * The SECOND "View As" entry point: Settings → Team Members → Impersonate.
 *
 * `ViewAsModal` has had a caller-contract suite since the activation became server-authoritative;
 * its twin here had none, and drifted:
 *
 *   1. NO REJECTION PATH. The handler ran `try { activated = await startImpersonation(u.id) }
 *      finally { setImpersonatingId(null) }` inside a `void (async () => …)()`. `finally` cleared
 *      the lock but could neither report the failure nor stop what followed, so a rejection became
 *      an unhandled rejection: the operator saw the row snap back from "Starting…" to "Impersonate"
 *      with no explanation. `ViewAsModal` had already added a `catch` for exactly this.
 *   2. IT NAVIGATED TO `/dashboard`, which reads `useAuth().user` — the real operator — so it
 *      showed their own numbers under the viewed agent's name. `/dashboard` is now refused by the
 *      route guard outright, so a successful activation landed on a refusal notice.
 */

import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** How `startImpersonation` behaves: resolve true, resolve false, or reject. */
  mode: "ok" as "ok" | "refuse" | "reject",
  calls: [] as string[],
  navigations: [] as string[],
  toasts: [] as { title?: string; description?: string; variant?: string }[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "operator-1" },
    startImpersonation: (id: string) => {
      state.calls.push(id);
      if (state.mode === "reject") return Promise.reject(new Error("transport exploded"));
      return Promise.resolve(state.mode === "ok");
    },
  }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => (to: string) => { state.navigations.push(to); },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: Record<string, string>) => { state.toasts.push(t); } }),
}));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: { update: () => Promise.resolve({}), updateBilling: () => Promise.resolve({}) },
}));
/**
 * Render the row menu INLINE.
 *
 * Radix's dropdown needs pointer capture and layout that jsdom does not provide, so the menu never
 * opens under test. What is under test here is the Impersonate HANDLER, not Radix's popover — so
 * the primitives become plain wrappers and `DropdownMenuItem` keeps its real `onClick`, which is
 * the whole contract being asserted.
 */
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
      React.createElement("button", { type: "button", onClick }, children),
  };
});

import TeamMembersTable from "../TeamMembersTable";
import { VIEW_AS_LANDING_PATH } from "@/lib/viewAsSurfaces";

const TARGET = "agent-9";

const member = {
  id: TARGET,
  firstName: "Ada",
  lastName: "Byron",
  email: "ada@example.test",
  role: "Agent",
  status: "Active",
  avatar: "",
  availabilityStatus: "Available",
  phone: "",
  createdAt: "2026-01-01T00:00:00Z",
  isSuperAdmin: false,
  profile: { organizationId: "org-1", teamId: null, billingType: "agency_covered" },
};

function renderTable() {
  return render(
    <TeamMembersTable
      users={[member] as never}
      allUsers={[member] as never}
      loading={false}
      search=""
      setSearch={() => {}}
      roleFilter="all"
      setRoleFilter={() => {}}
      statusFilter="all"
      setStatusFilter={() => {}}
      // The Impersonate item is gated on this AND an Active target that is not the caller.
      isCurrentUserSuperAdmin
      onSelectUser={() => {}}
      onConfirm={() => {}}
      onBillingChange={() => {}}
    />,
  );
}

/** Click the Impersonate menu item (rendered inline — see the dropdown mock above). */
async function clickImpersonate() {
  const item = await screen.findByRole("button", { name: /Impersonate/i });
  fireEvent.click(item);
}

beforeEach(() => {
  state.mode = "ok";
  state.calls = [];
  state.navigations = [];
  state.toasts = [];
});
afterEach(cleanup);

describe("Impersonate from Team Members", () => {
  it("navigates to a SUPPORTED surface on a confirmed activation", async () => {
    renderTable();
    await clickImpersonate();

    await waitFor(() => expect(state.navigations).toEqual([VIEW_AS_LANDING_PATH]));
    expect(state.calls).toEqual([TARGET]);
    expect(state.navigations, "landed on /dashboard, which View As refuses").not.toContain("/dashboard");
  });

  it("a REFUSED activation reports it and does not navigate", async () => {
    state.mode = "refuse";
    renderTable();
    await clickImpersonate();

    await waitFor(() => expect(state.toasts.length).toBeGreaterThan(0));
    expect(state.navigations, "navigated on a refused activation").toEqual([]);
    expect(state.toasts[0].variant).toBe("destructive");
  });

  it("a REJECTED activation shows an error, clears the lock, and does not navigate", async () => {
    // The gap: with `finally` but no `catch` this rejection escaped the void IIFE as an unhandled
    // rejection — no toast, and the row simply reverted with nothing said.
    state.mode = "reject";
    renderTable();
    await clickImpersonate();

    await waitFor(() => expect(state.toasts.length).toBeGreaterThan(0));
    expect(state.navigations, "navigated after a rejected activation").toEqual([]);
    expect(state.toasts[0].variant).toBe("destructive");
    expect(
      `${state.toasts[0].description ?? ""}`,
      "a rejection was reported as an authorization refusal",
    ).toMatch(/went wrong/i);

    // The lock cleared: the menu item is selectable again rather than stuck on "Starting…".
    await waitFor(() => expect(screen.queryByText(/Starting…/)).toBeNull());
  });

  it("a rejection is distinguishable from a refusal", async () => {
    state.mode = "refuse";
    renderTable();
    await clickImpersonate();
    await waitFor(() => expect(state.toasts.length).toBeGreaterThan(0));
    const refusalText = state.toasts[0].description;

    cleanup();
    state.mode = "reject";
    state.toasts = [];
    renderTable();
    await clickImpersonate();
    await waitFor(() => expect(state.toasts.length).toBeGreaterThan(0));

    // "You aren't allowed" and "something broke" are different problems with different next steps.
    expect(state.toasts[0].description).not.toBe(refusalText);
  });
});
