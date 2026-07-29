/**
 * `/accept-invite` — invitation landing page.
 *
 * Covers the lookup gate (missing token), every terminal failure state
 * (invalid / revoked / expired / already-used / lookup error) and the happy
 * path hand-off to `/signup?token=...`.
 *
 * Also guards the 2026-07-28 cleanup: the cosmetic 2200ms `setTimeout` and the
 * four fake "Decrypting Invitation Token…" progress steps were removed, so the
 * lookup must fire immediately on mount and none of that copy may return.
 *
 * Only `@/lib/supabase-users` and `useNavigate` are mocked — the real page,
 * real router and real auth shell components render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const state = vi.hoisted(() => ({
  getInvitationByToken: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: { getInvitationByToken: state.getInvitationByToken },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => state.navigate };
});

import AcceptInvitePage from "@/pages/AcceptInvitePage";

const TOKEN = "inv-tok-9f3a";

const renderInvite = (entry = `/accept-invite?token=${TOKEN}`) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Routes>
    </MemoryRouter>,
  );

const heading = () => screen.getByRole("heading", { level: 1 });
const bodyText = () => document.body.textContent ?? "";

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const VALID_INVITE = {
  status: "Pending",
  expires_at: FUTURE,
  first_name: "Ada",
  role: "Agent",
  org_name: "Family First",
};

describe("AcceptInvitePage (/accept-invite)", () => {
  beforeEach(() => {
    state.getInvitationByToken.mockReset();
    state.navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("loading", () => {
    it("shows the plain verifying state while the lookup is in flight", async () => {
      state.getInvitationByToken.mockImplementation(() => new Promise(() => {}));
      renderInvite();

      expect(await screen.findByText("Verifying your invitation…")).toBeInTheDocument();
      expect(heading()).toHaveTextContent("Verifying your invitation…");
      // `live` on AuthStatusState — the spinner state is announced.
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    });

    it("does not resurrect the retired theatrical progress copy", () => {
      state.getInvitationByToken.mockImplementation(() => new Promise(() => {}));
      renderInvite();

      for (const retired of [/Decrypting/i, /Secure Handshake/i, /Establishing Secure Connection/i, /security servers/i]) {
        expect(bodyText()).not.toMatch(retired);
      }
    });

    it("issues the lookup immediately on mount (no cosmetic delay)", async () => {
      state.getInvitationByToken.mockImplementation(() => new Promise(() => {}));
      renderInvite();

      // Would fail if the removed 2200ms setTimeout came back.
      await waitFor(() => expect(state.getInvitationByToken).toHaveBeenCalledTimes(1), { timeout: 500 });
      expect(state.getInvitationByToken).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe("failure states", () => {
    it("reports a missing token without ever hitting the API", async () => {
      renderInvite("/accept-invite");

      expect(await screen.findByText("Missing token")).toBeInTheDocument();
      expect(screen.getByText(/No invitation token was provided/i)).toBeInTheDocument();
      expect(state.getInvitationByToken).not.toHaveBeenCalled();
    });

    it("reports an invalid invitation when the lookup resolves null", async () => {
      state.getInvitationByToken.mockResolvedValueOnce(null);
      renderInvite();

      expect(await screen.findByText("Invalid invitation")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
    });

    it("reports a revoked invitation", async () => {
      state.getInvitationByToken.mockResolvedValueOnce({ status: "Revoked", expires_at: FUTURE });
      renderInvite();

      expect(await screen.findByText("Invitation revoked")).toBeInTheDocument();
      expect(screen.getByText(/revoked by an administrator/i)).toBeInTheDocument();
    });

    it("reports an expired invitation when expires_at is in the past", async () => {
      state.getInvitationByToken.mockResolvedValueOnce({ status: "Pending", expires_at: PAST });
      renderInvite();

      expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
      expect(screen.getByText(/expired after 7 days/i)).toBeInTheDocument();
    });

    it("reports an expired invitation when the status itself is Expired", async () => {
      state.getInvitationByToken.mockResolvedValueOnce({ status: "Expired", expires_at: FUTURE });
      renderInvite();

      expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    });

    it("reports an already-accepted invitation", async () => {
      state.getInvitationByToken.mockResolvedValueOnce({ status: "Accepted", expires_at: FUTURE });
      renderInvite();

      expect(await screen.findByText("Already used")).toBeInTheDocument();
      expect(screen.getByText(/already been used to create an account/i)).toBeInTheDocument();
    });

    it("reports a failed lookup when the API rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      state.getInvitationByToken.mockRejectedValueOnce(new Error("network down"));
      renderInvite();

      expect(await screen.findByText("Verification failed")).toBeInTheDocument();
    });

    it("offers a route back to login from a failure state", async () => {
      state.getInvitationByToken.mockResolvedValueOnce(null);
      renderInvite();

      await screen.findByText("Invalid invitation");
      expect(screen.getByRole("link", { name: /return to login/i })).toHaveAttribute("href", "/login");
      expect(state.navigate).not.toHaveBeenCalled();
    });
  });

  describe("valid invitation", () => {
    it("renders the organization, invitee and role", async () => {
      state.getInvitationByToken.mockResolvedValueOnce(VALID_INVITE);
      renderInvite();

      await waitFor(() => expect(heading()).toHaveTextContent("You're invited to Family First"));
      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("Agent")).toBeInTheDocument();
      expect(screen.queryByText("Verifying your invitation…")).not.toBeInTheDocument();
    });

    it("falls back to the nested organizations.name, then to AgentFlow", async () => {
      state.getInvitationByToken.mockResolvedValueOnce({
        status: "Pending",
        expires_at: FUTURE,
        first_name: "Grace",
        role: "Manager",
        organizations: { name: "Legacy Mutual" },
      });
      renderInvite();

      await waitFor(() => expect(heading()).toHaveTextContent("You're invited to Legacy Mutual"));
    });

    it("forwards to /signup with the exact token on accept", async () => {
      state.getInvitationByToken.mockResolvedValueOnce(VALID_INVITE);
      renderInvite();

      const accept = await screen.findByRole("button", { name: /accept & create account/i });
      expect(state.navigate).not.toHaveBeenCalled();

      fireEvent.click(accept);

      expect(state.navigate).toHaveBeenCalledTimes(1);
      expect(state.navigate).toHaveBeenCalledWith(`/signup?token=${TOKEN}`);
    });

    it("does not carry over the retired trust badges", async () => {
      state.getInvitationByToken.mockResolvedValueOnce(VALID_INVITE);
      renderInvite();

      await screen.findByRole("button", { name: /accept & create account/i });
      expect(screen.queryByText(/^SECURE$/)).not.toBeInTheDocument();
      expect(bodyText()).not.toMatch(/GLOBAL/);
      expect(bodyText()).not.toMatch(/REAL-TIME/);
    });
  });
});
