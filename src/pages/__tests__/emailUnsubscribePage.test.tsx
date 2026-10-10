/**
 * `/email/unsubscribe` — public confirm page for the onboarding tips footer link.
 * Contracts: opening the page never unsubscribes (link scanners); one click sends exactly one
 * request; an invalid link never calls the API; every outcome is shown truthfully.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("@/lib/emailSubscriptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/emailSubscriptions")>("@/lib/emailSubscriptions");
  return { ...actual, submitUnsubscribe: (token: string) => state.submit(token) };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", theme: "dark", setTheme: vi.fn() }) }));

import EmailUnsubscribePage from "../EmailUnsubscribePage";

const TOKEN = "v1.eyJ1IjoiMDAwIn0.c2lnbmF0dXJl";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/email/unsubscribe" element={<EmailUnsubscribePage />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => state.submit.mockReset());
afterEach(cleanup);

describe("EmailUnsubscribePage", () => {
  it("does not unsubscribe on load; asks for confirmation", () => {
    renderAt(`/email/unsubscribe?token=${TOKEN}`);
    expect(screen.getByRole("heading", { name: /unsubscribe from onboarding tips/i })).toBeInTheDocument();
    expect(screen.getByText(/account and security emails aren't affected/i)).toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("sends exactly one request on click, even if clicked twice, and confirms", async () => {
    let resolve!: (v: string) => void;
    state.submit.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderAt(`/email/unsubscribe?token=${TOKEN}`);
    const button = screen.getByRole("button", { name: /^unsubscribe$/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit).toHaveBeenCalledWith(TOKEN);
    resolve("unsubscribed");
    expect(await screen.findByRole("heading", { name: /you're unsubscribed/i })).toBeInTheDocument();
  });

  it("an invalid or missing link never calls the API", () => {
    for (const url of ["/email/unsubscribe", "/email/unsubscribe?token=javascript:alert(1)"]) {
      renderAt(url);
      expect(screen.getByRole("heading", { name: /this link isn't valid/i })).toBeInTheDocument();
      cleanup();
    }
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("shows a server-rejected link as invalid and a failure as retryable", async () => {
    state.submit.mockResolvedValueOnce("invalid");
    renderAt(`/email/unsubscribe?token=${TOKEN}`);
    fireEvent.click(screen.getByRole("button", { name: /^unsubscribe$/i }));
    expect(await screen.findByRole("heading", { name: /this link isn't valid/i })).toBeInTheDocument();
    cleanup();

    state.submit.mockResolvedValueOnce("error").mockResolvedValueOnce("unsubscribed");
    renderAt(`/email/unsubscribe?token=${TOKEN}`);
    fireEvent.click(screen.getByRole("button", { name: /^unsubscribe$/i }));
    expect(await screen.findByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /you're unsubscribed/i })).toBeInTheDocument());
    // One call for the rejected link above, then the failed attempt and its retry here.
    expect(state.submit).toHaveBeenCalledTimes(3);
  });
});
