/**
 * Fix 1 (behavioural) — `ProtectedRoute` gates on the canonical onboarding wizard and
 * on nothing else.
 *
 * Before the fix, a user who had ALREADY completed `/onboarding` was shown a second
 * "Profile Setup" wizard on first CRM entry whenever an optional field (phone,
 * resident state) was blank — and again every 3 days after dismissing it. The first
 * describe block below is the fail-first case: it renders the real component and
 * asserts no dialog is present.
 *
 * The remaining blocks lock the canonical gate so removing the redundant wizard
 * cannot regress authentication, onboarding, or protected-route behaviour.
 *
 * No production identifiers appear here — synthetic ids only.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  /** Records that the retired profile-setup callbacks were consulted at all. */
  legacyCallbackHits: [] as string[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
}));

vi.mock("react-router-dom", () => ({
  Navigate: ({ to, state }: { to: string; state?: unknown }) =>
    React.createElement("div", {
      "data-testid": "navigate",
      "data-to": to,
      "data-state": JSON.stringify(state ?? null),
    }),
  useLocation: () => ({ pathname: "/dashboard", search: "", hash: "", state: null, key: "t" }),
}));

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

const CONFIRMED = "2026-08-01T00:00:00.000Z";
const VIEWER_ID = "00000000-0000-4000-8000-000000000001";

/** A user who has finished the canonical wizard. */
const completedUser = {
  id: VIEWER_ID,
  email_confirmed_at: CONFIRMED,
  user_metadata: { needs_app_wizard: true, app_wizard_completed: true },
};

/** A user who genuinely still owes the canonical wizard. */
const unfinishedUser = {
  id: VIEWER_ID,
  email_confirmed_at: CONFIRMED,
  user_metadata: { needs_app_wizard: true },
};

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEWER_ID,
    first_name: "Ada",
    last_name: "Byron",
    phone: "15125550123",
    resident_state: "Texas",
    licensed_states: [{ state: "TX", licenseNumber: "" }],
    commission_level: "Street",
    ...overrides,
  };
}

/**
 * The retired AuthContext callbacks, reimplemented EXACTLY as they behaved before the
 * fix. They stay in the mock on purpose: pre-fix they make the second wizard render,
 * which is what these tests must catch; post-fix `ProtectedRoute` must ignore them
 * entirely, which `never consults the retired profile-setup callbacks` asserts.
 */
function legacyCheckProfileSetupNeeded(this: void): boolean {
  authState.legacyCallbackHits.push("checkProfileSetupNeeded");
  const { user, profile: p } = authState.current as {
    user: { id: string; user_metadata?: Record<string, unknown> } | null;
    profile: Record<string, string | null> | null;
  };
  if (!user || !p) return false;
  const meta = user.user_metadata ?? {};
  if (meta.needs_app_wizard === true && meta.app_wizard_completed !== true) return false;
  const complete = !!(
    p.first_name?.trim() &&
    p.last_name?.trim() &&
    p.phone?.trim() &&
    p.resident_state?.trim()
  );
  if (complete) return false;
  const stored = localStorage.getItem(`agentflow-profile-setup-${user.id}`);
  if (!stored) return true;
  try {
    const parsed = JSON.parse(stored) as { firstLoginComplete: boolean; lastSkippedAt: string | null };
    if (!parsed.firstLoginComplete) return true;
    if (parsed.lastSkippedAt) {
      const days = (Date.now() - new Date(parsed.lastSkippedAt).getTime()) / 86_400_000;
      if (days > 3) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function setAuth(overrides: Record<string, unknown>) {
  authState.current = {
    isAuthenticated: true,
    isLoading: false,
    isBuildingOrganization: false,
    user: completedUser,
    profile: profile(),
    updateProfile: async () => {},
    checkProfileSetupNeeded: legacyCheckProfileSetupNeeded,
    markProfileSetupSeen: () => authState.legacyCallbackHits.push("markProfileSetupSeen"),
    ...overrides,
  };
}

/** jsdom lacks the DOM APIs a Radix dialog probes on open. */
function installJsdomPolyfills(): void {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
}

installJsdomPolyfills();

function renderRoute() {
  return render(
    React.createElement(ProtectedRoute, null, React.createElement("div", { "data-testid": "crm" }, "CRM")),
  );
}

/** Any wizard would mount a Radix dialog; assert the whole class is absent. */
function expectNoWizard() {
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(screen.queryByText(/profile setup/i)).toBeNull();
  expect(screen.queryByText(/complete your profile/i)).toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  authState.legacyCallbackHits = [];
  setAuth({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the redundant profile wizard no longer renders after completed onboarding", () => {
  it("completed onboarding + fully populated profile → CRM renders, no wizard", () => {
    renderRoute();
    expect(screen.getByTestId("crm")).toBeTruthy();
    expectNoWizard();
  });

  it("completed onboarding + blank phone and resident state → still no wizard", () => {
    // This is the exact production case that produced the second wizard.
    setAuth({ profile: profile({ phone: "", resident_state: "" }) });
    renderRoute();
    expect(screen.getByTestId("crm")).toBeTruthy();
    expectNoWizard();
  });

  it("completed onboarding + blank licensed states and commission level → still no wizard", () => {
    setAuth({ profile: profile({ licensed_states: [], commission_level: "" }) });
    renderRoute();
    expect(screen.getByTestId("crm")).toBeTruthy();
    expectNoWizard();
  });

  it("no profile-setup storage entry → no wizard, and nothing is written to localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setAuth({ profile: profile({ phone: "", resident_state: "" }) });
    renderRoute();
    expectNoWizard();
    const profileSetupWrites = setItem.mock.calls.filter(([key]) =>
      String(key).includes("profile-setup"),
    );
    expect(profileSetupWrites).toEqual([]);
  });

  it("a stale skip entry older than the old 3-day re-prompt window → no wizard", () => {
    const staleSkip = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      `agentflow-profile-setup-${VIEWER_ID}`,
      JSON.stringify({ firstLoginComplete: true, lastSkippedAt: staleSkip }),
    );
    setAuth({ profile: profile({ phone: "", resident_state: "" }) });
    renderRoute();
    expectNoWizard();
  });

  it("a null profile does not resurrect any wizard", () => {
    setAuth({ profile: null });
    renderRoute();
    expect(screen.getByTestId("crm")).toBeTruthy();
    expectNoWizard();
  });

  it("never consults the retired profile-setup callbacks, even when they would fire", () => {
    // The mock still exposes the legacy callbacks and this profile would have
    // triggered the old wizard. ProtectedRoute must not call them at all.
    setAuth({ profile: profile({ phone: "", resident_state: "" }) });
    renderRoute();
    expect(authState.legacyCallbackHits).toEqual([]);
  });
});

describe("the canonical onboarding gate is preserved", () => {
  it("a user who still owes the wizard is redirected to /onboarding with the origin path", () => {
    setAuth({ user: unfinishedUser });
    renderRoute();
    const nav = screen.getByTestId("navigate");
    expect(nav.getAttribute("data-to")).toBe("/onboarding");
    expect(JSON.parse(nav.getAttribute("data-state") || "null")).toEqual({ from: "/dashboard" });
    expect(screen.queryByTestId("crm")).toBeNull();
  });

  it("an unconfirmed account is not sent to the wizard (the gate requires confirmation)", () => {
    setAuth({ user: { ...unfinishedUser, email_confirmed_at: null } });
    renderRoute();
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByTestId("crm")).toBeTruthy();
  });

  it("an unauthenticated visitor is redirected to /login", () => {
    setAuth({ isAuthenticated: false, user: null, profile: null });
    renderRoute();
    expect(screen.getByTestId("navigate").getAttribute("data-to")).toBe("/login");
    expect(screen.queryByTestId("crm")).toBeNull();
  });

  it("while loading: spinner only — no redirect, no children, no wizard", () => {
    setAuth({ isLoading: true });
    renderRoute();
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.queryByTestId("crm")).toBeNull();
    expectNoWizard();
  });

  it("while the organization is being built: spinner only", () => {
    setAuth({ isBuildingOrganization: true });
    renderRoute();
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.queryByTestId("crm")).toBeNull();
  });
});
