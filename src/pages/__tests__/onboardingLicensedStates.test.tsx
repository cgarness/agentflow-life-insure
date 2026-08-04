/**
 * `/onboarding` — licensed-states data-contract regression suite.
 *
 * Production hotfix coverage: invitation-created profiles store
 * `licensed_states` as `[{ state: "CA", licenseNumber: "" }]` (objects), while
 * legacy profiles hold full-name or abbreviation strings. The wizard must
 * render every historical shape safely, and completion must never destroy an
 * invitation-provided license number: an untouched selection omits
 * `licensed_states` from the profile patch entirely, and a modified selection
 * rebuilds the payload in the source's own shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", async () => {
  const utils = await import("./onboardingTestUtils");
  return { supabase: utils.createSupabaseMock() };
});

vi.mock("@/contexts/AuthContext", async () => {
  const utils = await import("./onboardingTestUtils");
  return {
    useAuth: () => ({
      user: utils.authState.user,
      profile: utils.authState.profile,
      updateProfile: utils.authState.updateProfile,
      logout: utils.authState.logout,
    }),
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  const utils = await import("./onboardingTestUtils");
  return { ...actual, useNavigate: () => utils.authState.navigate };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import OnboardingPage from "@/pages/OnboardingPage";
import {
  INVITED_USER,
  PRODUCTION_OBJECT_LICENSED_STATES,
  authState,
  installJsdomPolyfills,
  makeProfile,
  resetOnboardingMocks,
  supabaseState,
} from "./onboardingTestUtils";
import type { Profile } from "@/contexts/AuthContext";

installJsdomPolyfills();

const renderWizard = () =>
  render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );

const continueButton = () => screen.getByRole("button", { name: "Continue" });
const statesTrigger = () => screen.getByLabelText("Licensed states");

/** Sets the invited profile with the given raw licensed_states payload. */
const useInvitedProfile = (licensedStates: unknown) => {
  authState.user = INVITED_USER as unknown as Record<string, unknown>;
  authState.profile = makeProfile({
    role: "Agent",
    timezone: "Pacific Time (US & Canada)",
    licensed_states: licensedStates as Profile["licensed_states"],
  });
};

const goToLicensingStep = async () => {
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: "Licensing and production details" });
};

const openStatesPopover = async () => {
  fireEvent.click(statesTrigger());
  await screen.findByPlaceholderText("Search states…");
};

const toggleStateOption = (name: string) => {
  fireEvent.click(screen.getByRole("option", { name }));
};

const closeStatesPopover = async () => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByPlaceholderText("Search states…")).not.toBeInTheDocument());
};

/** Walks Licensing → Workspace → Enter AgentFlow and returns the profile patch. */
const completeWizard = async () => {
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: /You're joining/ });
  fireEvent.click(screen.getByRole("button", { name: "Enter AgentFlow" }));
  await waitFor(() => expect(authState.updateProfile).toHaveBeenCalledTimes(1));
  return authState.updateProfile.mock.calls[0][0] as Record<string, unknown>;
};

/** The Check icon inside an option reports selection via opacity classes. */
const optionCheckClass = (name: string) =>
  screen.getByRole("option", { name }).querySelector("svg")?.getAttribute("class") ?? "";

describe("OnboardingPage — object-shaped licensed states (production regression)", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    useInvitedProfile(PRODUCTION_OBJECT_LICENSED_STATES);
    supabaseState.organizationName = "Family First Life — Garness";
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("renders Step 1 and advances to Licensing without crashing on the exact production payload", async () => {
    renderWizard();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tell us about you");

    await goToLicensingStep();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Licensing and production details");
  });

  it("summarizes the production payload as one selected state with a California chip and no object text", async () => {
    renderWizard();
    await goToLicensingStep();

    expect(statesTrigger()).toHaveTextContent("1 state selected");
    // Popover closed — the only "California" text is the desktop chip.
    const chipList = screen.getByText("California").closest("ul");
    expect(chipList).not.toBeNull();
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.textContent).not.toContain("licenseNumber");
  });

  it("marks the California option as selected in the picker", async () => {
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();

    expect(optionCheckClass("California")).toContain("opacity-100");
    expect(optionCheckClass("Texas")).toContain("opacity-0");
  });

  it("preserves the selection across Back and Continue", async () => {
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();
    expect(statesTrigger()).toHaveTextContent("2 states selected");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Tell us about you" });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });

    expect(statesTrigger()).toHaveTextContent("2 states selected");
  });
});

describe("OnboardingPage — licensed-states persistence", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    supabaseState.organizationName = "Family First Life — Garness";
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("omits licensed_states from the patch when the selection is untouched, completing normally", async () => {
    useInvitedProfile([{ state: "CA", licenseNumber: "12345" }]);
    renderWizard();
    await goToLicensingStep();

    const patch = await completeWizard();
    expect(Object.prototype.hasOwnProperty.call(patch, "licensed_states")).toBe(false);
    // Invited-agent completion behavior is otherwise unchanged.
    expect(patch.timezone).toBe("Pacific Time (US & Canada)");
    expect(patch.onboarding_complete).toBe(true);
    await waitFor(() => expect(authState.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }));
    expect(supabaseState.authUpdates).toHaveLength(1);
  });

  it("preserves a non-empty license number when another state is added", async () => {
    useInvitedProfile([{ state: "CA", licenseNumber: "12345" }]);
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual([
      { state: "CA", licenseNumber: "12345" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("removes only the deselected state", async () => {
    useInvitedProfile([
      { state: "CA", licenseNumber: "12345" },
      { state: "TX", licenseNumber: "" },
    ]);
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();
    expect(statesTrigger()).toHaveTextContent("1 state selected");

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual([{ state: "CA", licenseNumber: "12345" }]);
  });

  it("keeps a string-array profile saving a string array", async () => {
    useInvitedProfile(["California"]);
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual(["California", "Texas"]);
  });

  it("renders abbreviation strings as selections and leaves them untouched without a rewrite", async () => {
    useInvitedProfile(["CA", "TX"]);
    renderWizard();
    await goToLicensingStep();
    expect(statesTrigger()).toHaveTextContent("2 states selected");
    await openStatesPopover();
    expect(optionCheckClass("California")).toContain("opacity-100");
    expect(optionCheckClass("Texas")).toContain("opacity-100");
    await closeStatesPopover();

    const patch = await completeWizard();
    expect(Object.prototype.hasOwnProperty.call(patch, "licensed_states")).toBe(false);
  });

  it("normalizes retained abbreviation strings to full names when the selection changes", async () => {
    useInvitedProfile(["CA", "TX"]);
    renderWizard();
    await goToLicensingStep();
    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual(["California"]);
  });

  it("handles mixed and malformed input, keeping the richer object entry on save", async () => {
    useInvitedProfile(["California", { state: "CA", licenseNumber: "999" }, null, 42, {}]);
    renderWizard();
    await goToLicensingStep();
    expect(statesTrigger()).toHaveTextContent("1 state selected");

    await openStatesPopover();
    toggleStateOption("Texas");
    await closeStatesPopover();

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual([
      { state: "CA", licenseNumber: "999" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("collapses duplicate state entries to a single chip and selection", async () => {
    useInvitedProfile(["CA", "California"]);
    renderWizard();
    await goToLicensingStep();

    expect(statesTrigger()).toHaveTextContent("1 state selected");
    const chipList = screen.getByText("California").closest("ul") as HTMLElement;
    expect(within(chipList).getAllByText("California")).toHaveLength(1);
  });

  it("clearing every state still preserves entries the UI never offered", async () => {
    useInvitedProfile([
      { state: "CA", licenseNumber: "12345" },
      { state: "DC", licenseNumber: "D-42" },
    ]);
    renderWizard();
    await goToLicensingStep();
    // DC is not a UI option, so only California is visible or deselectable.
    expect(statesTrigger()).toHaveTextContent("1 state selected");

    await openStatesPopover();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await closeStatesPopover();
    expect(statesTrigger()).toHaveTextContent("No states selected");

    const patch = await completeWizard();
    expect(patch.licensed_states).toEqual([{ state: "DC", licenseNumber: "D-42" }]);
  });

  it("treats null licensed_states as no selection and completes without writing the column", async () => {
    useInvitedProfile(null);
    renderWizard();
    await goToLicensingStep();
    expect(statesTrigger()).toHaveTextContent("No states selected");

    const patch = await completeWizard();
    expect(Object.prototype.hasOwnProperty.call(patch, "licensed_states")).toBe(false);
  });
});
