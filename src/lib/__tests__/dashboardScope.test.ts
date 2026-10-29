import { describe, expect, it } from "vitest";
import { kpiScopeIsFiltered, listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";

/**
 * Plan rev 1 §2A: a detail modal uses the scope of the surface that opened it. These are
 * the two shipped expressions, named; the table is every role × perspective the
 * Dashboard can produce.
 */
describe("dashboard scope rules", () => {
  it("list rule: own unless an Admin is in the Team perspective", () => {
    expect(listScopeIsFiltered("Admin", "team")).toBe(false);
    expect(listScopeIsFiltered("Admin", "my")).toBe(true);
    expect(listScopeIsFiltered("Team Leader", "team")).toBe(true);
    expect(listScopeIsFiltered("Team Leader", "my")).toBe(true);
    expect(listScopeIsFiltered("Agent", "my")).toBe(true);
    expect(listScopeIsFiltered("Super Admin", "my")).toBe(true);
  });

  it("KPI rule: own unless the Reports scope allows more in the Team perspective", () => {
    expect(kpiScopeIsFiltered("all", "team")).toBe(false);
    expect(kpiScopeIsFiltered("team", "team")).toBe(false);
    expect(kpiScopeIsFiltered("own", "team")).toBe(true);
    expect(kpiScopeIsFiltered("all", "my")).toBe(true);
  });

  it("discloses own-only lists to a Team Leader in the Team perspective only", () => {
    expect(listScopeNote("Team Leader", "team", "callbacks")).toMatch(/^Showing your own callbacks\./);
    expect(listScopeNote("Team Leader", "my", "callbacks")).toBeNull();
    expect(listScopeNote("Admin", "team", "callbacks")).toBeNull();
  });
});
