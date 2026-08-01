/**
 * `/onboarding` — self-serve founder flow.
 *
 * Locks the founder branch (`signup_source === "self_serve"`): the third step is
 * the agency setup, the final CTA reads "Complete setup", the personal timezone
 * picker is gone from step two, and the agency timezone drives BOTH the profile
 * patch and the `company_settings` upsert. Supabase is stubbed — no network call
 * and no credential.
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
  FOUNDER_USER,
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

/** Walk from step one to step three with the prefilled (valid) profile. */
const goToFinalStep = async () => {
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: "Licensing and production details" });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: "Set up your agency" });
};

describe("OnboardingPage — founder flow", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = FOUNDER_USER as unknown as Record<string, unknown>;
    authState.profile = makeProfile({ timezone: "Central Time (US & Canada)" });
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("labels the third step Agency and shows the founder setup screen", async () => {
    renderWizard();
    const stepper = screen.getByRole("list", { name: "Setup progress" });
    expect(stepper).toHaveTextContent("Agency");
    expect(stepper).not.toHaveTextContent("Workspace");

    await goToFinalStep();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Set up your agency");
  });

  it("uses 'Complete setup' as the final call to action", async () => {
    renderWizard();
    await goToFinalStep();
    expect(screen.getByRole("button", { name: "Complete setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter AgentFlow" })).not.toBeInTheDocument();
  });

  it("does NOT offer a personal timezone on step two — completion would discard it", async () => {
    renderWizard();
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    expect(screen.queryByLabelText("Your timezone")).not.toBeInTheDocument();
    // The other optional licensing fields are still there.
    expect(screen.getByLabelText("National Producer Number (NPN)")).toBeInTheDocument();
    expect(screen.getByLabelText("Commission level")).toBeInTheDocument();
  });

  it("shows the agency default timezone on step three", async () => {
    renderWizard();
    await goToFinalStep();
    const trigger = screen.getByLabelText("Agency default timezone");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Central Time (US & Canada)");
  });

  it("sends the agency timezone to BOTH the profile patch and company settings", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(authState.updateProfile).toHaveBeenCalledTimes(1));
    const patch = authState.updateProfile.mock.calls[0][0] as Record<string, unknown>;
    await waitFor(() => expect(supabaseState.companySettingsUpserts).toHaveLength(1));
    const upsert = supabaseState.companySettingsUpserts[0].payload;

    expect(patch.timezone).toBe("Central Time (US & Canada)");
    expect(upsert.timezone).toBe("Central Time (US & Canada)");
    expect(patch.timezone).toBe(upsert.timezone);
  });

  it("requires the agency display name and writes nothing when it is empty", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.change(screen.getByLabelText("Agency display name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    expect(await screen.findByText("Enter your agency's display name")).toBeInTheDocument();
    expect(authState.updateProfile).not.toHaveBeenCalled();
    expect(supabaseState.organizationUpdates).toHaveLength(0);
    expect(supabaseState.companySettingsUpserts).toHaveLength(0);
    expect(authState.navigate).not.toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("keeps the organization update and company settings upsert payloads unchanged", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.change(screen.getByLabelText("Agency display name"), { target: { value: "  Byron Financial  " } });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(supabaseState.organizationUpdates).toHaveLength(1));
    const org = supabaseState.organizationUpdates[0];
    expect(org.id).toBe("org-1");
    expect(org.payload.name).toBe("Byron Financial");
    expect(typeof org.payload.updated_at).toBe("string");

    const { payload, options } = supabaseState.companySettingsUpserts[0];
    expect(options).toEqual({ onConflict: "organization_id" });
    expect(payload).toMatchObject({
      organization_id: "org-1",
      company_name: "Byron Financial",
      logo_url: null,
      logo_name: null,
      favicon_url: null,
      favicon_name: null,
      time_format: "12",
      company_phone: "",
      website_url: "",
    });

    const patch = authState.updateProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      first_name: "Ada",
      last_name: "Byron",
      resident_state: "Texas",
      onboarding_complete: true,
    });
    // Optional fields stay out of the patch when empty — unchanged behaviour.
    expect(patch).not.toHaveProperty("npn");
    expect(patch).not.toHaveProperty("commission_level");
  });

  it("keeps the stored team-size values solo/small/large while displaying 11+ producers", async () => {
    renderWizard();
    await goToFinalStep();

    expect(screen.getByRole("radio", { name: /^Just me/ })).toHaveAttribute("value", "solo");
    expect(screen.getByRole("radio", { name: /^2–10 producers/ })).toHaveAttribute("value", "small");
    const large = screen.getByRole("radio", { name: /^11\+ producers/ });
    expect(large).toHaveAttribute("value", "large");
    // The retired overlapping range must not resurface.
    expect(screen.queryByText("10+ producers")).not.toBeInTheDocument();

    fireEvent.click(large);
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(supabaseState.authUpdates).toHaveLength(1));
    expect(supabaseState.authUpdates[0].data).toMatchObject({
      app_wizard_completed: true,
      team_size_intent: "large",
      needs_app_wizard: true,
      signup_source: "self_serve",
    });
  });

  it("navigates to /dashboard once completion succeeds", async () => {
    renderWizard();
    await goToFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));
    await waitFor(() => expect(authState.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }));
  });
});
