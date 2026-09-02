/**
 * The sidebar advertises only destinations "View As" supports.
 *
 * The route guard is what ENFORCES the allow-list; this is what stops the sidebar offering ten
 * links that all lead to a refusal notice. Two traps it has to avoid:
 *
 *   1. `visibleCoreMenu` fails OPEN while permissions are loading (`if (permsLoading) return
 *      CORE_MAIN_MENU`). Failing open is right for a slow permission fetch and wrong for an
 *      identity boundary, so the impersonation filter has to apply to that branch too.
 *   2. `useOrganization().isSuperAdmin` is `isSuperAdmin || isImpersonating`, so the three
 *      Super-Admin-only entries (AI Testing, Agencies, Control Center) render *because* the
 *      session is impersonating — the exact opposite of what is wanted.
 *
 * Settings renders outside `visibleCoreMenu`, so it needs its own check; it is also the densest
 * mutation surface in the application.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isImpersonating: false,
  permsLoading: false,
  isSuperAdmin: true,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isImpersonating: state.isImpersonating }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  // Mirrors production: this flag is `isSuperAdmin || isImpersonating`.
  useOrganization: () => ({ isSuperAdmin: state.isSuperAdmin || state.isImpersonating }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPageAccess: () => true,
    hasSettingsSectionAccess: () => true,
    isLoading: state.permsLoading,
  }),
}));
vi.mock("@/contexts/SidebarContext", () => ({
  useSidebarContext: () => ({ collapsed: false, toggle: () => {}, mobileOpen: false, setMobileOpen: () => {} }),
}));
const customLinksState = vi.hoisted(() => ({ lastOptions: undefined as undefined | { enabled?: boolean } }));
vi.mock("@/hooks/useCustomMenuLinks", () => ({
  // Records the options the Sidebar passes, so the QUERY-level gate (`enabled`) is itself pinned —
  // not just the fact that no link renders.
  useCustomMenuLinks: (options?: { enabled?: boolean }) => {
    customLinksState.lastOptions = options;
    return { data: [{ id: "link-1", label: "Custom Link", open_mode: "tab", url: "https://x.test" }] };
  },
}));
vi.mock("@/components/shared/Logo", () => ({ default: () => null }));

import Sidebar from "../Sidebar";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";

const renderSidebar = () => render(<MemoryRouter><Sidebar /></MemoryRouter>);
const renderSidebarAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Sidebar /></MemoryRouter>);

/** Every Settings category heading and section link the sidebar can render on /settings. */
const SETTINGS_CATEGORY_LABELS = SETTINGS_CONFIG.map((c) => c.label);
const SETTINGS_SECTION_LABELS = SETTINGS_CONFIG.flatMap((c) => c.sections.map((s) => s.label));

const SUPPORTED = ["Contacts", "Conversations"];
const UNSUPPORTED = [
  "Dashboard", "Dialer", "Calendar", "Campaigns", "Leaderboard", "Reports",
  "AI Agents", "Training", "Resources", "Settings",
];
const SUPER_ADMIN_ONLY = ["AI Testing", "Agencies", "Control Center"];

beforeEach(() => {
  state.isImpersonating = false;
  state.permsLoading = false;
  state.isSuperAdmin = true;
  customLinksState.lastOptions = undefined;
});
afterEach(cleanup);

describe("while impersonating", () => {
  it("shows the two supported destinations", () => {
    state.isImpersonating = true;
    renderSidebar();

    for (const label of SUPPORTED) {
      expect(screen.queryAllByText(label).length, `${label} was hidden`).toBeGreaterThan(0);
    }
  });

  it("hides every unsupported destination, Settings included", () => {
    state.isImpersonating = true;
    renderSidebar();

    for (const label of UNSUPPORTED) {
      expect(screen.queryAllByText(label), `${label} was still offered`).toEqual([]);
    }
  });

  it("hides the Super Admin entries, which `isSuperAdmin || isImpersonating` would otherwise reveal", () => {
    state.isImpersonating = true;
    state.isSuperAdmin = false; // an ordinary operator's flag — impersonation alone flips it true
    renderSidebar();

    for (const label of SUPER_ADMIN_ONLY) {
      expect(screen.queryAllByText(label), `${label} was still offered`).toEqual([]);
    }
  });

  it("hides custom menu links, whose /app-link route is refused", () => {
    state.isImpersonating = true;
    renderSidebar();

    expect(screen.queryAllByText("Custom Link")).toEqual([]);
  });

  it("still hides unsupported destinations while PERMISSIONS ARE LOADING", () => {
    // The permission filter deliberately fails open here and returns the whole core menu. An
    // identity boundary must not inherit that.
    state.isImpersonating = true;
    state.permsLoading = true;
    renderSidebar();

    for (const label of UNSUPPORTED) {
      expect(screen.queryAllByText(label), `${label} leaked through the loading branch`).toEqual([]);
    }
    expect(screen.queryAllByText("Contacts").length).toBeGreaterThan(0);
  });
});

describe("when not impersonating", () => {
  // POSITIVE CONTROLS — pass at b29dc9f. The filter must be invisible to an ordinary session.
  it("shows the full menu", () => {
    renderSidebar();

    for (const label of [...SUPPORTED, ...UNSUPPORTED]) {
      expect(screen.queryAllByText(label).length, `${label} went missing`).toBeGreaterThan(0);
    }
  });

  it("still shows the Super Admin entries and custom links for a real Super Admin", () => {
    renderSidebar();

    for (const label of SUPER_ADMIN_ONLY) {
      expect(screen.queryAllByText(label).length, `${label} went missing`).toBeGreaterThan(0);
    }
    expect(screen.queryAllByText("Custom Link").length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("custom menu links are not even QUERIED while impersonating", () => {
  // Hiding a row is no reason to have fetched it: the sidebar passes `enabled: !isImpersonating`
  // into `useCustomMenuLinks`, so under "View As" the `custom_menu_links` read is never issued —
  // consistent with the shell's no-query posture, not just its no-render one.
  it("passes enabled: false to useCustomMenuLinks under View As", () => {
    state.isImpersonating = true;
    renderSidebar();

    expect(customLinksState.lastOptions).toEqual({ enabled: false });
  });

  it("passes enabled: true for an ordinary session", () => {
    renderSidebar();

    expect(customLinksState.lastOptions).toEqual({ enabled: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("on a BLOCKED Settings URL while impersonating", () => {
  /**
   * `Sidebar` branched on `isSettings` BEFORE the impersonation allow-list, so an operator who
   * reached `/settings` directly (typed URL, bookmark, history) while impersonating was shown the
   * whole Settings submenu plus a "Back to App" link to the refused `/dashboard` — even though
   * `AppLayout` correctly refused to mount Settings itself. The allow-list must win regardless of
   * pathname: under "View As" the sidebar is the supported main nav and nothing else.
   *
   * FAIL-FIRST at 31a083d: the Settings branch rendered, so Contacts/Conversations were absent
   * and the category headings, section links and "Back to App" were present. The
   * unsupported/custom/Super-Admin assertions and the `enabled: false` assertion would pass at
   * 31a083d on their own (that branch never rendered those entries, and the query gate was
   * already wired) — regression guards on the fix, not independent evidence — with ONE incidental
   * exception: the Settings section labelled "Calendar" (`calendar-settings`) shares its label
   * with the unsupported main-menu entry "Calendar", so that single UNSUPPORTED assertion also
   * fails at 31a083d. It is counted as part of the same defect (the Settings branch rendering),
   * not as a second one.
   */
  it("shows only the supported main navigation — never the Settings submenu or Back to App", () => {
    state.isImpersonating = true;
    renderSidebarAt("/settings?section=users");

    for (const label of SUPPORTED) {
      expect(screen.queryAllByText(label).length, `${label} was hidden on /settings`).toBeGreaterThan(0);
    }
    for (const label of SETTINGS_CATEGORY_LABELS) {
      expect(screen.queryAllByText(label), `Settings category "${label}" rendered under View As`).toEqual([]);
    }
    for (const label of SETTINGS_SECTION_LABELS) {
      expect(screen.queryAllByText(label), `Settings section "${label}" rendered under View As`).toEqual([]);
    }
    expect(screen.queryAllByText("Back to App"), "Back to App (→ /dashboard) was offered").toEqual([]);
    for (const label of [...UNSUPPORTED, ...SUPER_ADMIN_ONLY, "Custom Link"]) {
      expect(screen.queryAllByText(label), `${label} leaked onto /settings`).toEqual([]);
    }
    expect(customLinksState.lastOptions).toEqual({ enabled: false });
  });

  // POSITIVE CONTROL — passes at 31a083d: an ordinary session on /settings keeps its submenu.
  it("an ordinary session on /settings still gets the Settings submenu and Back to App", () => {
    renderSidebarAt("/settings?section=users");

    expect(screen.queryAllByText("Back to App").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("User Management").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Agency & Team").length).toBeGreaterThan(0);
    // Settings mode replaces the main menu for an ordinary session — unchanged behaviour.
    expect(screen.queryAllByText("Contacts")).toEqual([]);
  });
});
