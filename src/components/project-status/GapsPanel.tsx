import React, { useMemo } from "react";
import SortableOverlayList, { type SortableRow } from "./SortableOverlayList";
import type { InventoryItem, ProjectStatusOverlay } from "@/lib/project-status/types";
import type { OverlayEditTarget } from "./OverlayEditSheet";
import { matchesQuery } from "./InventorySearch";

interface GapsPanelProps {
  featureGaps: InventoryItem[];
  overlayMap: Map<string, ProjectStatusOverlay>;
  search: string;
  onEdit: (target: OverlayEditTarget) => void;
  onReorder: (rows: SortableRow[]) => void;
}

const GapsPanel: React.FC<GapsPanelProps> = ({
  featureGaps, overlayMap, search, onEdit, onReorder,
}) => {
  const rows: SortableRow[] = useMemo(() => {
    const filtered = featureGaps.filter((g) =>
      matchesQuery(`${g.title} ${g.description ?? ""}`, search)
    );
    const withOrder = filtered.map((g, i) => {
      const overlay = overlayMap.get(g.itemKey);
      return {
        ...g,
        id: g.itemKey,
        sort_order: overlay?.sort_order ?? i,
      };
    });
    return withOrder.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [featureGaps, overlayMap, search]);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        Reports stats and workflow actions marked coming soon. Drag to set priority.
      </p>
      <SortableOverlayList
        rows={rows}
        overlayMap={overlayMap}
        onReorder={onReorder}
        onEdit={(row) => onEdit({
          itemKey: row.itemKey,
          section: row.section,
          title: row.title,
          inferredStatus: row.inferredStatus,
        })}
        emptyMessage="No feature gaps match your search."
      />
    </div>
  );
};

export default GapsPanel;
