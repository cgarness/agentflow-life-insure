/**
 * "View As" is an ALLOW-LIST, enforced at the layout so a direct URL cannot walk around it.
 *
 * THE DEFECT THIS PINS. Repairing the impersonation payload turned "View As" on everywhere. Before
 * the repair the effective profile carried `organization_id: undefined`, `usePermissions` never
 * satisfied `canFetchPermissions`, and every impersonated page sat on a spinner — "View As" was
 * inert. Afterwards every route mounted and ran its queries under the viewed identity, including
 * the ~20 routes written against `useAuth().user` (the REAL operator). Dashboard and Reports would
 * render the operator's own numbers under the viewed agent's name; Settings, the Dialer and the
 * import page can write.
 *
 * The guard therefore has to be a MOUNT guarantee, not a render-suppression: these tests assert
 * that the routed page component never mounts and never issues a query, not merely that its output
 * is hidden. Each page is mocked with a probe that records its own mount and fires a query from an
 * effect — exactly what a real page does — so "did not mount" is a real assertion.
 *
 * The layout children are tested the same way: `FloatingDialer` and `ReminderPopup` mount on EVERY
 * route, so an `<Outlet />`-only guard would have let them follow the operator onto the two
 * supported pages.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  isImpersonating: false,
  impersonatedUser: null as Record<string, unknown> | null,
  stopCalls: 0,
}));

/** Every mount and every query a mocked page performs, in order. */
const probe = vi.hoisted(() => ({ mounts: [] as string[], queries: [] as string[] }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isImpersonating: authState.isImpersonating,
    impersonatedUser: authState.impersonatedUser,
    stopImpersonation: () => { authState.stopCalls += 1; },
  }),
}));

vi.mock("@/contexts/SidebarContext", () => ({
  useSidebarContext: () => ({ collapsed: false, toggle: () => {}, mobileOpen: false, setMobileOpen: () => {} }),
}));
vi.mock("@/contexts/AgentStatusContext", () => ({
  AgentStatusProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/hooks/useWelcomeEmailTrigger", () => ({ useWelcomeEmailTrigger: () => {} }));
vi.mock("../Sidebar", () => ({ default: () => React.createElement("div", { "data-testid": "sidebar" }) }));
vi.mock("../TopBar", () => ({ default: () => React.createElement("div", { "data-testid": "topbar" }) }));

/**
 * The two layout children, mocked as the business-data surfaces they are: each records its mount
 * and fires a query, so "not mounted" and "issued no query" are both observable.
 */
function layoutChild(name: string) {
  return function Child() {
    React.useEffect(() => {
      probe.mounts.push(name);
      probe.queries.push(`${name}:query`);
    }, []);
    return React.createElement("div", { "data-testid": name });
  };
}
vi.mock("../FloatingDialer", () => ({ default: layoutChild("floating-dialer") }));
vi.mock("../ReminderPopup", () => ({ default: layoutChild("reminder-popup") }));

import AppLayout from "../AppLayout";
import { VIEW_AS_LANDING_PATH } from "@/lib/viewAsSurfaces";

/** A stand-in for a routed page: mounts, then queries — the shape of every real page. */
const Page: React.FC<{ name: string }> = ({ name }) => {
  React.useEffect(() => {
    probe.mounts.push(name);
    probe.queries.push(`${name}:query`);
  }, [name]);
  return <div data-testid={`page-${name}`}>{name} page</div>;
};

const ROUTES: [string, string][] = [
  ["/dashboard", "dashboard"],
  ["/dialer", "dialer"],
  ["/reports", "reports"],
  ["/calendar", "calendar"],
  ["/campaigns", "campaigns"],
  ["/settings", "settings"],
  ["/contacts/import", "contacts-import"],
  ["/leads/abc", "lead-detail"],
  ["/clients/abc", "client-detail"],
  ["/recruits/abc", "recruit-detail"],
  ["/conversations", "conversations"],
  ["/contacts", "contacts"],
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          {ROUTES.map(([routePath, name]) => (
            <Route key={routePath} path={routePath} element={<Page name={name} />} />
          ))}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  probe.mounts = [];
  probe.queries = [];
  authState.isImpersonating = false;
  authState.impersonatedUser = null;
  authState.stopCalls = 0;
});
afterEach(cleanup);

function impersonate() {
  authState.isImpersonating = true;
  authState.impersonatedUser = { id: "agent-1", first_name: "Ada", last_name: "Byron", role: "Agent" };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("unsupported routes do not mount or query while impersonating", () => {
  const UNSUPPORTED = ROUTES.filter(([p]) => p !== "/conversations" && p !== "/contacts");

  it.each(UNSUPPORTED)("%s renders the notice instead of its page", async (path, name) => {
    impersonate();
    renderAt(path);

    await screen.findByTestId("view-as-unsupported");
    expect(screen.queryByTestId(`page-${name}`), `${path} rendered its page`).toBeNull();
    // The load-bearing half: not merely hidden — never constructed, so no effect ever ran.
    expect(probe.mounts, `${path} MOUNTED its page component`).not.toContain(name);
    expect(probe.queries, `${path} issued a query`).not.toContain(`${name}:query`);
  });

  it("reaching an unsupported route by DIRECT URL is refused, not just by navigation", async () => {
    // `/settings` carries no `PageGuard` of its own, so a guard bolted onto `PageGuard` would have
    // missed it entirely. Entering the history at the path IS the direct-URL case.
    impersonate();
    renderAt("/settings");

    await screen.findByTestId("view-as-unsupported");
    expect(probe.mounts).toEqual([]);
  });

  it("a case-varied direct URL cannot slip past the allow-list", async () => {
    impersonate();
    render(
      <MemoryRouter initialEntries={["/DASHBOARD"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Page name="dashboard" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // React Router matched the route case-insensitively; the guard must still refuse it.
    await screen.findByTestId("view-as-unsupported");
    expect(probe.mounts, "a case-varied URL mounted the page").toEqual([]);
  });

  it("the notice keeps a way out: Exit View As and a link to a supported page", async () => {
    impersonate();
    renderAt("/dashboard");
    await screen.findByTestId("view-as-unsupported");

    // TWO exits, and both must survive a blocked route: the persistent banner's (rendered outside
    // the guarded area, so it is reachable from every refusal) and the notice's own. Without the
    // banner an operator who deep-linked into a blocked route would have no way back out.
    const exits = screen.getAllByRole("button", { name: /exit view as/i });
    expect(exits.length, "the banner's exit disappeared on a blocked route").toBe(2);

    exits[exits.length - 1].click();
    expect(authState.stopCalls).toBe(1);

    const link = screen.getByRole("link", { name: /supported page/i });
    expect(link.getAttribute("href")).toBe(VIEW_AS_LANDING_PATH);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("supported routes still mount while impersonating", () => {
  it.each([["/conversations", "conversations"], ["/contacts", "contacts"]])(
    "%s mounts and runs normally",
    async (path, name) => {
      impersonate();
      renderAt(path);

      await screen.findByTestId(`page-${name}`);
      expect(probe.mounts).toContain(name);
      expect(screen.queryByTestId("view-as-unsupported")).toBeNull();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("layout children are page components too", () => {
  it("FloatingDialer and ReminderPopup do not mount while impersonating, even on a SUPPORTED route", async () => {
    // These mount on every route, so an `<Outlet />`-only guard would leave them running for the
    // whole session. FloatingDialer places calls and writes `calls` rows as the REAL session;
    // ReminderPopup reads and dismisses the real user's appointments.
    impersonate();
    renderAt("/contacts");

    await screen.findByTestId("page-contacts");
    expect(screen.queryByTestId("floating-dialer"), "FloatingDialer mounted under View As").toBeNull();
    expect(screen.queryByTestId("reminder-popup"), "ReminderPopup mounted under View As").toBeNull();
    expect(probe.mounts).not.toContain("floating-dialer");
    expect(probe.mounts).not.toContain("reminder-popup");
    expect(probe.queries).not.toContain("floating-dialer:query");
    expect(probe.queries).not.toContain("reminder-popup:query");
  });

  it("they also do not mount on a BLOCKED route", async () => {
    impersonate();
    renderAt("/dashboard");

    await screen.findByTestId("view-as-unsupported");
    expect(probe.mounts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("nothing changes when not impersonating", () => {
  // POSITIVE CONTROL — passes at b29dc9f. The guard must be invisible to an ordinary session.
  it.each(ROUTES)("%s mounts and queries as before", async (path, name) => {
    renderAt(path);

    await screen.findByTestId(`page-${name}`);
    expect(probe.mounts).toContain(name);
    expect(probe.queries).toContain(`${name}:query`);
    expect(screen.queryByTestId("view-as-unsupported")).toBeNull();
  });

  it("FloatingDialer and ReminderPopup mount as before", async () => {
    renderAt("/dashboard");

    await waitFor(() => expect(screen.getByTestId("floating-dialer")).toBeTruthy());
    expect(screen.getByTestId("reminder-popup")).toBeTruthy();
    expect(probe.queries).toContain("floating-dialer:query");
    expect(probe.queries).toContain("reminder-popup:query");
  });
});
