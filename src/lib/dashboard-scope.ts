/**
 * Dashboard scope rules (plan rev 1, §2A).
 *
 * Principle: a detail modal uses the scope of the surface that opened it.
 * - KPI cards (and the modals they open) use the Reports data scope, resolved
 *   server-side by the performance RPCs (`useDashboardStats.ts` has the same rule).
 * - List widgets (Callbacks, Schedule, Missed Calls, Client Milestones) and the
 *   modals they open use the role rule below.
 *
 * Both expressions are the ones already shipped; this module only names them, so a
 * widget and its modal can no longer disagree. No permission, role or RLS changes.
 */
import type { DataScope } from "@/config/permissionDefaults";

export type DashboardPerspective = "team" | "my";
export type DashboardModalOrigin = "kpi" | "widget";

/** KPI rule: own unless the Reports scope allows more and the Team perspective is on. */
export function kpiScopeIsFiltered(reportsScope: DataScope, perspective: DashboardPerspective): boolean {
  return reportsScope === "own" || perspective === "my";
}

/** List rule: own unless an Admin is in the Team perspective. */
export function listScopeIsFiltered(role: string, perspective: DashboardPerspective): boolean {
  return role !== "Admin" || perspective === "my";
}

/**
 * Disclosure for a Team Leader in the Team perspective: list widgets show the
 * viewer's own items (team totals stay in the KPI cards). `null` otherwise.
 */
export function listScopeNote(role: string, perspective: DashboardPerspective, items: string): string | null {
  if (role !== "Team Leader" || perspective !== "team") return null;
  return `Showing your own ${items}. Team lists for this section aren't available on the Dashboard yet.`;
}
