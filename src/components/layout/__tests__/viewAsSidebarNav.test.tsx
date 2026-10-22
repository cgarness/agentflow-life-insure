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
  collapsed: false,
  sectionAccess: (_slug: string): boolean => true,
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
    hasSettingsSectionAccess: (slug: string) => state.sectionAccess(slug),
    isLoading: state.permsLoading,
  }),
}));
vi.mock("@/contexts/SidebarContext", () => ({
  useSidebarContext: () => ({ collapsed: state.collapsed, toggle: () => {}, mobileOpen: false, setMobileOpen: () => {} }),
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
const commissionsState = vi.hoisted(() => ({ permitted: true, permissionsLoading: false }));
vi.mock("@/hooks/useCommissionsCenter", () => ({
  // Mirrors the real access hook: the Own toggle decides, impersonation comes from the session. The navigation
  // requests nothing (reporting needs no calculator grid). The hook's own resolution (Admin / Super Admin at once,
  // other roles fail closed while loading) is covered by useCommissionsAccess.test.tsx.
  useCommissionsAccess: () => ({
    permitted: commissionsState.permitted,
    permissionsLoading: commissionsState.permissionsLoading,
    isImpersonating: state.isImpersonating,
  }),
}));

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
  "AI Agents", "Training", "Resources", "Commissions", "Settings",
];
const SUPER_ADMIN_ONLY = ["AI Testing", "Agencies", "Control Center"];

beforeEach(() => {
  state.isImpersonating = false;
  state.permsLoading = false;
  state.isSuperAdmin = true;
  state.collapsed = false;
  state.sectionAccess = () => true;
  customLinksState.lastOptions = undefined;
  commissionsState.permitted = true;
  commissionsState.permissionsLoading = false;
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
    expect(screen.queryAllByText("Commission Grids"), "admin-only Commission Grids rendered under View As").toEqual([]);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Commissions navigation", () => {
  it("replaces Commission Calculator in its place, directly below Resources", () => {
    renderSidebar();
    const labels = screen.getAllByRole("link").map((link) => link.textContent?.trim());
    expect(labels.indexOf("Commissions")).toBe(labels.indexOf("Resources") + 1);
    expect(screen.queryAllByText("Commission Calculator")).toEqual([]);
    expect(screen.getByRole("link", { name: "Commissions" }).getAttribute("href")).toBe("/commissions");
  });

  it("is shown without a calculator grid, and hidden when the role may not view its own commission", () => {
    renderSidebar();
    expect(screen.getAllByText("Commissions").length).toBe(1);
    cleanup();
    commissionsState.permitted = false;
    renderSidebar();
    expect(screen.queryAllByText("Commissions")).toEqual([]);
  });

  it("is hidden under View As", () => {
    state.isImpersonating = true;
    renderSidebar();
    expect(screen.queryAllByText("Commissions")).toEqual([]);
  });

  it("stays active on every tab", () => {
    for (const url of ["/commissions", "/commissions/payments?view=history", "/commissions/calculator"]) {
      renderSidebarAt(url);
      expect(screen.getByRole("link", { name: "Commissions" }).className).toContain("bg-primary");
      cleanup();
    }
  });

  it("uses the CircleDollarSign icon", () => {
    renderSidebar();
    const link = screen.getByRole("link", { name: "Commissions" });
    expect(link.querySelector("svg.lucide-circle-dollar-sign")).not.toBeNull();
    expect(link.querySelector("svg.lucide-wallet")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Commissions navigation while access is unresolved", () => {
  /**
   * The core menu renders while permissions load, but Commissions used to render nothing until they resolved and was
   * then inserted, pushing Custom links, Settings and the Super Admin entries down a row. Admin and Super Admin now
   * resolve at once (useCommissionsAccess.test.tsx). An Agent or Team Leader whose permissions are still loading gets
   * an inert slot with a nav row's box instead: no link, label, icon, focus stop or route, so nothing is revealed.
   */
  const unresolved = () => { commissionsState.permitted = false; commissionsState.permissionsLoading = true; };
  const rows = () => Array.from(screen.getByRole("navigation").children) as HTMLElement[];
  const rowIndex = (href: string) => rows().findIndex((row) => row.getAttribute("href") === href);
  const slotBelowResources = () => rows()[rowIndex("/resources") + 1];
  const tree = () => <MemoryRouter><Sidebar /></MemoryRouter>;

  it("reserves an inert slot directly below Resources, with no Commissions link or label", () => {
    unresolved();
    renderSidebar();
    const slot = slotBelowResources();
    expect(slot.tagName).toBe("DIV");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.textContent).toBe("");
    expect(slot.querySelector("a, button, svg, [tabindex]")).toBeNull();
    expect(screen.queryAllByText("Commissions")).toEqual([]);
    expect(screen.queryByRole("link", { name: "Commissions" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it.each([false, true])("gives the slot a nav row's box (collapsed: %s)", (collapsed) => {
    state.collapsed = collapsed;
    unresolved();
    const { rerender } = renderSidebar();
    const slot = slotBelowResources();
    for (const token of ["px-3", "py-2.5"]) expect(slot.classList).toContain(token);
    expect(slot.firstElementChild?.classList).toContain("h-5");
    commissionsState.permitted = true;
    commissionsState.permissionsLoading = false;
    rerender(tree());
    const link = rows()[rowIndex("/commissions")];
    for (const token of ["px-3", "py-2.5"]) expect(link.className).toContain(token);
    expect(link.querySelector("svg")?.classList).toContain("h-5");
  });

  it("fills the same slot once access resolves, so nothing below it moves", () => {
    unresolved();
    const { rerender } = renderSidebar();
    const slotIndex = rowIndex("/resources") + 1;
    const settingsIndex = rowIndex("/settings");
    const rowCount = rows().length;
    commissionsState.permitted = true;
    commissionsState.permissionsLoading = false;
    rerender(tree());
    expect(rowIndex("/commissions")).toBe(slotIndex);
    expect(rowIndex("/settings")).toBe(settingsIndex);
    expect(rows()).toHaveLength(rowCount);
  });

  it("removes the slot when the resolved role may not view its own commission", () => {
    unresolved();
    const { rerender } = renderSidebar();
    commissionsState.permissionsLoading = false;
    rerender(tree());
    expect(rowIndex("/settings")).toBe(rowIndex("/resources") + 2); // Resources, Custom Link, Settings
    expect(rows().some((row) => row.getAttribute("aria-hidden") === "true")).toBe(false);
    expect(screen.queryAllByText("Commissions")).toEqual([]);
  });

  it("reserves nothing under View As", () => {
    unresolved();
    state.isImpersonating = true;
    renderSidebar();
    expect(rows().some((row) => row.getAttribute("aria-hidden") === "true")).toBe(false);
    expect(screen.queryAllByText("Commissions")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("admin-only Commission Grids settings entry", () => {
  it("is listed under Agency & Team for an agency admin", () => {
    renderSidebarAt("/settings?section=my-profile");
    expect(screen.queryAllByText("Commission Grids").length).toBeGreaterThan(0);
  });

  it("is not listed for roles without access, and never fails open while permissions load", () => {
    state.sectionAccess = (slug) => slug !== "commission-grids";
    renderSidebarAt("/settings?section=my-profile");
    expect(screen.queryAllByText("Commission Grids")).toEqual([]);
    expect(screen.queryAllByText("User Management").length).toBeGreaterThan(0);
    cleanup();
    state.sectionAccess = () => true;
    state.permsLoading = true;
    renderSidebarAt("/settings?section=my-profile");
    expect(screen.queryAllByText("Commission Grids")).toEqual([]);
  });
});
