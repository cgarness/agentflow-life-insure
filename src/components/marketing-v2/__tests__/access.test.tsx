import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ authenticated: false, loading: false, building: false, superAdmin: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: context.authenticated,
  isLoading: context.loading, isBuildingOrganization: context.building }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ isSuperAdmin: context.superAdmin }) }));
import SuperAdminRoute from "@/components/auth/SuperAdminRoute";

function show() {
  return render(<MemoryRouter initialEntries={["/homepage-v2"]}><Routes>
    <Route path="/homepage-v2" element={<SuperAdminRoute><p>Private V2</p></SuperAdminRoute>} />
    <Route path="/login" element={<p>Login required</p>} />
    <Route path="/dashboard" element={<p>CRM dashboard</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => Object.assign(context, { authenticated: false, loading: false, building: false, superAdmin: false }));
afterEach(cleanup);

describe("unchanged Super Admin gate for the V2 route", () => {
  it("sends signed-out visitors to login without rendering V2", () => {
    show(); expect(screen.getByText("Login required")).toBeTruthy(); expect(screen.queryByText("Private V2")).toBeNull();
  });
  it("refuses an ordinary signed-in user", () => {
    context.authenticated = true; show();
    expect(screen.getByText("CRM dashboard")).toBeTruthy(); expect(screen.queryByText("Private V2")).toBeNull();
  });
  it.each(["loading", "building"] as const)("reveals nothing during %s resolution", (key) => {
    context.authenticated = true; context.superAdmin = true; context[key] = true; show();
    expect(screen.queryByText("Private V2")).toBeNull(); expect(screen.queryByText("CRM dashboard")).toBeNull();
  });
  it("renders V2 only for a resolved signed-in Super Admin", () => {
    context.authenticated = true; context.superAdmin = true; show(); expect(screen.getByText("Private V2")).toBeTruthy();
  });
});
