import type { SortKey } from "./model";

/**
 * Configurable desktop columns. The expand chevron, Campaign and Actions are fixed and are not
 * part of this registry, so they can never be hidden or moved.
 */
export const COLUMN_IDS = ["status", "progress", "agents", "converted", "contacted", "created", "tags", "last_dialed"] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  sortKey: SortKey | null;
  align: "left" | "right";
  /** Tailwind width/min-width classes for the header cell. */
  widthClass: string;
}

export const COLUMN_DEFS: Record<ColumnId, ColumnDef> = {
  status: { id: "status", label: "Status", defaultVisible: true, sortKey: "status", align: "left", widthClass: "w-32" },
  progress: { id: "progress", label: "Lead progress", defaultVisible: true, sortKey: "progress", align: "left", widthClass: "w-52 min-w-[13rem]" },
  agents: { id: "agents", label: "Agents", defaultVisible: true, sortKey: null, align: "left", widthClass: "w-36" },
  converted: { id: "converted", label: "Converted", defaultVisible: true, sortKey: "converted", align: "right", widthClass: "w-28" },
  contacted: { id: "contacted", label: "Contacted", defaultVisible: false, sortKey: "contacted", align: "right", widthClass: "w-28" },
  created: { id: "created", label: "Created", defaultVisible: false, sortKey: "created", align: "left", widthClass: "w-32" },
  tags: { id: "tags", label: "Tags", defaultVisible: false, sortKey: null, align: "left", widthClass: "w-44" },
  last_dialed: { id: "last_dialed", label: "Last dialed", defaultVisible: false, sortKey: "last_dialed", align: "left", widthClass: "w-32" },
};

export interface ColumnLayout {
  /** Every configurable column, in display order. */
  order: ColumnId[];
  /** Columns the viewer has hidden. */
  hidden: ColumnId[];
}

export const DEFAULT_COLUMN_LAYOUT: ColumnLayout = Object.freeze({
  order: [...COLUMN_IDS],
  hidden: COLUMN_IDS.filter((id) => !COLUMN_DEFS[id].defaultVisible),
}) as ColumnLayout;

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && (COLUMN_IDS as readonly string[]).includes(value);
}

/**
 * Normalizes a stored layout: unknown and duplicate ids are dropped, columns the stored
 * layout predates are inserted after their default predecessor with their default
 * visibility. Stored values are never written back by this function.
 */
export function normalizeColumnLayout(input: { order?: unknown; hidden?: unknown } | null | undefined): ColumnLayout {
  if (!input) return { order: [...DEFAULT_COLUMN_LAYOUT.order], hidden: [...DEFAULT_COLUMN_LAYOUT.hidden] };
  const rawOrder = Array.isArray(input.order) ? input.order : [];
  const rawHidden = Array.isArray(input.hidden) ? input.hidden : [];
  const order: ColumnId[] = [];
  for (const id of rawOrder) if (isColumnId(id) && !order.includes(id)) order.push(id);
  const known = new Set(order);
  const hidden = new Set<ColumnId>();
  for (const id of rawHidden) if (isColumnId(id) && known.has(id)) hidden.add(id);
  COLUMN_IDS.forEach((id, index) => {
    if (known.has(id)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const pos = order.indexOf(COLUMN_IDS[i]);
      if (pos >= 0) { at = pos + 1; break; }
    }
    order.splice(at, 0, id);
    if (!COLUMN_DEFS[id].defaultVisible) hidden.add(id);
  });
  return { order, hidden: order.filter((id) => hidden.has(id)) };
}

export function visibleColumns(layout: ColumnLayout): ColumnId[] {
  const hidden = new Set(layout.hidden);
  return layout.order.filter((id) => !hidden.has(id));
}

export function sameColumnLayout(a: ColumnLayout, b: ColumnLayout): boolean {
  return a.order.join(",") === b.order.join(",") && [...a.hidden].sort().join(",") === [...b.hidden].sort().join(",");
}
