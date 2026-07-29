/**
 * `/forgot-password` — request a password-reset link.
 *
 * Exercises the real page + real routing; only `useAuth().resetPassword` is
 * mocked, so no Supabase call is made. Asserts the zod gate runs before the auth
 * layer is touched, the in-flight state cannot double-submit, failures are
 * announced in the live region without losing the form, and the sent state
 * echoes the address that was actually submitted.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const authState = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ resetPassword: authState.resetPassword }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => authState.navigate };
});

import ForgotPassword from "@/pages/ForgotPassword";

const renderForgot = () =>
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/login" element={<div>login route</div>} />
      </Routes>
    </MemoryRouter>,
  );

const emailField = () => screen.getByLabelText("Email");
const submitButton = () => screen.getByRole("button", { name: /send reset link|sending/i });
const heading = () => screen.getByRole("heading", { level: 1 });

const submitEmail = (email: string) => {
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.click(submitButton());
};

describe("ForgotPassword (/forgot-password)", () => {
  beforeEach(() => {
    authState.resetPassword.mockReset();
    authState.navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the reset-request heading and explanatory copy", () => {
    renderForgot();

    expect(heading()).toHaveTextContent("Reset Your Password");
    expect(screen.getByText(/send you a password reset link/i)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("renders a labelled email field with the right type and autocomplete", () => {
    renderForgot();

    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "email");
    expect(emailField()).toHaveAttribute("aria-invalid", "false");
    expect(emailField()).toHaveValue("");
  });

  it("mounts an empty live region before anything goes wrong", () => {
    renderForgot();

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("blocks an empty submit at the zod gate without reaching the auth layer", async () => {
    renderForgot();

    fireEvent.click(submitButton());

    expect(authState.resetPassword).not.toHaveBeenCalled();
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
    expect(emailField()).toHaveAttribute("aria-describedby", "forgot-email-error");
    expect(heading()).toHaveTextContent("Reset Your Password");
  });

  it("rejects a malformed email client-side without reaching the auth layer", async () => {
    renderForgot();

    submitEmail("not-an-email");

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(authState.resetPassword).not.toHaveBeenCalled();
  });

  it("clears the inline error once a valid address is submitted", async () => {
    authState.resetPassword.mockResolvedValueOnce(undefined);
    renderForgot();

    submitEmail("nope");
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(screen.queryByText("Enter a valid email address")).not.toBeInTheDocument());
    expect(authState.resetPassword).toHaveBeenCalledWith("agent@agency.com");
  });

  it("sends the submitted address to resetPassword exactly once", async () => {
    authState.resetPassword.mockResolvedValueOnce(undefined);
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(authState.resetPassword).toHaveBeenCalledTimes(1));
    expect(authState.resetPassword).toHaveBeenCalledWith("agent@agency.com");
  });

  it("shows the sent state, echoing the address that was submitted", async () => {
    authState.resetPassword.mockResolvedValueOnce(undefined);
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(heading()).toHaveTextContent("Check your email"));
    expect(screen.getByText("agent@agency.com")).toBeInTheDocument();
    // The form is replaced, not merely hidden.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send reset link/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Check your email");
  });

  it("disables the button while the request is in flight and cannot double-submit", async () => {
    let release: (value?: unknown) => void = () => {};
    authState.resetPassword.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveTextContent("Sending…");
    expect(emailField()).toBeDisabled();

    fireEvent.click(submitButton());
    fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
    expect(authState.resetPassword).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(heading()).toHaveTextContent("Check your email"));
    expect(authState.resetPassword).toHaveBeenCalledTimes(1);
  });

  it("announces a failure from the auth layer and keeps the form usable", async () => {
    authState.resetPassword.mockRejectedValueOnce(new Error("Email rate limit exceeded"));
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Email rate limit exceeded"));
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
    expect(heading()).toHaveTextContent("Reset Your Password");
    expect(emailField()).toBeEnabled();
    expect(emailField()).toHaveValue("agent@agency.com");
    expect(submitButton()).toBeEnabled();
  });

  it("falls back to a generic message when the failure carries no message", async () => {
    authState.resetPassword.mockRejectedValueOnce({ status: 500 });
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send the reset link."));
  });

  it("lets the user retry after a failure", async () => {
    authState.resetPassword
      .mockRejectedValueOnce(new Error("Email rate limit exceeded"))
      .mockResolvedValueOnce(undefined);
    renderForgot();

    submitEmail("agent@agency.com");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Email rate limit exceeded"));

    fireEvent.click(submitButton());

    await waitFor(() => expect(heading()).toHaveTextContent("Check your email"));
    expect(authState.resetPassword).toHaveBeenCalledTimes(2);
  });

  it("offers a Back to login link in the form state", () => {
    renderForgot();

    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
  });

  it("keeps the Back to login link in the sent state", async () => {
    authState.resetPassword.mockResolvedValueOnce(undefined);
    renderForgot();

    submitEmail("agent@agency.com");

    await waitFor(() => expect(heading()).toHaveTextContent("Check your email"));
    expect(screen.getByRole("link", { name: "Back to login" })).toHaveAttribute("href", "/login");
  });
});
