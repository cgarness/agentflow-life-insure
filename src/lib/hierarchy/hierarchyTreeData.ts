/**
 * Rows for the Settings → Hierarchy chart (hierarchy stabilization F4).
 *
 * Query scoping, not authorization — `profiles_select_org` permits same-org reads. What
 * this loader guarantees is that the browser asks only for what the chart draws:
 *  - display columns only (`HIERARCHY_TREE_COLUMNS`); never `hierarchy_path`, never the
 *    full `getByIds` projection (commission, NPN, licences);
 *  - an explicit `organization_id` filter on every query, and no query without an
 *    organization (fail closed);
 *  - Deleted profiles ARE loaded so an Active member beneath a Deleted manager stays
 *    attached; the chart decides how to draw them (muted) — never re-filter a
 *    query-scoped set with `filterReportingLineHierarchy`.
 *
 * Admin / Super Admin viewers load the whole organization. Team Leader and Agent viewers
 * load only their own reporting line: themselves, everyone the downline walk passed
 * through (`getAgentScopeTraversal`, Deleted included) and their upline chain
 * (`getUplineChainIds`). Any error rejects; there is no organization-wide fallback.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  AGENT_SCOPE_ID_BATCH_SIZE,
  AGENT_SCOPE_MAX_PAGES_PER_BATCH,
  AGENT_SCOPE_PAGE_SIZE,
  usersSupabaseApi,
} from "@/lib/supabase-users";

export const HIERARCHY_TREE_COLUMNS = "id, first_name, last_name, email, role, status, upline_id, avatar_url";

/** A type alias (not an interface) so rows pass straight to `buildProfileOrgForest`. */
export type HierarchyTreeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  upline_id: string | null;
  avatar_url: string | null;
};

export interface HierarchyTreeViewer {
  viewerId: string | null | undefined;
  organizationId: string | null | undefined;
  /** The viewer's profile role (Admin / Super Admin / Team Leader / Agent). */
  role: string | null | undefined;
  /** The viewer's profile `is_super_admin`. */
  isSuperAdmin?: boolean | null;
}

export interface HierarchyTreeData {
  rows: HierarchyTreeRow[];
  /** `organization`: every member of the org; `reporting-line`: the viewer's chain + downline. */
  scope: "organization" | "reporting-line" | "none";
}

const NO_DATA: HierarchyTreeData = { rows: [], scope: "none" };

function isOrganizationWideViewer(viewer: HierarchyTreeViewer): boolean {
  if (viewer.isSuperAdmin === true) return true;
  return viewer.role === "Admin" || viewer.role === "Super Admin";
}

/** Every profile of the organization (Deleted included), created_at order, paged. */
async function loadOrganization(organizationId: string): Promise<HierarchyTreeRow[]> {
  const rows: HierarchyTreeRow[] = [];
  for (let page = 0; ; page += 1) {
    if (page >= AGENT_SCOPE_MAX_PAGES_PER_BATCH) {
      throw new Error("Hierarchy load exceeded its maximum page count.");
    }
    const offset = page * AGENT_SCOPE_PAGE_SIZE;
    const { data, error } = await supabase
      .from("profiles")
      .select(HIERARCHY_TREE_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + AGENT_SCOPE_PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = (data ?? []) as unknown as HierarchyTreeRow[];
    rows.push(...pageRows);
    if (pageRows.length < AGENT_SCOPE_PAGE_SIZE) return rows;
  }
}

/**
 * The viewer's reporting line: upline chain (root first), then the viewer and every
 * profile the downline walk reached, in walk order — so a manager always precedes the
 * people beneath it. Ids are batched; `id` is unique, so a batch never exceeds its size.
 */
async function loadReportingLine(viewerId: string, organizationId: string): Promise<HierarchyTreeRow[]> {
  const [traversal, chain] = await Promise.all([
    usersSupabaseApi.getAgentScopeTraversal({ viewerId, organizationId }),
    usersSupabaseApi.getUplineChainIds({ profileId: viewerId, organizationId }),
  ]);

  const orderedIds = Array.from(new Set([...[...chain].reverse(), ...traversal.traversedIds]));
  if (orderedIds.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < orderedIds.length; i += AGENT_SCOPE_ID_BATCH_SIZE) {
    batches.push(orderedIds.slice(i, i + AGENT_SCOPE_ID_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      supabase.from("profiles").select(HIERARCHY_TREE_COLUMNS).eq("organization_id", organizationId).in("id", batch),
    ),
  );

  const byId = new Map<string, HierarchyTreeRow>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as unknown as HierarchyTreeRow[]) {
      if (row?.id) byId.set(row.id, row);
    }
  }
  return orderedIds.map((id) => byId.get(id)).filter((row): row is HierarchyTreeRow => !!row);
}

export async function loadHierarchyTreeData(viewer: HierarchyTreeViewer): Promise<HierarchyTreeData> {
  const viewerId = (viewer.viewerId ?? "").trim();
  const organizationId = (viewer.organizationId ?? "").trim();
  if (!viewerId || !organizationId) return NO_DATA;

  if (isOrganizationWideViewer(viewer)) {
    return { rows: await loadOrganization(organizationId), scope: "organization" };
  }
  return { rows: await loadReportingLine(viewerId, organizationId), scope: "reporting-line" };
}
