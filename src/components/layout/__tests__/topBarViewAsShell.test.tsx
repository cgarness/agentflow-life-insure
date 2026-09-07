/**
 * The TopBar is part of the always-mounted shell, and under "View As" it kept offering the
 * operator's whole toolkit:
 *
 *   - `GlobalSearch`, whose debounce effect calls the `global_search` RPC — scope derived from
 *     `auth.uid()`, i.e. the REAL operator's contacts surfaced under the viewed agent's session;
 *   - the Dialer trigger (toggling a FloatingDialer that AppLayout no longer mounts);
 *   - Quick Add (contact creation);
 *   - the Notifications bell and `NotificationsPanel`, whose mark-read / mark-all-read / dismiss
 *     mutate the REAL operator's notification state;
 *   - the "View As" chooser itself — revealed *because* the session was impersonating, since
 *     `useOrganization().isSuperAdmin` is `isSuperAdmin || isImpersonating`;
 *   - Profile Settings / Agent Profile items that navigate straight into the route guard's
 *     refusal notice.
 *
 * The existing AppLayout suite mocks TopBar wholesale, so none of this was provable there. This
 * suite renders the REAL TopBar with probe mocks for its heavy children: each probe records its
 * own mount, so "not mounted" — not merely "not visible" — is what is asserted.
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  isImpersonating: false,
  isSuperAdmin: true,
}));

/** Which probed children mounted, by name. */
const probe = vi.hoisted(() => ({ mounts: [] as string[] }));

function probeChild(name: string) {
  return function Probe() {
    React.useEffect(() => { probe.mounts.push(name); }, []);
    return React.createElement("div", { "data-testid": name });
  };
}

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "op-1", email: "op@x.test" },
    profile: { id: "p-1", first_name: "Op", last_name: "Erator", avatar_url: "" },
    logout: () => {},
    isLoading: false,
    isImpersonating: authState.isImpersonating,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  // Mirrors production: the flag is `isSuperAdmin || isImpersonating`.
  useOrganization: () => ({ isSuperAdmin: authState.isSuperAdmin || authState.isImpersonating }),
}));
vi.mock("@/contexts/SidebarContext", () => ({
  useSidebarContext: () => ({ collapsed: false, setMobileOpen: () => {} }),
}));
vi.mock("@/contexts/AgentStatusContext", () => ({
  useAgentStatus: () => ({ dialerOverride: null }),
}));
vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ unreadCount: 3 }),
  NOTIFICATION_NAVIGATE_EVENT: "notification-navigate",
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: "/contacts", search: "", hash: "", key: "t" }),
}));
vi.mock("@/components/search/GlobalSearch", () => ({ default: probeChild("global-search") }));
vi.mock("@/components/layout/ViewAsModal", () => ({ default: probeChild("view-as-modal") }));
vi.mock("@/components/notifications/NotificationsPanel", () => ({
  NotificationsPanel: probeChild("notifications-panel"),
}));
vi.mock("@/components/layout/HeaderDateCalendar", () => ({ default: () => React.createElement("div", { "data-testid": "header-date" }) }));
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    // Renders its children so the tooltip copy ("Add New Contact") is queryable text.
    TooltipContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
  };
});

import TopBar from "../TopBar";

beforeEach(() => {
  probe.mounts = [];
  authState.isImpersonating = false;
  authState.isSuperAdmin = true;
});
afterEach(cleanup);

const openUserDropdown = () => {
  fireEvent.click(screen.getByLabelText(/account menu/i));
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("while impersonating, the shell offers only safe controls", () => {
  beforeEach(() => { authState.isImpersonating = true; });

  it("GlobalSearch is not MOUNTED — its query effect must never arm", () => {
    render(<TopBar />);
    expect(screen.queryByTestId("global-search")).toBeNull();
    expect(probe.mounts, "GlobalSearch mounted under View As").not.toContain("global-search");
  });

  it("NotificationsPanel is not MOUNTED and the bell is gone", () => {
    render(<TopBar />);
    expect(probe.mounts).not.toContain("notifications-panel");
    expect(screen.queryByRole("button", { name: /notifications/i }), "the bell was offered").toBeNull();
  });

  it("the Dialer trigger and Quick Add are hidden", () => {
    render(<TopBar />);
    expect(screen.queryByRole("button", { name: /dialer|on call/i })).toBeNull();
    expect(screen.queryByText("Dialer")).toBeNull();
    // Quick Add is the only Plus-icon button in the bar.
    expect(screen.queryByText("Add New Contact")).toBeNull();
  });

  it("the View As chooser is neither offered nor mounted", () => {
    render(<TopBar />);
    openUserDropdown();

    // `isSuperAdmin || isImpersonating` would otherwise reveal the chooser BECAUSE the session is
    // impersonating — even for an operator whose own flag is false.
    expect(screen.queryByText(/^View As$/), "the chooser item was offered").toBeNull();
    expect(probe.mounts, "ViewAsModal mounted under View As").not.toContain("view-as-modal");
  });

  it("Profile Settings and Agent Profile are not offered — both routes are refused anyway", () => {
    render(<TopBar />);
    openUserDropdown();

    expect(screen.queryByText("Profile Settings")).toBeNull();
    expect(screen.queryByText("Agent Profile")).toBeNull();
  });

  it("theme and logout stay available", () => {
    render(<TopBar />);
    openUserDropdown();

    expect(screen.getByText(/light mode|dark mode/i)).toBeTruthy();
    expect(screen.getByText("Logout")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("nothing changes for an ordinary session", () => {
  // POSITIVE CONTROLS — pass at dcb71a6. The shell filter must be invisible outside View As.
  it("GlobalSearch, the bell, the Dialer trigger and Quick Add all render", () => {
    render(<TopBar />);

    expect(screen.getByTestId("global-search")).toBeTruthy();
    expect(probe.mounts).toContain("global-search");
    expect(screen.getByRole("button", { name: /notifications/i })).toBeTruthy();
    expect(probe.mounts).toContain("notifications-panel");
    expect(screen.getByText("Dialer")).toBeTruthy();
    expect(screen.getByText("Add New Contact")).toBeTruthy();
  });

  it("a real Super Admin still gets the View As chooser", () => {
    render(<TopBar />);
    openUserDropdown();

    expect(screen.getByText(/^View As$/)).toBeTruthy();
    expect(probe.mounts).toContain("view-as-modal");
  });

  it("Profile Settings and Agent Profile are offered", () => {
    render(<TopBar />);
    openUserDropdown();

    expect(screen.getByText("Profile Settings")).toBeTruthy();
    expect(screen.getByText("Agent Profile")).toBeTruthy();
  });
});
