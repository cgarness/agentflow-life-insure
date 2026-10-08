import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TwilioBalanceTile from "../TwilioBalanceTile";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: { isImpersonating: false },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

function renderTile() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TwilioBalanceTile />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.auth.isImpersonating = false;
  mocks.invoke.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TwilioBalanceTile", () => {
  it("shows a loading skeleton before the balance resolves", () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    renderTile();
    expect(screen.getByLabelText("Loading Twilio balance")).toBeInTheDocument();
  });

  it("renders a positive master balance and subtle currency", async () => {
    mocks.invoke.mockResolvedValue({
      data: { balance: "123.45", currency: "USD", updated_at: "2026-10-07T16:30:00.000Z" },
      error: null,
    });
    renderTile();
    expect(await screen.findByText(/123\.45/)).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("twilio-account-balance");
  });

  it("renders a genuine zero as money rather than unavailable", async () => {
    mocks.invoke.mockResolvedValue({
      data: { balance: "0.00", currency: "USD", updated_at: "2026-10-07T16:30:00.000Z" },
      error: null,
    });
    renderTile();
    expect(await screen.findByText(/0\.00/)).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("shows a neutral unavailable state for function failures without technical details", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: { message: "TWILIO_MASTER_AUTH_TOKEN leaked-detail" },
    });
    renderTile();
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/TWILIO_MASTER_AUTH_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/leaked-detail/)).not.toBeInTheDocument();
  });

  it("shows unavailable for malformed success payloads", async () => {
    mocks.invoke.mockResolvedValue({
      data: { balance: "not-money", currency: "USD", account_sid: "ACshould-not-be-here" },
      error: null,
    });
    renderTile();
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  });

  it("manual Refresh re-fetches and is accessible", async () => {
    mocks.invoke.mockResolvedValue({
      data: { balance: "10.00", currency: "USD", updated_at: "2026-10-07T16:30:00.000Z" },
      error: null,
    });
    renderTile();
    await screen.findByText(/10\.00/);
    const refresh = screen.getByRole("button", { name: "Refresh Twilio balance" });
    fireEvent.click(refresh);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  });

  it("does not render or issue a request while View As is active", async () => {
    mocks.auth.isImpersonating = true;
    const { container } = renderTile();
    expect(container).toBeEmptyDOMElement();
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
