/**
 * profile-org-view — shaping the downline roster into the tree the Team Profile renders.
 *
 * This is a thin layer OVER `src/lib/profile-org-tree.ts`, not a second hierarchy algorithm. That
 * module already does the hard part — dedupe by id, break self-edges, detect cycles, attach to
 * upline only when the parent is in-set — and it is reused verbatim. What is added here is the
 * per-node descendant count and depth the preview and the dialog need, which are pure derivations
 * over the forest it returns.
 *
 * TWO THINGS IN `profile-org-tree.ts` THAT ARE DELIBERATELY NOT USED:
 *
 *  * `filterReportingLineHierarchy` includes the viewer's UPLINE by design
 *    (profile-org-tree.ts:96-104). The Team Profile is "the organization I have built BENEATH me",
 *    so rendering the viewer's own managers above them would be exactly backwards.
 *
 *  * `HierarchyTree.tsx` (the component) is not reused at all. Its own fetch carries NO
 *    `organization_id` filter (:216-222) and `profilesForOrgTree` deliberately admits rows from
 *    other organizations linked by `upline_id` (:187-197), returning every row when
 *    `organizationId` is null (:168). It also renders every descendant unconditionally with a
 *    per-node blurred gradient and no collapse state. Reusing the ALGORITHM is right; reusing that
 *    component would import a cross-tenant leak and a rendering cliff.
 *
 * `buildProfileOrgForest` attaches on `upline_id` alone and knows nothing about organizations, so
 * it is safe ONLY because its input is already organization-constrained — here, the output of
 * `getAgentScopeIds` filtered by `organization_id` in the roster query.
 */

import { buildProfileOrgForest, type ProfileOrgNode } from "@/lib/profile-org-tree";
import type { DownlineProfile } from "@/lib/profile/profile-queries";

export interface OrgTreeNode {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  /** Nodes beneath this one, at every level. Excludes the node itself. */
  descendantCount: number;
  /** 1 for the root. */
  depth: number;
  children: OrgTreeNode[];
}

export interface OrgTreeView {
  /** The viewer's node, or `null` when the viewer is not present in the roster. */
  root: OrgTreeNode | null;
  /** Immediate children of the viewer. */
  directReports: OrgTreeNode[];
  /** Everyone beneath the viewer, at every level. EXCLUDES the viewer. */
  totalDownline: number;
  /** Deepest level reached below the viewer; 1 when the viewer has no downline. */
  maxDepth: number;
  /**
   * Profiles that are in the authorized scope but are NOT reachable from the viewer's node in the
   * forest — an upline that the roster does not contain, or a cycle the builder broke. They are
   * surfaced rather than dropped, because silently losing an authorized agent from the org chart is
   * worse than showing them as unattached.
   */
  unattached: OrgTreeNode[];
}

function toNode(node: ProfileOrgNode<DownlineProfile & { id: string; upline_id: string | null }>, depth: number): OrgTreeNode {
  const children = node.children.map((c) => toNode(c as never, depth + 1));
  return {
    id: node.id,
    firstName: node.first_name ?? "",
    lastName: node.last_name ?? "",
    role: node.role ?? "",
    depth,
    children,
    descendantCount: children.reduce((sum, c) => sum + c.descendantCount + 1, 0),
  };
}

function deepest(node: OrgTreeNode): number {
  return node.children.reduce((acc, c) => Math.max(acc, deepest(c)), node.depth);
}

export function buildOrgTreeView(profiles: DownlineProfile[], rootId: string): OrgTreeView {
  const forest = buildProfileOrgForest(
    profiles.map((p) => ({ ...p, upline_id: p.upline_id ?? null })),
  );

  const roots = forest.map((n) => toNode(n as never, 1));
  const root = roots.find((n) => n.id === rootId) ?? null;
  const unattached = roots.filter((n) => n.id !== rootId);

  return {
    root,
    directReports: root?.children ?? [],
    totalDownline: root?.descendantCount ?? 0,
    maxDepth: root ? deepest(root) : 1,
    unattached,
  };
}

/** Initials for a roster entry. Avatars are never loaded in a list — they are base64 data URLs. */
export function initialsFor(node: { firstName: string; lastName: string }): string {
  const a = node.firstName.trim().charAt(0);
  const b = node.lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

/** Full name, or a neutral placeholder when the roster row carries no name at all. */
export function displayNameFor(node: { firstName: string; lastName: string }): string {
  const name = `${node.firstName} ${node.lastName}`.trim();
  return name === "" ? "Unnamed agent" : name;
}
