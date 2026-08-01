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
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

describe("OnboardingPage — invited agent flow", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = INVITED_USER as unknown as Record<string, unknown>;
    authState.profile = makeProfile({ role: "Team Leader", timezone: "Pacific Time (US & Canada)" });
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
    authState.profile = makeProfile({ role: "Team Leader", upline_id: "upline-1" });

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
