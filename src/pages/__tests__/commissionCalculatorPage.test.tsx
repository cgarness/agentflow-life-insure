/**
 * The calculator route guards itself: the "View Own Commission Percentage" permission (D3), never under
 * "View As" (no query is even enabled), and distinct states for loading, not configured, no access and
 * load errors. The workspace is keyed by user, agency and grid so nothing survives an identity change.
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";

const h = vi.hoisted(() => ({
  isImpersonating: false,
  permitted: true,
  permissionsLoading: false,
  context: { data: undefined as unknown, isError: false, refetch: vi.fn() },
  contextEnabled: [] as boolean[],
  accessOptions: [] as unknown[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { organization_id: "org-1" }, isImpersonating: h.isImpersonating }),
}));
vi.mock("@/hooks/useCommissionCalculator", () => ({
  useCommissionCalculatorAccess: (options: unknown) => {
    h.accessOptions.push(options);
    return { permitted: h.permitted, permissionsLoading: h.permissionsLoading, isImpersonating: h.isImpersonating };
  },
  useCommissionCalculatorContext: (enabled: boolean) => {
    h.contextEnabled.push(enabled);
    return h.context;
  },
}));
vi.mock("@/components/commission/calculator/CalculatorWorkspace", () => ({
  default: ({ context }: { context: { grid: { name: string } } }) => <div data-testid="workspace">{context.grid.name}</div>,
}));

import CommissionCalculatorPage from "../CommissionCalculatorPage";

beforeEach(() => {
  h.isImpersonating = false;
  h.permitted = true;
  h.permissionsLoading = false;
  h.context = { data: undefined, isError: false, refetch: vi.fn() };
  h.contextEnabled = [];
  h.accessOptions = [];
});
afterEach(cleanup);

describe("Commission Calculator page", () => {
  it("never enables a query under View As", () => {
    h.isImpersonating = true;
    render(<CommissionCalculatorPage />);
    expect(screen.getByText("Commission Calculator isn't available")).toBeInTheDocument();
    expect(h.contextEnabled.every((enabled) => enabled === false)).toBe(true);
    expect(h.accessOptions).toEqual(expect.arrayContaining([{ enabled: false }]));
  });

  it("respects the View Own Commission Percentage permission and issues no query without it", () => {
    h.permitted = false;
    render(<CommissionCalculatorPage />);
    expect(screen.getByText("Commission Calculator isn't available for your role")).toBeInTheDocument();
    expect(h.contextEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it("shows loading while permissions or the grid load", () => {
    h.permissionsLoading = true;
    render(<CommissionCalculatorPage />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    cleanup();
    h.permissionsLoading = false;
    render(<CommissionCalculatorPage />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(h.contextEnabled.at(-1)).toBe(true);
  });

  it.each([
    ["not_configured", "Your agency hasn't set up the Commission Calculator yet"],
    ["no_access", "Commission Calculator isn't available"],
  ])("explains the %s state", (status, text) => {
    h.context.data = { status };
    render(<CommissionCalculatorPage />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("offers a retry on a load error instead of showing any fallback data", () => {
    h.context.isError = true;
    render(<CommissionCalculatorPage />);
    expect(screen.getByText("The calculator couldn't load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.context.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("renders the workspace for a ready grid", () => {
    h.context.data = syntheticContext();
    render(<CommissionCalculatorPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Commission Calculator" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace").textContent).toBe("Synthetic Test Grid");
  });
});
