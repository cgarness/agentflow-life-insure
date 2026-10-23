/**
 * Builds a forest of profile nodes from flat rows (upline_id edges).
 * Breaks self-edges and cycles so every row appears exactly once (display-safe).
 *
 * Attachment uses `upline_id` alone and knows nothing about organizations: the input must
 * already be organization-constrained by its QUERY (Settings → Hierarchy:
 * `src/lib/hierarchy/hierarchyTreeData.ts`; Team Profile: `fetchTeamRoster`). Nothing here
 * widens or narrows a scope — query scoping, not authorization.
 */

export interface ProfileOrgRow {
  id: string;
  upline_id: string | null;
  [key: string]: unknown;
}

export type ProfileOrgNode<T extends ProfileOrgRow = ProfileOrgRow> = T & {
  children: ProfileOrgNode<T>[];
};

/** Walk parent pointers from `startId`; true if `childId` is reached (cycle back to child). */
export function uplineChainReachesId(
  childId: string,
  startParentId: string,
  uplineById: Map<string, string | null>,
  maxHops = 512,
): boolean {
  if (startParentId === childId) return true;
  const seen = new Set<string>();
  let cur: string | null = startParentId;
  let hops = 0;
  while (cur != null && hops++ < maxHops) {
    if (cur === childId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = uplineById.get(cur) ?? null;
  }
  return false;
}

/**
 * Deduplicate by id (stable: first row wins), then attach each node to upline
 * when upline exists in-set, is not self, and does not create a cycle.
 */
export function buildProfileOrgForest<T extends ProfileOrgRow>(rows: T[]): ProfileOrgNode<T>[] {
  const unique: T[] = [];
  const seenIds = new Set<string>();
  for (const p of rows) {
    if (!p?.id || seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    unique.push(p);
  }

  const uplineById = new Map<string, string | null>();
  for (const p of unique) {
    uplineById.set(p.id, p.upline_id ?? null);
  }

  const map = new Map<string, ProfileOrgNode<T>>();
  for (const p of unique) {
    map.set(p.id, { ...p, children: [] } as ProfileOrgNode<T>);
  }

  const roots: ProfileOrgNode<T>[] = [];

  for (const p of unique) {
    const node = map.get(p.id)!;
    const up = p.upline_id;
    const parentInOrg = up && up !== p.id && map.has(up);
    const cycle = parentInOrg && uplineChainReachesId(p.id, up, uplineById);

    if (parentInOrg && !cycle) {
      map.get(up)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Keep profiles on the viewer's reporting line only:
 * - all upline (walk managers up)
 * - all downline (anyone whose upline chain reaches the viewer)
 * - the viewer
 * Excludes peers (same manager, not in upline/downline chain).
 *
 * A display filter, not a scope: Settings → Hierarchy no longer uses it because its rows are
 * already query-scoped (`loadHierarchyTreeData`), and re-filtering would hide an Admin's
 * organization-wide chart.
 */
export function filterReportingLineHierarchy<T extends ProfileOrgRow>(
  rows: T[],
  viewerId: string | null | undefined,
): T[] {
  if (!viewerId) return [];

  const uplineById = new Map<string, string | null>();
  for (const r of rows) {
    const up = r.upline_id;
    uplineById.set(r.id, up && up !== r.id ? up : null);
  }

  const isInViewersUpline = (profileId: string): boolean => {
    let cur = uplineById.get(viewerId) ?? null;
    let hops = 0;
    while (cur && hops++ < 512) {
      if (cur === profileId) return true;
      cur = uplineById.get(cur) ?? null;
    }
    return false;
  };

  const isInViewersDownline = (profileId: string): boolean => {
    let cur: string | null = profileId;
    let hops = 0;
    while (cur && hops++ < 512) {
      if (cur === viewerId) return true;
      cur = uplineById.get(cur) ?? null;
    }
    return false;
  };

  return rows.filter(
    (r) =>
      r.id === viewerId || isInViewersUpline(r.id) || isInViewersDownline(r.id),
  );
}

/** `profiles.status` of a soft-deleted member. */
export const DELETED_PROFILE_STATUS = "Deleted";

export function isDeletedProfile(row: { status?: unknown } | ProfileOrgRow | null | undefined): boolean {
  return row?.status === DELETED_PROFILE_STATUS;
}

/**
 * THE DELETED-INTERMEDIATE RULE — one rule for every org chart (Settings → Hierarchy and the
 * Team Profile tree).
 *
 * A soft delete keeps `upline_id`, and the canonical resolvers walk through Deleted profiles,
 * so the people beneath a Deleted manager still report through it. Charts therefore load
 * Deleted rows, build the forest, and then:
 *  - keep a Deleted node only as a CONNECTOR — when at least one non-Deleted profile sits
 *    beneath it at any depth — so that report stays attached under its real manager instead
 *    of floating loose as a root;
 *  - drop a Deleted node with no non-Deleted descendant, together with its all-Deleted subtree;
 *  - draw kept Deleted nodes muted and never count them as members (`countForestNodes` with
 *    `isLiveProfileNode`).
 * `keepIds` stay even when Deleted and childless (the viewer's own node). Returns new nodes;
 * the input forest is not mutated.
 */
export function pruneDeletedLeaves<T extends ProfileOrgRow>(
  roots: ProfileOrgNode<T>[],
  keepIds?: ReadonlySet<string>,
): ProfileOrgNode<T>[] {
  const prune = (node: ProfileOrgNode<T>): ProfileOrgNode<T> | null => {
    const children = node.children.map(prune).filter((c): c is ProfileOrgNode<T> => c !== null);
    if (children.length === 0 && isDeletedProfile(node) && !keepIds?.has(node.id)) return null;
    return { ...node, children };
  };
  return roots.map(prune).filter((r): r is ProfileOrgNode<T> => r !== null);
}

/** Member predicate for `countForestNodes`: every node except Deleted connectors. */
export const isLiveProfileNode = (node: ProfileOrgRow): boolean => !isDeletedProfile(node);

/** Count nodes in a forest (for sanity checks); with `include`, only the nodes it accepts. */
export function countForestNodes<T extends ProfileOrgRow>(
  roots: ProfileOrgNode<T>[],
  include?: (node: ProfileOrgNode<T>) => boolean,
): number {
  let n = 0;
  const walk = (node: ProfileOrgNode<T>) => {
    if (!include || include(node)) n += 1;
    for (const c of node.children) walk(c);
  };
  for (const r of roots) walk(r);
  return n;
}
