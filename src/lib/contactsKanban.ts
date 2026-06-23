/**
 * Contacts Build 4 — pure Kanban column assembly + drag-target resolution.
 *
 * Extracted from the board component so the column model (ordering, exact
 * counts, the explicit Unmapped bucket) and the drag rules (empty/truncated
 * columns are valid targets; Unmapped is a no-op target; unchanged status is a
 * no-op) are unit-testable without simulating dnd-kit pointer events.
 */
import type { Lead, Recruit, PipelineStage } from "@/lib/types";
import type { KanbanStageData } from "@/lib/contactsFilters";

/** dnd-kit droppable id prefix for a column (distinguishes column targets from card uuids). */
export const COLUMN_DROP_PREFIX = "kbcol::";
/** Sentinel column key for statuses that match no configured pipeline stage (D3). */
export const UNMAPPED_KEY = "__unmapped__";

export interface KanbanColumnModel {
  /** Stage name for a configured column, or UNMAPPED_KEY for the catch-all column. */
  key: string;
  label: string;
  color: string;
  /** Exact full filtered count for this column (not page-local). */
  total: number;
  cards: (Lead | Recruit)[];
  isUnmapped: boolean;
}

/** Deterministic stage order: sort_order, then name, then id (prod has duplicate sort_order — D5). */
export function orderPipelineStages(stages: PipelineStage[]): PipelineStage[] {
  return [...stages].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/**
 * Build the ordered column model: one column per configured stage (in
 * deterministic order, with exact full counts + bounded card slices), plus a
 * single trailing "Unmapped" column for any status that matches no configured
 * stage (including null/blank). Records never disappear.
 */
export function buildKanbanColumns(
  stages: KanbanStageData<Lead | Recruit>[],
  pipelineStages: PipelineStage[],
): KanbanColumnModel[] {
  const ordered = orderPipelineStages(pipelineStages);
  const configuredNames = new Set(ordered.map((s) => s.name));

  const byStatus = new Map<string, KanbanStageData<Lead | Recruit>>();
  for (const s of stages) if (s.status != null) byStatus.set(s.status, s);

  const cols: KanbanColumnModel[] = ordered.map((st) => {
    const d = byStatus.get(st.name);
    return {
      key: st.name,
      label: st.name,
      color: st.color,
      total: d?.total ?? 0,
      cards: d?.cards ?? [],
      isUnmapped: false,
    };
  });

  const unmapped = stages.filter((s) => s.status == null || !configuredNames.has(s.status));
  const unmappedTotal = unmapped.reduce((n, s) => n + s.total, 0);
  if (unmappedTotal > 0) {
    cols.push({
      key: UNMAPPED_KEY,
      label: "Unmapped",
      color: "#6B7280",
      total: unmappedTotal,
      cards: unmapped.flatMap((s) => s.cards),
      isUnmapped: true,
    });
  }
  return cols;
}

/**
 * Resolve a drag end into the target status to persist, or null for a no-op.
 *
 * - Dropping on a column droppable → that stage name (empty/zero-card/truncated
 *   columns are all valid targets because the whole column is the droppable).
 * - Dropping on a card → that card's column status, but only if it maps to a
 *   configured stage (dropping onto an unmapped card is a no-op).
 * - Dropping INTO the Unmapped column → no-op (no canonical target name, D4).
 * - Unchanged status, unknown active card, or unresolved target → no-op.
 *
 * Dragging OUT of Unmapped into a real stage IS allowed (the active card's
 * status differs from a real target).
 */
export function resolveDragTarget(args: {
  activeId: string;
  overId: string;
  columns: KanbanColumnModel[];
}): string | null {
  const { activeId, overId, columns } = args;
  const allCards = columns.flatMap((c) => c.cards);
  const configuredNames = new Set(columns.filter((c) => !c.isUnmapped).map((c) => c.key));

  let targetStatus: string | null = null;
  if (overId.startsWith(COLUMN_DROP_PREFIX)) {
    const key = overId.slice(COLUMN_DROP_PREFIX.length);
    if (key === UNMAPPED_KEY) return null; // D4: dropping INTO Unmapped is disabled
    if (!configuredNames.has(key)) return null; // unknown column → no-op
    targetStatus = key;
  } else {
    const overCard = allCards.find((c) => c.id === overId);
    const st = overCard?.status ?? null;
    if (st == null || !configuredNames.has(st)) return null; // over an unmapped/unknown card → no-op
    targetStatus = st;
  }

  const activeCard = allCards.find((c) => c.id === activeId);
  if (!activeCard || targetStatus == null) return null;
  if (activeCard.status === targetStatus) return null; // unchanged → no-op
  return targetStatus;
}
