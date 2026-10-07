import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import TwilioBalanceTile from "../TwilioBalanceTile";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: {
    realProfile: { id: "super-1", is_super_admin: true },
    isImpersonating: false,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

function renderTile() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <TwilioBalanceTile />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.auth.realProfile = { id: "super-1", is_super_admin: true };
  mocks.auth.isImpersonating = false;
});

describe("TwilioBalanceTile", () => {
  it("shows a skeleton while the first balance request is pending", () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    renderTile();
    expect(screen.getByTestId("twilio-balance-skeleton")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Twilio balance" })).toBeDisabled();
  });

  it("renders the live amount and currency for a valid balance", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        balance: "123.45",
        currency: "USD",
        updated_at: "2026-10-06T20:00:00.000Z",
      },
      error: null,
    });

    renderTile();

    expect(await screen.findByText(/123\.45/)).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("twilio-account-balance", { method: "GET" });
  });

  it("renders a genuine zero balance as zero instead of unavailable", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        balance: "0.00",
        currency: "USD",
        updated_at: "2026-10-06T20:00:00.000Z",
      },
      error: null,
    });

    renderTile();

    expect(await screen.findByText(/0\.00/)).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("renders a neutral unavailable state without technical provider errors", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("TWILIO_MASTER_AUTH_TOKEN should never be shown"),
    });

    renderTile();

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/TWILIO_MASTER_AUTH_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/should never be shown/)).not.toBeInTheDocument();
  });

  it("manual Refresh issues another request and disables while refreshing", async () => {
    let resolveSecond: ((value: unknown) => void) | null = null;
    mocks.invoke
      .mockResolvedValueOnce({
        data: {
          balance: "10.00",
          currency: "USD",
          updated_at: "2026-10-06T20:00:00.000Z",
        },
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    renderTile();
    expect(await screen.findByText(/10\.00/)).toBeInTheDocument();

    const refresh = screen.getByRole("button", { name: "Refresh Twilio balance" });
    fireEvent.click(refresh);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(refresh).toBeDisabled();

    resolveSecond?.({
      data: {
        balance: "11.00",
        currency: "USD",
        updated_at: "2026-10-06T20:01:00.000Z",
      },
      error: null,
    });

    expect(await screen.findByText(/11\.00/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).not.toBeDisabled());
  });

  it("does not mount or query during View As", () => {
    mocks.auth.isImpersonating = true;
    const view = renderTile();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("does not query when the real caller is not a Super Admin", () => {
    mocks.auth.realProfile = { id: "admin-1", is_super_admin: false };
    const view = renderTile();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("is mounted by the Super Admin Dashboard without changing the View As allow-list", () => {
    const dashboard = readFileSync(
      new URL("../../../pages/SuperAdminDashboard.tsx", import.meta.url),
      "utf8",
    );
    const viewAs = readFileSync(
      new URL("../../../lib/viewAsSurfaces.ts", import.meta.url),
      "utf8",
    );

    expect(dashboard).toContain('import TwilioBalanceTile from "@/components/super-admin/TwilioBalanceTile"');
    expect(dashboard).toContain("<TwilioBalanceTile />");
    expect(viewAs).not.toContain('"/super-admin"');
  });
});
