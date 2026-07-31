/**
 * `/signup` — account creation.
 *
 * Locks the contract the page owes the auth layer: the exact five positional
 * `signup(...)` arguments, the `/confirmation` hand-off carrying the email in
 * router state, the four-rule password policy (and its live checklist), the
 * invitation prefill via `?token=`, and `mapAuthError` surfacing failures in the
 * announced alert region. `signup` and the invitation lookup are mocked — no
 * Supabase call is made and no credential is logged.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 *
 * SECURITY CONTRACT (P0 signup trust hardening): the page forwards identity and the
 * invitation token ONLY. Organization, upline, role, licensed states and commission
 * level are server-derived inside `create-user`, so the assertions below are exact
 * call-tuple equality — an extra positional argument reintroducing browser-supplied
 * authority must fail these tests. The legacy unsigned base64 `?invite=` payload is
 * gone; its removal is asserted directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const state = vi.hoisted(() => ({
  signup: vi.fn(),
  navigate: vi.fn(),
  getInvitationByToken: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signup: state.signup }),
}));

vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: { getInvitationByToken: state.getInvitationByToken },
}));

vi.mock("@/utils/auth-errors", () => ({
  mapAuthError: (e: any) => "MAPPED: " + (e?.message ?? String(e)),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => state.navigate };
});

import SignupPage from "@/pages/SignupPage";

const renderSignup = (entry = "/signup") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
      </Routes>
    </MemoryRouter>,
  );

const firstNameField = () => screen.getByLabelText("First name");
const lastNameField = () => screen.getByLabelText("Last name");
const emailField = () => screen.getByLabelText("Email");
const passwordField = () => screen.getByLabelText("Password");
const submitButton = () => screen.getByRole("button", { name: /create account|creating account/i });
const signupForm = () => passwordField().closest("form") as HTMLFormElement;

const STRONG_PASSWORD = "Passw0rd!";

const fillForm = ({
  firstName = "Grace",
  lastName = "Hopper",
  email = "grace@agency.com",
  password = STRONG_PASSWORD,
}: Partial<Record<"firstName" | "lastName" | "email" | "password", string>> = {}) => {
  fireEvent.change(firstNameField(), { target: { value: firstName } });
  fireEvent.change(lastNameField(), { target: { value: lastName } });
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.change(passwordField(), { target: { value: password } });
};

const INVITATION = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@org.com",
  organization_id: "org-1",
  org_name: "Family First",
  upline_id: "up-1",
  role: "Team Leader",
  licensed_states: ["CA"],
  commission_level: "75%",
};

/** The li wrapping a checklist label, so met/not-met can be read from the sr-only text. */
const requirementRow = (label: string) => screen.getByText(label).closest("li") as HTMLLIElement;

describe("SignupPage (/signup)", () => {
  beforeEach(() => {
    state.signup.mockReset();
    state.navigate.mockReset();
    state.getInvitationByToken.mockReset();
    state.getInvitationByToken.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  describe("standard signup", () => {
    it("renders the default heading and copy when there is no invitation", () => {
      renderSignup();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create Your Account");
      expect(screen.getByText(/start your journey as an independent agent/i)).toBeInTheDocument();
      expect(state.getInvitationByToken).not.toHaveBeenCalled();
    });

    it("calls signup with the exact five positional arguments, in order", async () => {
      state.signup.mockResolvedValueOnce(undefined);
      renderSignup();

      fillForm();
      fireEvent.click(submitButton());

      await waitFor(() => expect(state.signup).toHaveBeenCalledTimes(1));
      expect(state.signup).toHaveBeenCalledWith(
        "grace@agency.com",
        STRONG_PASSWORD,
        "Grace",
        "Hopper",
        null,
      );
      // Order matters as much as the values — assert the raw call tuple too. Exact
      // equality is the point: no organization, upline, role, licensed states or
      // commission level may ride along from the browser.
      expect(state.signup.mock.calls[0]).toEqual([
        "grace@agency.com",
        STRONG_PASSWORD,
        "Grace",
        "Hopper",
        null,
      ]);
    });

    it("hands off to /confirmation carrying the email in router state", async () => {
      state.signup.mockResolvedValueOnce(undefined);
      renderSignup();

      fillForm({ email: "grace@agency.com" });
      expect(state.navigate).not.toHaveBeenCalled();

      fireEvent.click(submitButton());

      await waitFor(() =>
        expect(state.navigate).toHaveBeenCalledWith("/confirmation", { state: { email: "grace@agency.com" } }),
      );
      expect(state.navigate).toHaveBeenCalledTimes(1);
    });

    it("keeps the sign-in destination for existing accounts", () => {
      renderSignup();
      expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    });

    it("blocks an empty form and never reaches the auth layer", async () => {
      renderSignup();

      fireEvent.click(submitButton());

      expect(state.signup).not.toHaveBeenCalled();
      expect(await screen.findByText("First name is required")).toBeInTheDocument();
      expect(screen.getByText("Last name is required")).toBeInTheDocument();
      expect(screen.getByText("Email is required")).toBeInTheDocument();
      expect(firstNameField()).toHaveAttribute("aria-invalid", "true");
    });

    it("toggles password visibility with an accessible control", () => {
      renderSignup();

      const toggle = screen.getByRole("button", { name: "Show password" });
      expect(toggle).toHaveAttribute("aria-controls", "signup-password");
      expect(passwordField()).toHaveAttribute("type", "password");

      fireEvent.click(toggle);

      expect(passwordField()).toHaveAttribute("type", "text");
      expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("password policy", () => {
    it("refuses a weak password: no signup call, requirement surfaced inline", async () => {
      renderSignup();

      fillForm({ password: "short" });

      // The CTA is locked while the policy is unmet…
      expect(submitButton()).toBeDisabled();
      fireEvent.click(submitButton());
      expect(state.signup).not.toHaveBeenCalled();

      // …and the handler's own guard blocks a form-level submit too.
      fireEvent.submit(signupForm());

      // The inline field error is a <p>; the checklist label is a <span>.
      expect(await screen.findByText("At least 8 characters", { selector: "p" })).toBeInTheDocument();
      expect(state.signup).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
      expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    });

    it("shows the live checklist only once the user types, headed 'Password requirements'", () => {
      renderSignup();

      expect(screen.queryByText("Password requirements")).not.toBeInTheDocument();
      expect(screen.queryByText("At least one uppercase letter")).not.toBeInTheDocument();

      fireEvent.change(passwordField(), { target: { value: "short" } });

      expect(screen.getByText("Password requirements")).toBeInTheDocument();
      expect(passwordField()).toHaveAttribute("aria-describedby", "signup-password-requirements");

      // Every rule is reported unmet for "short".
      expect(requirementRow("At least 8 characters")).toHaveTextContent("not met");
      expect(requirementRow("At least one uppercase letter")).toHaveTextContent("not met");
      expect(requirementRow("At least one number")).toHaveTextContent("not met");
      expect(requirementRow("At least one special character")).toHaveTextContent("not met");
    });

    it("flips every rule to met for a compliant password and unlocks the CTA", () => {
      renderSignup();

      fireEvent.change(passwordField(), { target: { value: "Passw0rd" } });
      expect(requirementRow("At least one special character")).toHaveTextContent("not met");
      expect(submitButton()).toBeDisabled();

      fireEvent.change(passwordField(), { target: { value: STRONG_PASSWORD } });

      for (const label of [
        "At least 8 characters",
        "At least one uppercase letter",
        "At least one number",
        "At least one special character",
      ]) {
        expect(requirementRow(label).textContent).toContain("— met");
        expect(requirementRow(label).textContent).not.toContain("not met");
      }
      expect(submitButton()).toBeEnabled();
    });

    it("does not carry over the retired 'SECURITY PROTOCOLS' copy", () => {
      renderSignup();
      fireEvent.change(passwordField(), { target: { value: STRONG_PASSWORD } });

      expect(screen.queryByText(/security protocols/i)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/security protocols/i);
    });
  });

  describe("invitation signup (?token=)", () => {
    const renderInvited = async () => {
      state.getInvitationByToken.mockResolvedValueOnce(INVITATION);
      const utils = renderSignup("/signup?token=tok123");
      await waitFor(() => expect(firstNameField()).toHaveValue("Ada"));
      return utils;
    };

    it("looks the invitation up by token and prefills the form", async () => {
      await renderInvited();

      expect(state.getInvitationByToken).toHaveBeenCalledWith("tok123");
      expect(lastNameField()).toHaveValue("Lovelace");
      expect(emailField()).toHaveValue("ada@org.com");
      expect(passwordField()).toHaveValue("");
    });

    it("re-headlines the page for the inviting organization and names the role", async () => {
      await renderInvited();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Join Family First");
      expect(screen.getByText(/invited as a Team Leader/i)).toBeInTheDocument();
      expect(screen.queryByText("Create Your Account")).not.toBeInTheDocument();
    });

    it("forwards the token only — never the invitation's org, upline, role, states or level", async () => {
      state.signup.mockResolvedValueOnce(undefined);
      await renderInvited();

      fireEvent.change(passwordField(), { target: { value: STRONG_PASSWORD } });
      fireEvent.click(submitButton());

      await waitFor(() => expect(state.signup).toHaveBeenCalledTimes(1));
      expect(state.signup.mock.calls[0]).toEqual([
        "ada@org.com",
        STRONG_PASSWORD,
        "Ada",
        "Lovelace",
        "tok123",
      ]);
      // The prefill values are display-only; none of them may reach the auth layer.
      const forwarded = state.signup.mock.calls[0];
      for (const authority of ["org-1", "up-1", "Team Leader", "75%"]) {
        expect(forwarded).not.toContain(authority);
      }
      expect(forwarded.some((a: unknown) => Array.isArray(a))).toBe(false);

      await waitFor(() =>
        expect(state.navigate).toHaveBeenCalledWith("/confirmation", { state: { email: "ada@org.com" } }),
      );
    });

    it("announces an unusable invitation link instead of failing silently", async () => {
      state.getInvitationByToken.mockRejectedValueOnce(new Error("expired"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderSignup("/signup?token=dead");

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/invitation link may be invalid or expired/i),
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create Your Account");
      errorSpy.mockRestore();
    });
  });

  describe("legacy unsigned ?invite= payload (removed)", () => {
    /** The exact shape the retired base64 branch used to decode and trust. */
    const LEGACY_BLOB = btoa(
      JSON.stringify({
        firstName: "Mallory",
        lastName: "Forge",
        email: "mallory@evil.com",
        organizationId: "victim-org",
        uplineId: "victim-upline",
        role: "Admin",
        licensedStates: ["NV"],
        commissionLevel: "100%",
      }),
    );

    it("ignores the blob entirely: no prefill, no inviting-organization headline", async () => {
      renderSignup(`/signup?invite=${encodeURIComponent(LEGACY_BLOB)}`);

      // Nothing from the attacker-authored payload reaches the form…
      await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create Your Account"));
      expect(firstNameField()).toHaveValue("");
      expect(lastNameField()).toHaveValue("");
      expect(emailField()).toHaveValue("");
      expect(screen.getByText(/start your journey as an independent agent/i)).toBeInTheDocument();
      // …and the page never treats it as an invitation.
      expect(state.getInvitationByToken).not.toHaveBeenCalled();
    });

    it("submits as a plain self-serve signup, carrying no forged authority", async () => {
      state.signup.mockResolvedValueOnce(undefined);
      renderSignup(`/signup?invite=${encodeURIComponent(LEGACY_BLOB)}`);

      fillForm();
      fireEvent.click(submitButton());

      await waitFor(() => expect(state.signup).toHaveBeenCalledTimes(1));
      expect(state.signup.mock.calls[0]).toEqual([
        "grace@agency.com",
        STRONG_PASSWORD,
        "Grace",
        "Hopper",
        null,
      ]);
    });
  });

  describe("failure and in-flight handling", () => {
    it("renders the mapped auth error in the alert region and does not navigate", async () => {
      state.signup.mockRejectedValueOnce(new Error("User already registered"));
      renderSignup();

      // The live region is mounted up front, but silent.
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();

      fillForm();
      fireEvent.click(submitButton());

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("MAPPED: User already registered"));
      expect(state.navigate).not.toHaveBeenCalled();
      // The form recovers so the user can retry.
      expect(submitButton()).toBeEnabled();
    });

    it("does not submit twice while a signup is in flight", async () => {
      let release: (value: unknown) => void = () => {};
      state.signup.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      renderSignup();

      fillForm();
      fireEvent.click(submitButton());

      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(submitButton()).toHaveTextContent(/creating account/i);
      expect(emailField()).toBeDisabled();

      fireEvent.click(submitButton());
      fireEvent.submit(signupForm());
      expect(state.signup).toHaveBeenCalledTimes(1);

      release(undefined);
      await waitFor(() => expect(state.navigate).toHaveBeenCalledTimes(1));
      expect(state.signup).toHaveBeenCalledTimes(1);
    });
  });
});
