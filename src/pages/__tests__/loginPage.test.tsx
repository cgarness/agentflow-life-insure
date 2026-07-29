/**
 * Canonical `/login` — the centered AgentFlow auth card.
 *
 * Asserts the page reuses the real auth path (`useAuth().login` ->
 * `resolvePostAuthDestination`), meets the accessibility / anti-double-submit
 * rules, and cannot be turned into an open redirect. `login` is mocked — no
 * Supabase call is made and no credential is logged.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const authState = vi.hoisted(() => ({
  login: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ login: authState.login }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => authState.navigate };
});

import LoginPage from "@/pages/LoginPage";

const renderLogin = (entry = "/login") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );

const emailField = () => screen.getByLabelText("Email");
const passwordField = () => screen.getByLabelText("Password");
const submitButton = () => screen.getByRole("button", { name: /sign in|signing in|redirecting/i });

const fillCredentials = (email = "agent@agency.com", password = "correct-horse") => {
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.change(passwordField(), { target: { value: password } });
};

const ONBOARDED = { id: "u1", user_metadata: {} };
const NEEDS_WIZARD = {
  id: "u2",
  email_confirmed_at: "2026-07-28T00:00:00.000Z",
  user_metadata: { needs_app_wizard: true },
};

describe("LoginPage (canonical /login)", () => {
  beforeEach(() => {
    authState.login.mockReset();
    authState.navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the centered card design with the approved heading and no marketing panel", () => {
    const { container } = renderLogin();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome Back");
    // Centered single-card layout: no split-screen brand column.
    expect(container.querySelector("aside")).toBeNull();
    // Retired Command Deck marketing copy must not resurface.
    expect(screen.queryByText(/Built for life insurance agencies/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Dial More. Talk More.")).not.toBeInTheDocument();
    expect(screen.queryByText("Every Lead, One Place.")).not.toBeInTheDocument();
    expect(screen.queryByText("Know What’s Working.")).not.toBeInTheDocument();
    // Logo is always visible above the card content (not mobile-only).
    expect(screen.getAllByAltText("AgentFlow").length).toBeGreaterThan(0);
  });

  it("does not carry over the retired trust badges", () => {
    renderLogin();
    expect(screen.queryByText(/encrypted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ai powered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^secure$/i)).not.toBeInTheDocument();
  });

  it("renders labelled email + password fields with correct types and autocomplete", () => {
    renderLogin();

    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "email");
    expect(passwordField()).toHaveAttribute("type", "password");
    expect(passwordField()).toHaveAttribute("autocomplete", "current-password");
  });

  it("keeps the forgot-password and signup destinations", () => {
    renderLogin();
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/signup");
  });

  it("toggles password visibility with an accessible control", () => {
    renderLogin();
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "login-password");

    fireEvent.click(toggle);

    expect(passwordField()).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("blocks submission of an empty form without calling login", async () => {
    renderLogin();
    fireEvent.click(submitButton());

    expect(authState.login).not.toHaveBeenCalled();
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a malformed email client-side without reaching the auth layer", async () => {
    renderLogin();
    fillCredentials("not-an-email", "correct-horse");
    fireEvent.click(submitButton());

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(authState.login).not.toHaveBeenCalled();
  });

  it("announces an invalid-credential error from the auth layer", async () => {
    authState.login.mockRejectedValueOnce(new Error("Invalid login credentials"));
    renderLogin();

    fillCredentials("agent@agency.com", "wrong-password");
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalid login credentials/i));
    expect(authState.navigate).not.toHaveBeenCalled();
  });

  it("disables the submit button while a login is in flight (no duplicate submission)", async () => {
    let release: (value: unknown) => void = () => {};
    authState.login.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderLogin();

    fillCredentials();
    fireEvent.click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveTextContent(/signing in/i);

    fireEvent.click(submitButton());
    expect(authState.login).toHaveBeenCalledTimes(1);

    release(ONBOARDED);
    await waitFor(() => expect(authState.login).toHaveBeenCalledTimes(1));
  });

  it("sends a fully onboarded user to /dashboard", async () => {
    authState.login.mockResolvedValueOnce(ONBOARDED);
    renderLogin();

    fillCredentials();
    fireEvent.click(submitButton());

    await waitFor(() => expect(submitButton()).toHaveTextContent(/redirecting/i));
    expect(authState.navigate).not.toHaveBeenCalled();

    await waitFor(() => expect(authState.navigate).toHaveBeenCalledWith("/dashboard"), { timeout: 2500 });
  });

  it("sends a wizard-pending user to /onboarding", async () => {
    authState.login.mockResolvedValueOnce(NEEDS_WIZARD);
    renderLogin();

    fillCredentials("newagent@agency.com");
    fireEvent.click(submitButton());

    await waitFor(() => expect(authState.navigate).toHaveBeenCalledWith("/onboarding"), { timeout: 2500 });
  });

  describe("post-login redirect (?redirect=)", () => {
    it("honors a valid internal redirect — the group-invite return path", async () => {
      authState.login.mockResolvedValueOnce(ONBOARDED);
      renderLogin("/login?redirect=%2Faccept-group-invite%3Ftoken%3Dabc123");

      fillCredentials();
      fireEvent.click(submitButton());

      await waitFor(
        () => expect(authState.navigate).toHaveBeenCalledWith("/accept-group-invite?token=abc123"),
        { timeout: 2500 },
      );
    });

    it.each([
      ["protocol-relative", "%2F%2Fevil.com"],
      ["absolute https", "https%3A%2F%2Fevil.com"],
      ["javascript scheme", "javascript%3Aalert(1)"],
      ["backslash normalized", "%2F%5Cevil.com"],
      ["non-allowlisted internal path", "%2Fsettings"],
    ])("falls back to /dashboard for a %s redirect (no open redirect)", async (_label, encoded) => {
      authState.login.mockResolvedValueOnce(ONBOARDED);
      renderLogin(`/login?redirect=${encoded}`);

      fillCredentials();
      fireEvent.click(submitButton());

      await waitFor(() => expect(authState.navigate).toHaveBeenCalledTimes(1), { timeout: 2500 });
      expect(authState.navigate).toHaveBeenCalledWith("/dashboard");
    });

    it("does not let a redirect skip the onboarding gate", async () => {
      authState.login.mockResolvedValueOnce(NEEDS_WIZARD);
      renderLogin("/login?redirect=%2Faccept-group-invite%3Ftoken%3Dabc123");

      fillCredentials();
      fireEvent.click(submitButton());

      await waitFor(() => expect(authState.navigate).toHaveBeenCalledWith("/onboarding"), { timeout: 2500 });
    });
  });
});
