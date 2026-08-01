/**
 * `/onboarding` — cross-audience behaviour.
 *
 * Validation gating, focus management, error a11y wiring, data retention across
 * Back/Continue, the anti-double-submit guard, the header sign-out (which must
 * use the existing `useAuth().logout`), and the branded loading state.
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
const firstNameField = () => screen.getByLabelText("First name");
const lastNameField = () => screen.getByLabelText("Last name");
const phoneField = () => screen.getByLabelText("Phone");

describe("OnboardingPage — validation and navigation", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = FOUNDER_USER as unknown as Record<string, unknown>;
    authState.profile = makeProfile();
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("blocks step one when the required fields are empty", async () => {
    authState.profile = makeProfile({ first_name: "", last_name: "", phone: "", resident_state: "" });
    renderWizard();

    fireEvent.click(continueButton());

    expect(await screen.findByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Enter your last name")).toBeInTheDocument();
    expect(screen.getByText("Enter your phone number")).toBeInTheDocument();
    expect(screen.getByText("Select your resident state")).toBeInTheDocument();
    // Still on step one.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tell us about you");
  });

  it("rejects a phone number with fewer than ten digits", async () => {
    renderWizard();
    fireEvent.change(phoneField(), { target: { value: "512555" } });
    fireEvent.click(continueButton());
    expect(await screen.findByText("Enter a valid 10-digit phone number")).toBeInTheDocument();
  });

  it("announces the failure in a live region", async () => {
    authState.profile = makeProfile({ first_name: "" });
    renderWizard();
    fireEvent.click(continueButton());

    const alert = screen.getByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("Check the highlighted fields below."));
    expect(alert).toHaveAttribute("aria-live", "polite");
  });

  it("wires aria-invalid and aria-describedby to a stable error id", async () => {
    authState.profile = makeProfile({ first_name: "" });
    renderWizard();
    fireEvent.click(continueButton());

    await waitFor(() => expect(firstNameField()).toHaveAttribute("aria-invalid", "true"));
    expect(firstNameField()).toHaveAttribute("aria-describedby", "onboarding-first-name-error");
    expect(document.getElementById("onboarding-first-name-error")).toHaveTextContent("Enter your first name");
  });

  it("moves focus to the first invalid field, and again on a repeated failure", async () => {
    authState.profile = makeProfile({ first_name: "", last_name: "" });
    renderWizard();

    fireEvent.click(continueButton());
    await waitFor(() => expect(document.activeElement).toBe(firstNameField()));

    // Fix the first field only; the next failure must move focus to the last name.
    fireEvent.change(firstNameField(), { target: { value: "Ada" } });
    lastNameField().blur();
    fireEvent.click(continueButton());
    await waitFor(() => expect(document.activeElement).toBe(lastNameField()));
  });

  it("clears a field's error as soon as it is corrected", async () => {
    authState.profile = makeProfile({ first_name: "" });
    renderWizard();
    fireEvent.click(continueButton());
    expect(await screen.findByText("Enter your first name")).toBeInTheDocument();

    fireEvent.change(firstNameField(), { target: { value: "Ada" } });
    await waitFor(() => expect(screen.queryByText("Enter your first name")).not.toBeInTheDocument());
    expect(firstNameField()).not.toHaveAttribute("aria-invalid");
  });

  it("never blocks navigation on the optional licensing step", async () => {
    renderWizard();
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });

    // Every field left untouched/empty.
    fireEvent.click(continueButton());
    expect(await screen.findByRole("heading", { name: "Set up your agency" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toHaveTextContent("");
  });

  it("disables Back on the first step and preserves data across Back/Continue", async () => {
    renderWizard();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    fireEvent.change(firstNameField(), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Hopper" } });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });

    fireEvent.change(screen.getByLabelText("National Producer Number (NPN)"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await screen.findByRole("heading", { name: "Tell us about you" });
    expect(firstNameField()).toHaveValue("Grace");
    expect(screen.getByLabelText("Last name")).toHaveValue("Hopper");

    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    expect(screen.getByLabelText("National Producer Number (NPN)")).toHaveValue("12345678");
  });

  it("cannot submit twice — the second click is ignored while saving", async () => {
    let release: (() => void) | undefined;
    authState.updateProfile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    renderWizard();
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Set up your agency" });

    const submit = screen.getByRole("button", { name: "Complete setup" });
    fireEvent.click(submit);

    const busy = await screen.findByRole("button", { name: /Setting up your workspace/ });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    fireEvent.click(busy);
    release?.();

    await waitFor(() => expect(authState.updateProfile).toHaveBeenCalledTimes(1));
    expect(supabaseState.companySettingsUpserts).toHaveLength(1);
  });

  it("stacks the name fields on mobile and only splits them once there is room", () => {
    const { container } = renderWizard();
    const grid = container.querySelector(".grid.grid-cols-1");
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
  });
});

describe("OnboardingPage — shell, sign out and loading", () => {
  beforeEach(() => {
    resetOnboardingMocks();
    authState.user = FOUNDER_USER as unknown as Record<string, unknown>;
    authState.profile = makeProfile();
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("bg-black");
  });

  it("signs out through the existing AuthContext logout", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(authState.logout).toHaveBeenCalledTimes(1));
  });

  it("disables sign out while completion is in flight", async () => {
    authState.updateProfile.mockImplementation(() => new Promise<void>(() => {}));
    renderWizard();

    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Set up your agency" });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it("renders a black, dynamic-viewport shell that tints the body", () => {
    const { container, unmount } = renderWizard();
    const root = container.querySelector("div");
    expect(root).toHaveClass("dark");
    expect(root).toHaveClass("bg-black");
    expect(root).toHaveClass("min-h-dvh");
    expect(root).not.toHaveClass("min-h-screen");
    expect(root).toHaveClass("overflow-x-hidden");
    expect(document.body.classList.contains("bg-black")).toBe(true);

    unmount();
    expect(document.body.classList.contains("bg-black")).toBe(false);
  });

  it("shows the AgentFlow platform logo", () => {
    renderWizard();
    expect(screen.getAllByAltText("AgentFlow").length).toBeGreaterThan(0);
  });

  it("marks the card busy while completing", async () => {
    authState.updateProfile.mockImplementation(() => new Promise<void>(() => {}));
    const { container } = renderWizard();

    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Set up your agency" });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });

  it("shows accessible status text instead of a bare spinner while the profile loads", () => {
    authState.profile = null;
    renderWizard();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Preparing your workspace…");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows a sanitized, actionable message when completion fails", async () => {
    authState.updateProfile.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "profiles_pkey"'),
    );
    renderWizard();

    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Licensing and production details" });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: "Set up your agency" });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() =>
      expect(alert).toHaveTextContent("We couldn't finish setup. Please check your connection and try again."),
    );
    // Database internals never reach the user.
    expect(alert).not.toHaveTextContent("profiles_pkey");
    expect(authState.navigate).not.toHaveBeenCalledWith("/dashboard", { replace: true });
  });
});
