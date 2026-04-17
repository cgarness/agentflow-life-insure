/**
 * Builds a forest of profile nodes from flat rows (upline_id edges).
 * Breaks self-edges and cycles so every row appears exactly once (display-safe).
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

/** Count nodes in a forest (for sanity checks). */
export function countForestNodes<T extends ProfileOrgRow>(roots: ProfileOrgNode<T>[]): number {
  let n = 0;
  const walk = (node: ProfileOrgNode<T>) => {
    n += 1;
    for (const c of node.children) walk(c);
  };
  for (const r of roots) walk(r);
  return n;
}
