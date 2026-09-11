/**
 * Corrective pass, defect 6 — the RENDERED availability surface in the top bar tells the truth: a stored
 * Offline is announced as such, and a routing engine that does not enforce availability (legacy / unknown)
 * marks the effect line as pending. Same probe mocks as topBarViewAsShell.test.tsx; only useAgentStatus is live.
 */
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  stored: "Available" as string, manual: "Available" as string | null, engine: "v2" as string,
  activationPending: false, routingEffect: "Inbound calls ring here while your phone is connected.",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "op-1", email: "op@x.test" }, profile: { id: "p-1", first_name: "Op", last_name: "Erator", avatar_url: "" }, logout: () => {}, isLoading: false, isImpersonating: false }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ isSuperAdmin: false }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false, setMobileOpen: () => {} }) }));
vi.mock("@/contexts/AgentStatusContext", () => ({
  useAgentStatus: () => ({
    stored: agent.stored, manual: agent.manual, engine: agent.engine, activationPending: agent.activationPending,
    routingEffect: agent.routingEffect, effectiveLabel: agent.stored === "Offline" ? "Offline (set on your profile)" : agent.stored,
    phoneConnected: true, onCall: false, saving: false, canChange: true, setAvailability: async () => {}, refreshEngine: async () => {},
  }),
}));
vi.mock("@/contexts/NotificationContext", () => ({ useNotifications: () => ({ unreadCount: 0 }), NOTIFICATION_NAVIGATE_EVENT: "notification-navigate" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: "/contacts", search: "", hash: "", key: "t" }) }));
vi.mock("@/components/search/GlobalSearch", () => ({ default: () => <div /> }));
vi.mock("@/components/layout/ViewAsModal", () => ({ default: () => <div /> }));
vi.mock("@/components/notifications/NotificationsPanel", () => ({ NotificationsPanel: () => <div /> }));
vi.mock("@/components/layout/HeaderDateCalendar", () => ({ default: () => <div /> }));
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> };
});

import TopBar from "../TopBar";

const openAvailability = () => {
  fireEvent.click(screen.getByLabelText(/account menu/i));
  fireEvent.click(screen.getByRole("button", { name: /availability/i }));
};

beforeEach(() => { agent.stored = "Available"; agent.manual = "Available"; agent.engine = "v2"; agent.activationPending = false; agent.routingEffect = "Inbound calls ring here while your phone is connected."; });
afterEach(cleanup);

describe("TopBar availability picker — truthful surface", () => {
  it("a stored Offline is announced and the v2 effect line carries no pending marker", () => {
    agent.stored = "Offline"; agent.manual = null; agent.routingEffect = "Inbound calls skip AgentFlow for you.";
    render(<TopBar />);
    openAvailability();
    expect(screen.getByTestId("availability-stored-offline").textContent).toMatch(/set to Offline/i);
    expect(screen.getByTestId("availability-routing-effect").textContent).toBe("Inbound calls skip AgentFlow for you.");
  });

  it("a stored Available shows no Offline notice", () => {
    render(<TopBar />);
    openAvailability();
    expect(screen.queryByTestId("availability-stored-offline")).toBeNull();
    expect(screen.getByTestId("availability-routing-effect").textContent).not.toMatch(/^⚠/);
  });

  it("a legacy / unknown engine marks the effect line as PENDING activation", () => {
    agent.engine = "legacy"; agent.activationPending = true; agent.routingEffect = "Pending activation: the legacy routing engine does not use availability yet.";
    render(<TopBar />);
    openAvailability();
    expect(screen.getByTestId("availability-routing-effect").textContent).toBe("⚠ Pending activation: the legacy routing engine does not use availability yet.");
  });
});
