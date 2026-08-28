/**
 * The "View As" allow-list itself.
 *
 * This module is the whole Phase A contract, so its edges are the contract's edges. The cases below
 * are the ones a naive `includes`/`startsWith` implementation gets wrong, and each of them is a way
 * a direct URL would otherwise reach an unaudited page while impersonating.
 *
 * NOTE, honestly: this file is NOT fail-first evidence. It unit-tests a module this pass adds, so
 * at b29dc9f it fails only because the module does not exist — a missing export, not a behaviour.
 * The behavioural evidence lives in `viewAsRouteAllowlist.test.tsx` and
 * `contactsViewAsFailClosed.test.tsx`, both measured against a b29dc9f carrying this module but
 * none of the guards that use it.
 */

import { describe, expect, it } from "vitest";
import {
  VIEW_AS_LANDING_PATH,
  VIEW_AS_SUPPORTED_CONTACT_TABS,
  isViewAsSupportedContactTab,
  isViewAsSupportedNavLabel,
  isViewAsSupportedPath,
  resolveViewAsContactTab,
} from "@/lib/viewAsSurfaces";

describe("the View As route allow-list", () => {
  it("admits exactly the two audited surfaces", () => {
    expect(isViewAsSupportedPath("/conversations")).toBe(true);
    expect(isViewAsSupportedPath("/contacts")).toBe(true);
  });

  it("refuses every other application route", () => {
    for (const path of [
      "/dashboard", "/dialer", "/calendar", "/campaigns", "/campaigns/abc", "/leaderboard",
      "/reports", "/ai-agents", "/ai-agents/new", "/training", "/resources", "/settings",
      "/agent-profile", "/super-admin", "/super-admin/organizations/abc", "/ai-testing",
      "/control-center", "/app-link/xyz",
    ]) {
      expect(isViewAsSupportedPath(path), `admitted ${path}`).toBe(false);
    }
  });

  it("refuses the contact deep-link and import routes that live UNDER /contacts", () => {
    // A `startsWith("/contacts")` implementation would admit all of these. They are separate
    // routes with their own unaudited read paths, and the import page can write.
    for (const path of ["/contacts/import", "/leads/abc", "/clients/abc", "/recruits/abc"]) {
      expect(isViewAsSupportedPath(path), `admitted ${path}`).toBe(false);
    }
  });

  it("refuses a case-varied path — React Router matches case-insensitively", () => {
    // `<Route path="/dashboard">` matches `/DASHBOARD`, so an allow-list comparing raw strings
    // would let a direct URL walk straight past it.
    for (const path of ["/DASHBOARD", "/Dashboard", "/dAsHbOaRd", "/SETTINGS"]) {
      expect(isViewAsSupportedPath(path), `admitted ${path}`).toBe(false);
    }
  });

  it("still admits a supported path in odd casing or with a trailing slash", () => {
    expect(isViewAsSupportedPath("/Conversations")).toBe(true);
    expect(isViewAsSupportedPath("/contacts/")).toBe(true);
    expect(isViewAsSupportedPath("  /contacts  ")).toBe(true);
  });

  it("fails closed on a non-string, an empty string, and nullish input", () => {
    for (const bad of [null, undefined, "", 42, {}, [], true]) {
      expect(isViewAsSupportedPath(bad as unknown), `admitted ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("the View As Contacts tab allow-list", () => {
  it("admits only Import History and Agents", () => {
    expect(VIEW_AS_SUPPORTED_CONTACT_TABS).toEqual(["Import History", "Agents"]);
    expect(isViewAsSupportedContactTab("Import History")).toBe(true);
    expect(isViewAsSupportedContactTab("Agents")).toBe(true);
  });

  it("refuses the three contact grids", () => {
    for (const tab of ["Leads", "Clients", "Recruits"]) {
      expect(isViewAsSupportedContactTab(tab), `admitted ${tab}`).toBe(false);
    }
  });

  it("fails closed on unknown, malformed and nullish tabs", () => {
    for (const bad of ["", "leads", "import history", null, undefined, 7, {}]) {
      expect(isViewAsSupportedContactTab(bad as unknown), `admitted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("resolves any unsupported or missing tab to Import History", () => {
    expect(resolveViewAsContactTab("Leads")).toBe("Import History");
    expect(resolveViewAsContactTab(undefined)).toBe("Import History");
    expect(resolveViewAsContactTab("nonsense")).toBe("Import History");
    expect(resolveViewAsContactTab("Agents")).toBe("Agents");
  });
});

describe("the View As navigation allow-list", () => {
  it("admits only the two supported destinations", () => {
    expect(isViewAsSupportedNavLabel("Contacts")).toBe(true);
    expect(isViewAsSupportedNavLabel("Conversations")).toBe(true);
  });

  it("refuses every other sidebar entry, Settings included", () => {
    for (const label of [
      "Dashboard", "Dialer", "Calendar", "Campaigns", "Leaderboard", "Reports",
      "AI Agents", "Training", "Resources", "Settings", "Agencies", "Control Center", "AI Testing",
    ]) {
      expect(isViewAsSupportedNavLabel(label), `admitted ${label}`).toBe(false);
    }
  });
});

describe("the View As landing", () => {
  it("points at a SUPPORTED surface, not the dashboard", () => {
    // Landing on `/dashboard` after a successful activation would open the refusal notice — and
    // before the route guard existed, it opened the operator's own numbers under the viewed name.
    expect(VIEW_AS_LANDING_PATH).toBe("/contacts?tab=Import+History");
    const [pathname, query] = VIEW_AS_LANDING_PATH.split("?");
    expect(isViewAsSupportedPath(pathname)).toBe(true);
    expect(isViewAsSupportedContactTab(new URLSearchParams(query).get("tab"))).toBe(true);
  });
});
