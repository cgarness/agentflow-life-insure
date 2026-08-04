/**
 * `/onboarding` — invited-agent flow.
 *
 * Locks the invite branch (`signup_source === "invite"`): the third step is the
 * read-only workspace confirmation, the final CTA reads "Enter AgentFlow", the
 * personal timezone lives on step two and reaches `profiles.timezone`, and no
 * organization / company-settings / team-size write ever happens.
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
import { OnboardingStepWorkspace } from "@/components/onboarding/wizard/OnboardingStepWorkspace";
import type { Profile } from "@/contexts/AuthContext";
import {
  INVITED_USER,
  PRODUCTION_OBJECT_LICENSED_STATES,
  authState,
  installJsdomPolyfills,
  makeProfile,
  resetOnboardingMocks,
  supabaseState,
} from "./onboardingTestUtils";

installJsdomPolyfills();

const renderWizard = () =>
  render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>,
  );

const continueButton = () => screen.getByRole("button", { name: "Continue" });

const goToFinalStep = async () => {
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: "Licensing and production details" });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: /You're joining/ });
};

/** Reads the <dd> value paired with a summary <dt> label. */
const detailValue = (label: string) => {
  const dt = screen.getByText(label, { selector: "dt" });
  return dt.nextElementSibling?.textContent ?? "";
};

describe("OnboardingPage — invited agent flow", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = INVITED_USER as unknown as Record<string, unknown>;
    // Invited profiles carry the real object-shaped invitation payload — the
    // whole suite walks the Licensing step, so it doubles as crash coverage.
    authState.profile = makeProfile({
      role: "Team Leader",
      timezone: "Pacific Time (US & Canada)",
      licensed_states: PRODUCTION_OBJECT_LICENSED_STATES as Profile["licensed_states"],
    });
    supabaseState.organizationName = "Family First Life — Garness";
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("labels the third step Workspace", async () => {
    renderWizard();
    const stepper = screen.getByRole("list", { name: "Setup progress" });
    expect(stepper).toHaveTextContent("Workspace");
    expect(stepper).not.toHaveTextContent("Agency");
  });

  it("uses 'Enter AgentFlow' as the final call to action", async () => {
    renderWizard();
    await goToFinalStep();
    expect(screen.getByRole("button", { name: "Enter AgentFlow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete setup" })).not.toBeInTheDocument();
  });

  it("offers the personal timezone on step two", async () => {
    renderWizard();
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    const trigger = screen.getByLabelText("Your timezone");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Pacific Time (US & Canada)");
  });

  it("saves the personal timezone to the profile", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "Enter AgentFlow" }));

    await waitFor(() => expect(authState.updateProfile).toHaveBeenCalledTimes(1));
    const patch = authState.updateProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.timezone).toBe("Pacific Time (US & Canada)");
    expect(patch.onboarding_complete).toBe(true);
  });

  it("renders the agency, role and upline confirmation", async () => {
    supabaseState.uplineRow = { first_name: "Chris", last_name: "Garness" };
    // Keep the object payload — overriding the profile must not silently opt
    // this walk through the Licensing step out of crash coverage.
    authState.profile = makeProfile({
      role: "Team Leader",
      upline_id: "upline-1",
      licensed_states: PRODUCTION_OBJECT_LICENSED_STATES as Profile["licensed_states"],
    });

    renderWizard();
    await goToFinalStep();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're joining Family First Life — Garness",
    );
    expect(screen.getByText("Agency")).toBeInTheDocument();
    expect(screen.getByText("Family First Life — Garness")).toBeInTheDocument();
    expect(screen.getByText("Your role")).toBeInTheDocument();
    expect(screen.getByText("Team Leader")).toBeInTheDocument();
    expect(screen.getByText("Upline")).toBeInTheDocument();
    expect(screen.getByText("Chris Garness")).toBeInTheDocument();
  });

  it("omits the upline row when the profile has no upline", async () => {
    renderWizard();
    await goToFinalStep();
    expect(screen.queryByText("Upline")).not.toBeInTheDocument();
  });

  it("never writes organization, company settings or a team-size intent", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "Enter AgentFlow" }));

    await waitFor(() => expect(supabaseState.authUpdates).toHaveLength(1));
    expect(supabaseState.organizationUpdates).toHaveLength(0);
    expect(supabaseState.companySettingsUpserts).toHaveLength(0);
    expect(supabaseState.authUpdates[0].data).toMatchObject({
      app_wizard_completed: true,
      signup_source: "invite",
    });
    expect(supabaseState.authUpdates[0].data).not.toHaveProperty("team_size_intent");
    expect(authState.navigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("falls back to neutral copy when the agency name cannot be resolved", async () => {
    supabaseState.organizationName = "";
    renderWizard();
    await goToFinalStep();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You're joining your agency");
    expect(screen.getByText("Your agency")).toBeInTheDocument();
  });
});

describe("OnboardingPage — invited agency identity and copy", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = INVITED_USER as unknown as Record<string, unknown>;
    authState.profile = makeProfile({
      role: "Agent",
      licensed_states: PRODUCTION_OBJECT_LICENSED_STATES as Profile["licensed_states"],
    });
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("prefers the organization record over the branding company name", async () => {
    supabaseState.organizationName = "Family First Life - Chris Garness";
    supabaseState.companyName = "AgentFlow";

    renderWizard();
    await goToFinalStep();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're joining Family First Life - Chris Garness",
    );
    expect(detailValue("Agency")).toBe("Family First Life - Chris Garness");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("You're joining AgentFlow");
  });

  it("falls back to the branding company name only when the organization name is blank", async () => {
    supabaseState.organizationName = "";
    supabaseState.companyName = "Agency Branding Name";

    renderWizard();
    await goToFinalStep();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're joining Agency Branding Name",
    );
    expect(detailValue("Agency")).toBe("Agency Branding Name");
  });

  it("replaces the existing-workspace sentence with the review prompt", async () => {
    renderWizard();
    await goToFinalStep();

    expect(screen.queryByText(/an existing AgentFlow workspace/)).not.toBeInTheDocument();
    expect(screen.getByText("Review your details before entering AgentFlow.")).toBeInTheDocument();
  });
});

describe("OnboardingPage — invited confirmation summary", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = INVITED_USER as unknown as Record<string, unknown>;
    supabaseState.organizationName = "Family First Life - Chris Garness";
    supabaseState.companyName = "AgentFlow";
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("displays every wizard value from the current local state", async () => {
    supabaseState.uplineRow = { first_name: "Chris", last_name: "Garness" };
    authState.profile = makeProfile({
      first_name: "Alexa",
      last_name: "Segura",
      phone: "15125550123",
      resident_state: "California",
      npn: "87654321",
      commission_level: "80",
      role: "Agent",
      upline_id: "upline-1",
      timezone: "Pacific Time (US & Canada)",
      licensed_states: [
        { state: "CA", licenseNumber: "111" },
        { state: "TX", licenseNumber: "" },
      ] as Profile["licensed_states"],
    });

    renderWizard();
    await goToFinalStep();

    expect(detailValue("Full name")).toBe("Alexa Segura");
    expect(detailValue("Phone")).toBe("(512) 555-0123");
    expect(detailValue("Resident state")).toBe("California");
    expect(detailValue("NPN")).toBe("87654321");
    expect(detailValue("Commission level")).toBe("80%");
    expect(detailValue("Timezone")).toBe("Pacific Time (US & Canada)");
    expect(detailValue("Agency")).toBe("Family First Life - Chris Garness");
    expect(detailValue("Your role")).toBe("Agent");
    expect(detailValue("Upline")).toBe("Chris Garness");

    const chipList = screen.getByText("Licensed states", { selector: "dt" })
      .nextElementSibling as HTMLElement;
    expect(within(chipList).getByText("California")).toBeInTheDocument();
    expect(within(chipList).getByText("Texas")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it("shows values edited on Steps 1 and 2 before any profile save", async () => {
    authState.profile = makeProfile({
      role: "Agent",
      licensed_states: PRODUCTION_OBJECT_LICENSED_STATES as Profile["licensed_states"],
    });

    renderWizard();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Grace" } });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });

    fireEvent.change(screen.getByLabelText("National Producer Number (NPN)"), {
      target: { value: "555" },
    });
    fireEvent.change(screen.getByLabelText("Commission level"), { target: { value: "80" } });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: /You're joining/ });

    expect(authState.updateProfile).not.toHaveBeenCalled();
    expect(detailValue("Full name")).toBe("Grace Byron");
    expect(detailValue("NPN")).toBe("555");
    expect(detailValue("Commission level")).toBe("80%");
  });

  it("uses the approved fallbacks for empty optional values in the live flow", async () => {
    authState.profile = makeProfile({
      role: "Agent",
      npn: "",
      commission_level: "",
      licensed_states: [] as Profile["licensed_states"],
    });

    renderWizard();
    await goToFinalStep();

    expect(detailValue("NPN")).toBe("Not provided");
    expect(detailValue("Commission level")).toBe("Not provided");
    expect(detailValue("Licensed states")).toBe("None selected");
    expect(document.body.textContent).not.toContain("%%");
  });

  it("renders every fallback when the summary receives empty values (component contract)", () => {
    render(
      <OnboardingStepWorkspace
        orgName=""
        role="Agent"
        uplineLabel={null}
        firstName=""
        lastName=""
        phone=""
        residentState=""
        npn=""
        licensedStates={[]}
        commissionDigits=""
        timezone=""
      />,
    );

    expect(detailValue("Full name")).toBe("Not provided");
    expect(detailValue("Phone")).toBe("Not provided");
    expect(detailValue("Resident state")).toBe("Not provided");
    expect(detailValue("NPN")).toBe("Not provided");
    expect(detailValue("Commission level")).toBe("Not provided");
    expect(detailValue("Timezone")).toBe("Not provided");
    expect(detailValue("Licensed states")).toBe("None selected");
    expect(detailValue("Agency")).toBe("Your agency");
    expect(screen.queryByText("Upline", { selector: "dt" })).not.toBeInTheDocument();
  });
});
