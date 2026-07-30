/**
 * `/reset-password` — complete a Supabase recovery link.
 *
 * Exercises the real page + real routing; only the Supabase client is mocked, so
 * no network call is made. The important guard here is the PASSWORD POLICY: this
 * page has always enforced a 6-character minimum (previously `minLength={6}`),
 * deliberately looser than signup's 8 + complexity rules. A test below fails if
 * that ever silently tightens.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const state = vi.hoisted(() => ({
  updateUser: vi.fn(),
  unsubscribe: vi.fn(),
  navigate: vi.fn(),
  authCb: null as ((event: string) => void) | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: state.updateUser,
      onAuthStateChange: (cb: (event: string) => void) => {
        state.authCb = cb;
        return { data: { subscription: { unsubscribe: state.unsubscribe } } };
      },
    },
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => state.navigate };
});

import ResetPassword from "@/pages/ResetPassword";

const RECOVERY_HASH = "#access_token=abc123&type=recovery";

const renderReset = () =>
  render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<div>login route</div>} />
        <Route path="/forgot-password" element={<div>forgot route</div>} />
      </Routes>
    </MemoryRouter>,
  );

const passwordField = () => screen.getByLabelText("New password") as HTMLInputElement;
const confirmField = () => screen.getByLabelText("Confirm password") as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /update password|updating/i });
const heading = () => screen.getByRole("heading", { level: 1 });

const submitPasswords = (password: string, confirmPassword = password) => {
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.change(confirmField(), { target: { value: confirmPassword } });
  fireEvent.click(submitButton());
};

describe("ResetPassword (/reset-password)", () => {
  beforeEach(() => {
    state.updateUser.mockReset();
    state.updateUser.mockResolvedValue({ error: null });
    state.unsubscribe.mockReset();
    state.navigate.mockReset();
    state.authCb = null;
    window.location.hash = RECOVERY_HASH;
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  describe("recovery-link gating", () => {
    it("shows the invalid-link state and no form when the recovery hash is absent", () => {
      window.location.hash = "";
      renderReset();

      expect(heading()).toHaveTextContent("Invalid reset link");
      expect(screen.getByText(/this link is invalid or has expired/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
        "href",
        "/forgot-password",
      );

      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /update password/i })).not.toBeInTheDocument();
    });

    it("stays on the invalid-link state for an unrelated hash", () => {
      window.location.hash = "#type=magiclink&access_token=abc";
      renderReset();

      expect(heading()).toHaveTextContent("Invalid reset link");
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("renders the form when the URL carries type=recovery", () => {
      renderReset();

      expect(heading()).toHaveTextContent("Set a new password");
      expect(passwordField()).toBeInTheDocument();
      expect(confirmField()).toBeInTheDocument();
      expect(submitButton()).toBeEnabled();
      expect(screen.queryByText("Invalid reset link")).not.toBeInTheDocument();
    });

    it("unlocks the form when Supabase emits PASSWORD_RECOVERY without a hash", async () => {
      window.location.hash = "";
      renderReset();

      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      expect(state.authCb).toBeTypeOf("function");

      await act(async () => {
        state.authCb?.("PASSWORD_RECOVERY");
      });

      expect(passwordField()).toBeInTheDocument();
      expect(heading()).toHaveTextContent("Set a new password");
    });

    it("ignores unrelated auth events", async () => {
      window.location.hash = "";
      renderReset();

      await act(async () => {
        state.authCb?.("SIGNED_IN");
        state.authCb?.("TOKEN_REFRESHED");
      });

      expect(heading()).toHaveTextContent("Invalid reset link");
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("unsubscribes from auth state changes on unmount", () => {
      const { unmount } = renderReset();

      expect(state.unsubscribe).not.toHaveBeenCalled();

      unmount();

      expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("form chrome", () => {
    it("renders both password inputs with new-password autocomplete", () => {
      renderReset();

      expect(passwordField()).toHaveAttribute("type", "password");
      expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
      expect(confirmField()).toHaveAttribute("type", "password");
      expect(confirmField()).toHaveAttribute("autocomplete", "new-password");
    });

    it("mounts an empty live region before anything goes wrong", () => {
      renderReset();

      expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "polite");
      expect(screen.getByRole("alert").textContent).toBe("");
    });

    it("toggles visibility of the new-password field only", () => {
      renderReset();

      const toggle = screen.getByRole("button", { name: "Show password" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAttribute("aria-controls", "reset-password");
      expect(passwordField()).toHaveAttribute("type", "password");

      fireEvent.click(toggle);

      expect(passwordField()).toHaveAttribute("type", "text");
      expect(confirmField()).toHaveAttribute("type", "password");
      expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByRole("button", { name: "Hide password" }));

      expect(passwordField()).toHaveAttribute("type", "password");
      expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("password policy (6 characters — NOT signup's 8)", () => {
    it("rejects a 5-character password client-side without calling updateUser", async () => {
      renderReset();

      submitPasswords("abcde");

      expect(await screen.findByText("Password must be at least 6 characters")).toBeInTheDocument();
      expect(state.updateUser).not.toHaveBeenCalled();
      expect(passwordField()).toHaveAttribute("aria-invalid", "true");
      expect(passwordField()).toHaveAttribute("aria-describedby", "reset-password-error");
    });

    it("accepts a 6-character password and sends it to updateUser", async () => {
      renderReset();

      submitPasswords("abcdef");

      await waitFor(() => expect(state.updateUser).toHaveBeenCalledTimes(1));
      expect(state.updateUser).toHaveBeenCalledWith({ password: "abcdef" });
      expect(screen.queryByText(/at least 8 characters/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/must be at least 6 characters/i)).not.toBeInTheDocument();
    });

    it.each(["abcdef", "sixchr", "123456", "aB3!xy"])(
      "does not apply signup's complexity rules to %s",
      async (password) => {
        renderReset();

        submitPasswords(password);

        await waitFor(() => expect(state.updateUser).toHaveBeenCalledWith({ password }));
      },
    );

    it("requires the confirmation field to be filled in", async () => {
      renderReset();

      fireEvent.change(passwordField(), { target: { value: "abcdef" } });
      fireEvent.click(submitButton());

      expect(await screen.findByText("Please confirm your password")).toBeInTheDocument();
      expect(state.updateUser).not.toHaveBeenCalled();
    });

    it("rejects a mismatched confirmation without calling updateUser", async () => {
      renderReset();

      submitPasswords("abcdef", "abcdefg");

      expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
      expect(state.updateUser).not.toHaveBeenCalled();
      expect(confirmField()).toHaveAttribute("aria-invalid", "true");
      expect(confirmField()).toHaveAttribute("aria-describedby", "reset-confirm-error");
      expect(heading()).toHaveTextContent("Set a new password");
    });

    it("clears the inline error once the passwords line up", async () => {
      renderReset();

      submitPasswords("abcdef", "nope123");
      expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();

      fireEvent.change(confirmField(), { target: { value: "abcdef" } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(screen.queryByText("Passwords do not match")).not.toBeInTheDocument());
      expect(state.updateUser).toHaveBeenCalledWith({ password: "abcdef" });
    });
  });

  describe("submission", () => {
    it("shows the success state and then redirects to /login", async () => {
      renderReset();

      submitPasswords("correct-horse");

      await waitFor(() => expect(heading()).toHaveTextContent("Password updated"));
      expect(screen.getByRole("status")).toHaveTextContent("Password updated");
      expect(screen.getByText(/redirecting you to sign in/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to login now" })).toHaveAttribute("href", "/login");
      // The form is replaced, not merely hidden.
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      // Redirect is deferred, not immediate.
      expect(state.navigate).not.toHaveBeenCalled();

      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/login"), { timeout: 4000 });
      expect(state.navigate).toHaveBeenCalledTimes(1);
    });

    it("locks the button while the update is in flight and cannot double-submit", async () => {
      let release: (value: unknown) => void = () => {};
      state.updateUser.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      renderReset();

      submitPasswords("correct-horse");

      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(submitButton()).toHaveTextContent("Updating…");
      expect(passwordField()).toBeDisabled();
      expect(confirmField()).toBeDisabled();

      fireEvent.click(submitButton());
      fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
      expect(state.updateUser).toHaveBeenCalledTimes(1);

      await act(async () => {
        release({ error: null });
      });

      await waitFor(() => expect(heading()).toHaveTextContent("Password updated"));
      expect(state.updateUser).toHaveBeenCalledTimes(1);
    });

    it("announces a Supabase failure and never redirects", async () => {
      state.updateUser.mockResolvedValueOnce({ error: new Error("New password should be different from the old password.") });
      renderReset();

      submitPasswords("correct-horse");

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "New password should be different from the old password.",
        ),
      );
      expect(state.navigate).not.toHaveBeenCalled();
      expect(screen.queryByText("Password updated")).not.toBeInTheDocument();
      expect(heading()).toHaveTextContent("Set a new password");
      expect(submitButton()).toBeEnabled();
      expect(passwordField()).toBeEnabled();
      expect(passwordField()).toHaveValue("correct-horse");
    });

    it("falls back to a generic message when the failure carries no message", async () => {
      state.updateUser.mockRejectedValueOnce({ status: 500 });
      renderReset();

      submitPasswords("correct-horse");

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to reset password"));
      expect(state.navigate).not.toHaveBeenCalled();
    });

    it("lets the user retry after a failure", async () => {
      state.updateUser
        .mockResolvedValueOnce({ error: new Error("Auth session missing!") })
        .mockResolvedValueOnce({ error: null });
      renderReset();

      submitPasswords("correct-horse");
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Auth session missing!"));

      fireEvent.click(submitButton());

      await waitFor(() => expect(heading()).toHaveTextContent("Password updated"));
      expect(state.updateUser).toHaveBeenCalledTimes(2);
    });

    it("does not navigate after the page unmounts", async () => {
      const { unmount } = renderReset();

      submitPasswords("correct-horse");
      await waitFor(() => expect(heading()).toHaveTextContent("Password updated"));

      unmount();

      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(state.navigate).not.toHaveBeenCalled();
    });
  });
});
