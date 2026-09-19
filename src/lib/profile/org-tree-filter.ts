/**
 * org-tree-filter — the filter predicate and default expansion depth for the organization tree.
 *
 * Kept out of the component file so that file exports components only (the react-refresh rule), and
 * so the predicate can be unit-tested without mounting a tree.
 */

import { displayNameFor, type OrgTreeNode } from "@/lib/profile/profile-org-view";

/** Levels expanded when the dialog opens: the root and its direct reports. Deeper is opt-in. */
export const DEFAULT_EXPANDED_DEPTH = 2;

function matches(node: OrgTreeNode, filter: string): boolean {
  if (filter === "") return true;
  const needle = filter.toLowerCase();
  return (
    displayNameFor(node).toLowerCase().includes(needle) || node.role.toLowerCase().includes(needle)
  );
}

/**
 * True when this node OR anything beneath it matches.
 *
 * Without the recursive half, a match several levels down would be unreachable: its ancestors would
 * not match the filter, so the branch containing it would be hidden entirely.
 */
export function subtreeMatches(node: OrgTreeNode, filter: string): boolean {
  if (filter === "") return true;
  return matches(node, filter) || node.children.some((c) => subtreeMatches(c, filter));
}
