/**
 * `/confirmation` — the post-signup "verify your email" screen.
 *
 * Locks the contract with `SignupPage`, which hands off via
 * `navigate("/confirmation", { state: { email } })`: the supplied address is
 * echoed back, direct navigation (no router state) degrades to generic wording
 * instead of crashing, the spam-folder guidance survives, and "Back to login"
 * is a real link to `/login` (rendered through `asChild`), not a button.
 * Routing is real — only `MemoryRouter` supplies the location state.
 * Uses `fireEvent` (no `user-event` dependency in this repo).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import ConfirmationPage from "@/pages/ConfirmationPage";

const EMAIL = "agent@agency.com";

/** Renders the real page through a real route; `entry` controls location state. */
const renderConfirmation = (entry: any = { pathname: "/confirmation", state: { email: EMAIL } }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/confirmation" element={<ConfirmationPage />} />
        <Route path="/login" element={<h1>Sign in screen</h1>} />
      </Routes>
    </MemoryRouter>,
  );

const heading = () => screen.getByRole("heading", { level: 1 });
const backToLogin = () => screen.getByRole("link", { name: /back to login/i });

describe("ConfirmationPage (/confirmation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the verify-your-email heading", () => {
    renderConfirmation();
    expect(heading()).toHaveTextContent("Verify your email");
  });

  it("echoes back the email handed over in router state", () => {
    renderConfirmation();

    const address = screen.getByText(EMAIL);
    expect(address).toBeInTheDocument();
    // The address belongs to the "we sent a link to <email>" sentence, not a stray node.
    expect(address.parentElement).toHaveTextContent(
      /we['’]ve sent a verification link to agent@agency\.com\. check your inbox/i,
    );
    expect(screen.queryByText("your email")).not.toBeInTheDocument();
  });

  it("renders whatever address signup passed, not a hardcoded one", () => {
    renderConfirmation({ pathname: "/confirmation", state: { email: "grace.hopper+tag@navy.mil" } });

    expect(screen.getByText("grace.hopper+tag@navy.mil")).toBeInTheDocument();
    expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
  });

  it("falls back to generic wording on direct navigation with no router state", () => {
    renderConfirmation("/confirmation");

    expect(heading()).toHaveTextContent("Verify your email");
    expect(screen.getByText("your email")).toBeInTheDocument();
    expect(screen.getByText("your email").parentElement).toHaveTextContent(
      /we['’]ve sent a verification link to your email\. check your inbox/i,
    );
  });

  it("falls back when router state exists but carries no email", () => {
    renderConfirmation({ pathname: "/confirmation", state: { token: "abc123" } });

    expect(screen.getByText("your email")).toBeInTheDocument();
  });

  it("falls back when the email in router state is an empty string", () => {
    renderConfirmation({ pathname: "/confirmation", state: { email: "" } });

    expect(screen.getByText("your email")).toBeInTheDocument();
  });

  it("keeps the spam-folder guidance", () => {
    renderConfirmation();
    expect(screen.getByText(/didn['’]t receive an email\?\s*check your spam folder\./i)).toBeInTheDocument();
  });

  it("points 'Back to login' at /login as a link, not a button", () => {
    renderConfirmation();

    expect(backToLogin()).toHaveAttribute("href", "/login");
    // `asChild` must collapse the primary button into the anchor.
    expect(screen.queryByRole("button", { name: /back to login/i })).not.toBeInTheDocument();
  });

  it("actually routes to /login when 'Back to login' is clicked", () => {
    renderConfirmation();

    fireEvent.click(backToLogin());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in screen");
    expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
  });

  it("exposes no form controls — this screen only waits for the emailed link", () => {
    renderConfirmation();

    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
