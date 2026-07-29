/**
 * `/accept-group-invite` — the Agency Group invitation landing page.
 *
 * Guards the three contracts this page owns:
 *  1. It never calls the Agency Group API without a token.
 *  2. Unauthenticated visitors are bounced to `/login?redirect=<this page>` with the
 *     exact encoding `resolvePostAuthDestination` accepts (see loginPage.test.tsx).
 *  3. Accept/decline hit the real API surface and only navigate on `{ ok: true }`.
 *
 * `agencyGroupApi` is mocked so no Supabase edge function is called. Routing is only
 * partially mocked (`useNavigate`) — MemoryRouter/Routes/Link stay real.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const state = vi.hoisted(() => ({
  isAuthenticated: false,
  navigate: vi.fn(),
  preview: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: state.isAuthenticated, isLoading: false }),
}));

vi.mock("@/components/settings/agency-group/api", () => ({
  agencyGroupApi: {
    preview: state.preview,
    accept: state.accept,
    decline: state.decline,
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => state.navigate };
});

import AcceptGroupInvite from "@/pages/AcceptGroupInvite";

const TOKEN = "tok123";
/** The exact string `/login` parses back into `/accept-group-invite?token=tok123`. */
const EXPECTED_LOGIN_RETURN = "/login?redirect=%2Faccept-group-invite%3Ftoken%3Dtok123";

const PREVIEW_OK = {
  ok: true,
  data: {
    group_name: "Midwest Producers",
    master_org_name: "Summit Financial",
    invite_email: "agent@agency.com",
    expires_at: "2026-08-05T00:00:00.000Z",
  },
};

const renderInvite = (entry = `/accept-group-invite?token=${TOKEN}`) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/accept-group-invite" element={<AcceptGroupInvite />} />
      </Routes>
    </MemoryRouter>,
  );

const heading = () => screen.getByRole("heading", { level: 1 });
/** Re-query: the CTA's accessible name changes between states. */
const cta = () => screen.getByRole("button", { name: /accept invitation|log in to accept|working/i });

describe("AcceptGroupInvite (/accept-group-invite)", () => {
  beforeEach(() => {
    state.isAuthenticated = false;
    state.navigate.mockReset();
    state.preview.mockReset();
    state.accept.mockReset();
    state.decline.mockReset();
    state.preview.mockResolvedValue(PREVIEW_OK);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the verifying state while the preview request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    state.preview.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    renderInvite();

    expect(heading()).toHaveTextContent("Verifying invitation…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    // Nothing actionable is offered until the invite is verified.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    release(PREVIEW_OK);
    await waitFor(() => expect(heading()).toHaveTextContent(/Agency Group/));
  });

  it("refuses a tokenless link without calling the Agency Group API", async () => {
    renderInvite("/accept-group-invite");

    expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    expect(screen.getByText("This invitation link is missing its token.")).toBeInTheDocument();
    expect(state.preview).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /return to login/i })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });

  it("surfaces the server's rejection reason when the preview fails", async () => {
    state.preview.mockResolvedValueOnce({ ok: false, data: { error: "Invitation not found or expired." } });

    renderInvite();

    expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    expect(screen.getByText("Invitation not found or expired.")).toBeInTheDocument();
    expect(state.preview).toHaveBeenCalledWith(TOKEN);
    expect(state.accept).not.toHaveBeenCalled();
  });

  it("recovers to an error state when the preview request itself rejects (no stuck spinner)", async () => {
    // `preview` is a raw fetch — it REJECTS on network failure (offline, DNS, CORS).
    // Regression guard: the page previously had no .catch and spun forever.
    state.preview.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderInvite();

    expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't verify this invitation. Please try again in a moment."),
    ).toBeInTheDocument();
    // The spinner is gone and the visitor has a way out.
    expect(screen.queryByText("Verifying invitation…")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to login/i })).toHaveAttribute("href", "/login");
    expect(state.accept).not.toHaveBeenCalled();
  });

  it("renders the invitation details once the preview resolves", async () => {
    renderInvite();

    await waitFor(() => expect(state.preview).toHaveBeenCalledWith(TOKEN));
    expect(heading()).toHaveTextContent("Join Summit Financial's Agency Group");
    expect(await screen.findByText("Midwest Producers")).toBeInTheDocument();
  });

  it("keeps the data-separation explanation on the invitation screen", async () => {
    renderInvite();

    const copy = await screen.findByText(/remain 100% yours/i);
    expect(copy).toHaveTextContent(/contacts/i);
    expect(copy).toHaveTextContent(/phone numbers/i);
    expect(copy).toHaveTextContent(/billing/i);
    expect(copy).toHaveTextContent(/shared leaderboard/i);
  });

  describe("unauthenticated visitor", () => {
    it("offers a log-in CTA that preserves the invite as an encoded return path", async () => {
      renderInvite();

      const button = await screen.findByRole("button", { name: /log in to accept/i });
      expect(screen.getByText(/Log in as your agency's Admin to accept\./i)).toBeInTheDocument();

      fireEvent.click(button);

      expect(state.navigate).toHaveBeenCalledTimes(1);
      expect(state.navigate).toHaveBeenCalledWith(EXPECTED_LOGIN_RETURN);
      // The invite must not be consumed before the visitor has a session.
      expect(state.accept).not.toHaveBeenCalled();
    });

    it("hides the Decline action (declining requires an authenticated admin)", async () => {
      renderInvite();

      await screen.findByRole("button", { name: /log in to accept/i });
      expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
    });
  });

  describe("authenticated admin", () => {
    beforeEach(() => {
      state.isAuthenticated = true;
    });

    it("accepts the invitation and lands on the Agency Group settings section", async () => {
      state.accept.mockResolvedValueOnce({ ok: true, data: {} });
      renderInvite();

      const button = await screen.findByRole("button", { name: /accept invitation/i });
      fireEvent.click(button);

      await waitFor(() => expect(state.accept).toHaveBeenCalledWith(TOKEN));
      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/settings?section=agency-group"));
      expect(state.navigate).toHaveBeenCalledTimes(1);
    });

    it("declines the invitation and returns to the dashboard", async () => {
      state.decline.mockResolvedValueOnce({ ok: true, data: {} });
      renderInvite();

      const button = await screen.findByRole("button", { name: /^decline$/i });
      fireEvent.click(button);

      await waitFor(() => expect(state.decline).toHaveBeenCalledWith(TOKEN));
      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/dashboard"));
      expect(state.accept).not.toHaveBeenCalled();
    });

    it("surfaces an accept failure and stays put", async () => {
      state.accept.mockResolvedValueOnce({ ok: false, data: { error: "You are already in a group." } });
      renderInvite();

      fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));

      expect(await screen.findByText("You are already in a group.")).toBeInTheDocument();
      expect(heading()).toHaveTextContent("Invitation unavailable");
      expect(state.navigate).not.toHaveBeenCalled();
    });

    it("blocks a second submission while accept is in flight", async () => {
      let release: (value: unknown) => void = () => {};
      state.accept.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      renderInvite();

      fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));

      await waitFor(() => expect(cta()).toBeDisabled());
      expect(cta()).toHaveTextContent(/working/i);
      expect(screen.getByRole("button", { name: /^decline$/i })).toBeDisabled();

      fireEvent.click(cta());
      expect(state.accept).toHaveBeenCalledTimes(1);

      release({ ok: true, data: {} });
      await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/settings?section=agency-group"));
    });
  });
});
