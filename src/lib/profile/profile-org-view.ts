/**
 * profile-org-view — shaping the downline roster into the tree the Team Profile renders.
 *
 * This is a thin layer OVER `src/lib/profile-org-tree.ts`, not a second hierarchy algorithm. That
 * module already does the hard part — dedupe by id, break self-edges, detect cycles, attach to
 * upline only when the parent is in-set — and it is reused verbatim. What is added here is the
 * per-node descendant count and depth the preview and the dialog need, which are pure derivations
 * over the forest it returns.
 *
 * TWO THINGS THAT ARE DELIBERATELY NOT REUSED:
 *
 *  * `filterReportingLineHierarchy` includes the viewer's UPLINE by design
 *    (its `isInViewersUpline` walk). The Team Profile is "the organization I have built BENEATH me",
 *    so rendering the viewer's own managers above them would be exactly backwards.
 *
 *  * `HierarchyTree.tsx` (the Settings chart) is not reused. Since hierarchy stabilization F4 its
 *    rows come from `src/lib/hierarchy/hierarchyTreeData.ts` (explicit `organization_id` filter on
 *    every query, no query without an organization, and an Admin's chart is organization-wide by
 *    design), but it still renders every descendant unconditionally with a per-node blurred
 *    gradient and no collapse state — a rendering cliff on a large organization. Reusing the
 *    ALGORITHM is right; reusing that component is not.
 *
 * `buildProfileOrgForest` attaches on `upline_id` alone and knows nothing about organizations, so
 * it is safe ONLY because its input is already organization-constrained — here, the
 * `traversedIds` of `getAgentScopeTraversal` filtered by `organization_id` in the roster query
 * (`fetchTeamRoster`). Query scoping, not authorization.
 *
 * DELETED PROFILES follow the one Deleted-intermediate rule both charts share
 * (`pruneDeletedLeaves` in `profile-org-tree.ts`; hierarchy stabilization F4): the roster carries
 * the Deleted intermediates the walk passed through, and a Deleted row is kept only as a connector
 * when someone who is not Deleted reports beneath it (`isDeleted`, drawn muted with a "Deleted"
 * label, never offered as an agent). It is never counted — not in `descendantCount`,
 * `totalDownline`, `directReportCount` or `unattachedCount`. A Deleted row with nobody live
 * beneath it is dropped. A roster that lacks a Deleted intermediate still surfaces the reports
 * beneath it as `unattached`, never loses them.
 */

import {
  buildProfileOrgForest,
  isDeletedProfile,
  pruneDeletedLeaves,
  type ProfileOrgNode,
} from "@/lib/profile-org-tree";
import type { DownlineProfile } from "@/lib/profile/profile-queries";

export interface OrgTreeNode {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  /** A Deleted manager kept only so the live reports beneath it stay attached; draw it muted. */
  isDeleted: boolean;
  /** Live (non-Deleted) nodes beneath this one, at every level. Excludes the node itself. */
  descendantCount: number;
  /** 1 for the root. */
  depth: number;
  children: OrgTreeNode[];
}

export interface OrgTreeView {
  /** The viewer's node, or `null` when the viewer is not present in the roster. */
  root: OrgTreeNode | null;
  /** Immediate children of the viewer, Deleted connectors included (drawn muted). */
  directReports: OrgTreeNode[];
  /** Live (non-Deleted) direct reports — what "Direct reports" counts. */
  directReportCount: number;
  /** Everyone live beneath the viewer, at every level. EXCLUDES the viewer and Deleted connectors. */
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
  /** Live people in `unattached`, the live nodes beneath each unattached root included. */
  unattachedCount: number;
}

/** Shown on a Deleted connector, as on the Settings chart (`VisualOrgNode`). */
export const DELETED_CONNECTOR_TITLE = "Deleted member, shown because people still report through them";

/** The role line: a Deleted connector reads "Deleted · <role>", never as an agent. */
export function roleLabelFor(node: Pick<OrgTreeNode, "role" | "isDeleted">): string {
  if (!node.isDeleted) return node.role;
  return node.role ? `Deleted · ${node.role}` : "Deleted";
}

/** Live people a set of subtrees holds: each live node plus its live descendants. */
function livePeople(nodes: OrgTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + n.descendantCount + (n.isDeleted ? 0 : 1), 0);
}

/** `DownlineProfile` as an object type (not an interface), so it satisfies `ProfileOrgRow`. */
type RosterRow = { [K in keyof DownlineProfile]: DownlineProfile[K] };

function toNode(node: ProfileOrgNode<RosterRow>, depth: number): OrgTreeNode {
  const children = node.children.map((c) => toNode(c, depth + 1));
  return {
    id: node.id,
    firstName: node.first_name ?? "",
    lastName: node.last_name ?? "",
    role: node.role ?? "",
    isDeleted: isDeletedProfile(node),
    depth,
    children,
    descendantCount: livePeople(children),
  };
}

function deepest(node: OrgTreeNode): number {
  return node.children.reduce((acc, c) => Math.max(acc, deepest(c)), node.depth);
}

export function buildOrgTreeView(profiles: DownlineProfile[], rootId: string): OrgTreeView {
  const forest = pruneDeletedLeaves(
    buildProfileOrgForest<RosterRow>(profiles.map((p) => ({ ...p, upline_id: p.upline_id ?? null }))),
    new Set([rootId]),
  );

  const roots = forest.map((n) => toNode(n, 1));
  const root = roots.find((n) => n.id === rootId) ?? null;
  const unattached = roots.filter((n) => n.id !== rootId);

  const directReports = root?.children ?? [];
  return {
    root,
    directReports,
    directReportCount: directReports.filter((n) => !n.isDeleted).length,
    totalDownline: root?.descendantCount ?? 0,
    maxDepth: root ? deepest(root) : 1,
    unattached,
    unattachedCount: livePeople(unattached),
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
