/**
 * OnboardingEmailPreference — hidden unless the program is live for the user's agency, hidden under
 * "View As", saves only through the caller-scoped RPC, and shows the saved server state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  auth: { user: { id: "u1" } as { id: string } | null, isImpersonating: false },
  fetch: vi.fn(),
  save: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/emailSubscriptions", () => ({
  fetchMyEmailSubscriptions: () => state.fetch(),
  setMyOnboardingEmailOptOut: (input: { optedOut: boolean }) => state.save(input),
}));
vi.mock("sonner", () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));

import { OnboardingEmailPreference } from "../OnboardingEmailPreference";

beforeEach(() => {
  state.auth = { user: { id: "u1" }, isImpersonating: false };
  state.fetch.mockReset();
  state.save.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
});
afterEach(cleanup);

describe("OnboardingEmailPreference", () => {
  it("renders nothing while the program is disabled (the default)", async () => {
    state.fetch.mockResolvedValue({ onboarding_program_enabled: false, onboarding_opted_out: false });
    const { container } = render(<OnboardingEmailPreference />);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing and makes no request under View As or without a session", async () => {
    state.auth = { user: { id: "u1" }, isImpersonating: true };
    const a = render(<OnboardingEmailPreference />);
    expect(a.container).toBeEmptyDOMElement();
    cleanup();
    state.auth = { user: null, isImpersonating: false };
    const b = render(<OnboardingEmailPreference />);
    expect(b.container).toBeEmptyDOMElement();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("renders nothing when the status cannot be loaded", async () => {
    state.fetch.mockRejectedValue(new Error("Couldn't load"));
    const { container } = render(<OnboardingEmailPreference />);
    await waitFor(() => expect(state.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("when live, shows the saved state and turns tips off through the RPC", async () => {
    state.fetch.mockResolvedValue({ onboarding_program_enabled: true, onboarding_opted_out: false });
    state.save.mockResolvedValue(true);
    render(<OnboardingEmailPreference />);
    const toggle = await screen.findByRole("switch", { name: /onboarding tips by email/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(state.save).toHaveBeenCalledWith({ optedOut: true }));
    await waitFor(() => expect(screen.getByRole("switch", { name: /onboarding tips by email/i })).toHaveAttribute("aria-checked", "false"));
    expect(state.toastSuccess).toHaveBeenCalledWith("Onboarding tips turned off");
  });

  it("a failed save keeps the previous state and says so", async () => {
    state.fetch.mockResolvedValue({ onboarding_program_enabled: true, onboarding_opted_out: true });
    state.save.mockRejectedValue(new Error("42501"));
    render(<OnboardingEmailPreference />);
    const toggle = await screen.findByRole("switch", { name: /onboarding tips by email/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(state.toastError).toHaveBeenCalled());
    expect(screen.getByRole("switch", { name: /onboarding tips by email/i })).toHaveAttribute("aria-checked", "false");
  });
});
