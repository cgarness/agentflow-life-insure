import type { ModuleStatus, ProjectStatusOverlay } from "./types";

export interface CodeRefs {
  files?: string[];
  hooks?: string[];
  functions?: string[];
  tables?: string[];
  rpcs?: string[];
  edgeFunctions?: string[];
}

export interface UiInventoryNode {
  /** Stable path segment, e.g. dashboard.widgets.callbacks */
  id: string;
  label: string;
  description?: string;
  inferredStatus?: ModuleStatus | string;
  code?: CodeRefs;
  children?: UiInventoryNode[];
}

export const UI_OVERLAY_SECTION = "ui_surface";

export function uiItemKey(nodeId: string): string {
  return `ui:${nodeId}`;
}

export function flattenUiTree(
  nodes: UiInventoryNode[],
  ancestors: string[] = []
): FlatUiNode[] {
  const out: FlatUiNode[] = [];
  for (const node of nodes) {
    const path = [...ancestors, node.id];
    const fullId = path.join(".");
    out.push({
      node,
      fullId,
      itemKey: uiItemKey(fullId),
      depth: ancestors.length,
      breadcrumb: path,
    });
    if (node.children?.length) {
      out.push(...flattenUiTree(node.children, path));
    }
  }
  return out;
}

export interface FlatUiNode {
  node: UiInventoryNode;
  fullId: string;
  itemKey: string;
  depth: number;
  breadcrumb: string[];
}

export function filterFlatNodes(flat: FlatUiNode[], query: string): FlatUiNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return flat;

  const matchedIds = new Set<string>();
  for (const row of flat) {
    const hay = [
      row.node.label,
      row.node.description ?? "",
      row.fullId,
      ...(row.node.code?.files ?? []),
      ...(row.node.code?.hooks ?? []),
      ...(row.node.code?.functions ?? []),
      ...(row.node.code?.tables ?? []),
      ...(row.node.code?.rpcs ?? []),
    ]
      .join(" ")
      .toLowerCase();
    if (hay.includes(q)) {
      matchedIds.add(row.fullId);
      row.breadcrumb.forEach((_, i, arr) => {
        matchedIds.add(arr.slice(0, i + 1).join("."));
      });
    }
  }

  return flat.filter((row) => matchedIds.has(row.fullId));
}

export function groupFlatByTopTab(flat: FlatUiNode[]): Map<string, FlatUiNode[]> {
  const map = new Map<string, FlatUiNode[]>();
  for (const row of flat) {
    const tab = row.breadcrumb[0] ?? "other";
    const list = map.get(tab) ?? [];
    list.push(row);
    map.set(tab, list);
  }
  return map;
}

export function resolveNodeStatus(
  node: UiInventoryNode,
  overlay?: ProjectStatusOverlay
): string | undefined {
  return overlay?.status?.trim() || node.inferredStatus;
}

export type StatusFilterValue =
  | "all"
  | "unset"
  | "LIVE"
  | "NEEDS_WORK"
  | "PLACEHOLDER"
  | "BROKEN"
  | "NOT_STARTED";

function rowMatchesSearch(row: FlatUiNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.node.label,
    row.node.description ?? "",
    row.fullId,
    ...(row.node.code?.files ?? []),
    ...(row.node.code?.hooks ?? []),
    ...(row.node.code?.functions ?? []),
    ...(row.node.code?.tables ?? []),
    ...(row.node.code?.rpcs ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function rowMatchesStatus(
  row: FlatUiNode,
  statusFilter: StatusFilterValue,
  overlayMap: Map<string, ProjectStatusOverlay>
): boolean {
  if (statusFilter === "all") return true;
  const status = resolveNodeStatus(row.node, overlayMap.get(row.itemKey));
  if (statusFilter === "unset") return !status?.trim();
  return status === statusFilter;
}

/** Visible node fullIds; null = no filter (show all). Empty set = no matches. */
export function buildVisibleIdSet(
  tab: UiInventoryNode,
  overlayMap: Map<string, ProjectStatusOverlay>,
  search: string,
  statusFilter: StatusFilterValue
): Set<string> | null {
  const hasSearch = Boolean(search.trim());
  const hasStatus = statusFilter !== "all";
  if (!hasSearch && !hasStatus) return null;

  const flat = flattenUiTree([tab]);
  const matchedIds = new Set<string>();

  for (const row of flat) {
    if (!rowMatchesSearch(row, search) || !rowMatchesStatus(row, statusFilter, overlayMap)) {
      continue;
    }
    matchedIds.add(row.fullId);
    row.breadcrumb.forEach((_, i, arr) => {
      matchedIds.add(arr.slice(0, i + 1).join("."));
    });
  }

  return matchedIds;
}

export function tabMatchesFilters(
  tab: UiInventoryNode,
  overlayMap: Map<string, ProjectStatusOverlay>,
  search: string,
  statusFilter: StatusFilterValue
): boolean {
  const visible = buildVisibleIdSet(tab, overlayMap, search, statusFilter);
  if (visible === null) return true;
  return visible.size > 0;
}
