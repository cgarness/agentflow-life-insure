import React, { useMemo } from "react";
import SortableOverlayList, { type SortableRow } from "./SortableOverlayList";
import type { InventoryItem, ProjectStatusOverlay } from "@/lib/project-status/types";
import type { OverlayEditTarget } from "./OverlayEditSheet";
import { matchesQuery } from "./InventorySearch";

interface BuildQueueSectionProps {
  items: InventoryItem[];
  overlayMap: Map<string, ProjectStatusOverlay>;
  search: string;
  onEdit: (target: OverlayEditTarget) => void;
  onReorder: (rows: SortableRow[]) => void;
}

const BuildQueueSection: React.FC<BuildQueueSectionProps> = ({
  items, overlayMap, search, onEdit, onReorder,
}) => {
  const rows: SortableRow[] = useMemo(() => {
    const filtered = items.filter((t) => matchesQuery(`${t.title} ${t.description ?? ""}`, search));
    return filtered
      .map((t, i) => ({
        ...t,
        id: t.itemKey,
        sort_order: overlayMap.get(t.itemKey)?.sort_order ?? i,
      }))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [items, overlayMap, search]);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        Seeded from WORK_LOG [IN PROGRESS] entries. Drag to reprioritize.
      </p>
      <SortableOverlayList
        rows={rows}
        overlayMap={overlayMap}
        onReorder={onReorder}
        onEdit={(row) => onEdit({
          itemKey: row.itemKey,
          section: "build_queue",
          title: row.title,
          inferredStatus: row.inferredStatus,
        })}
        emptyMessage="No in-progress build queue items. Add [IN PROGRESS] entries to WORK_LOG.md."
      />
    </div>
  );
};

export default BuildQueueSection;
