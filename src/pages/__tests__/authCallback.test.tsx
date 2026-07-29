/**
 * `/auth/callback` — the Supabase email-confirmation / OAuth landing route.
 *
 * Locks the three-state machine (loading -> success -> redirect, or error) and the
 * two things that are easy to regress silently:
 *  - the destination goes through `resolvePostAuthPath` (real, not mocked), so the
 *    onboarding gate cannot be bypassed by landing on this route;
 *  - the failure screen stays opaque — the raw Supabase error text is never painted
 *    into the DOM — and the 3s redirect timer is cleared on unmount.
 * Only `@/integrations/supabase/client` and `useNavigate` are mocked; the real page,
 * the real auth shell components and real routing all render.
 * Uses `fireEvent`-free assertions (no `user-event` dependency in this repo) and no
 * fake timers, matching the rest of the suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: state.exchangeCodeForSession,
      getSession: state.getSession,
    },
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => state.navigate };
});

import AuthCallback from "@/pages/AuthCallback";

const ONBOARDED_USER = { id: "u1", user_metadata: {} };
const WIZARD_PENDING_USER = {
  id: "u2",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { needs_app_wizard: true },
};

const sessionFor = (user: unknown) => ({ data: { session: { user } }, error: null });

/** Point `window.location.search` at the URL the page reads directly. */
const setUrl = (url: string) => window.history.replaceState({}, "", url);

const renderCallback = () =>
  render(
    <MemoryRouter initialEntries={["/auth/callback"]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    </MemoryRouter>,
  );

const heading = () => screen.getByRole("heading", { level: 1 });

describe("AuthCallback (/auth/callback)", () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.exchangeCodeForSession.mockReset();
    state.getSession.mockReset();
    state.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    state.getSession.mockResolvedValue(sessionFor(ONBOARDED_USER));
    setUrl("/auth/callback?code=abc");
  });

  afterEach(() => {
    cleanup();
    setUrl("/");
  });

  it("shows the confirming state while the exchange is still in flight", () => {
    // Never settles — the page must stay on the loading screen.
    state.exchangeCodeForSession.mockReturnValue(new Promise(() => {}));

    renderCallback();

    expect(heading()).toHaveTextContent("Confirming your account…");
    // Announced to assistive tech while it waits.
    expect(screen.getByRole("status")).toHaveTextContent("Confirming your account…");
    expect(screen.queryByText("Email confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmation failed")).not.toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("exchanges the ?code for a session, confirms, then redirects an onboarded user to /dashboard", async () => {
    renderCallback();

    await waitFor(() => expect(heading()).toHaveTextContent("Email confirmed"));

    expect(state.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(state.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(screen.getByText(/Your account is ready\. Taking you to AgentFlow…/)).toBeInTheDocument();
    // Success is a visible beat first — the redirect is deferred, not immediate.
    expect(state.navigate).not.toHaveBeenCalled();

    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/dashboard"), { timeout: 4000 });
    expect(state.navigate).toHaveBeenCalledTimes(1);
  }, 10000);

  it("honors the onboarding gate — a wizard-pending user lands on /onboarding, not /dashboard", async () => {
    state.getSession.mockResolvedValue(sessionFor(WIZARD_PENDING_USER));

    renderCallback();

    await waitFor(() => expect(heading()).toHaveTextContent("Email confirmed"));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/onboarding"), { timeout: 4000 });
    expect(state.navigate).not.toHaveBeenCalledWith("/dashboard");
  }, 10000);

  it("falls back to the existing session when there is no ?code and never exchanges one", async () => {
    setUrl("/auth/callback");

    renderCallback();

    await waitFor(() => expect(heading()).toHaveTextContent("Email confirmed"));

    expect(state.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(state.getSession).toHaveBeenCalled();

    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/dashboard"), { timeout: 4000 });
  }, 10000);

  it("fails opaquely on a bad code: no raw error text, a link back to /login, no redirect", async () => {
    state.exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error("bad code") });

    renderCallback();

    await waitFor(() => expect(heading()).toHaveTextContent("Confirmation failed"));

    expect(screen.getByText("This link may have expired or already been used.")).toBeInTheDocument();

    // The Supabase message must never reach the user.
    expect(screen.queryByText(/bad code/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("bad code");

    const backToLogin = screen.getByRole("link", { name: /back to login/i });
    expect(backToLogin).toHaveAttribute("href", "/login");

    expect(screen.queryByText("Email confirmed")).not.toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("does not navigate after unmount — the 3s redirect timer is cleared", async () => {
    const { unmount } = renderCallback();

    await waitFor(() => expect(heading()).toHaveTextContent("Email confirmed"));
    expect(state.navigate).not.toHaveBeenCalled();

    unmount();

    // Well past the 3s redirect the page had queued.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(state.navigate).not.toHaveBeenCalled();
  }, 10000);
});
