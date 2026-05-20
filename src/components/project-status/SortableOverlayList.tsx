import React, { useMemo, useState } from "react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, resolveDisplayStatus } from "./statusBadge";
import type { InventoryItem, ProjectStatusOverlay } from "@/lib/project-status/types";

export interface SortableRow extends InventoryItem {
  id: string;
  sort_order?: number;
}

function SortableRowItem({
  row,
  overlay,
  onEdit,
}: {
  row: SortableRow;
  overlay?: ProjectStatusOverlay;
  onEdit: (row: SortableRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const status = resolveDisplayStatus(row.inferredStatus, overlay?.status);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2.5",
        isDragging && "opacity-60 shadow-lg z-10"
      )}
    >
      <button
        type="button"
        className="mt-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="flex-1 text-left min-w-0"
        onClick={() => onEdit(row)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm text-foreground">{row.title}</span>
          {status && <StatusBadge status={status} />}
        </div>
        {row.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.description}</p>
        )}
        {overlay?.note && (
          <p className="text-xs text-amber-500/90 mt-1 flex items-center gap-1">
            <StickyNote className="w-3 h-3 shrink-0" />
            {overlay.note}
          </p>
        )}
      </button>
    </div>
  );
}

interface SortableOverlayListProps {
  rows: SortableRow[];
  overlayMap: Map<string, ProjectStatusOverlay>;
  onReorder: (ordered: SortableRow[]) => void;
  onEdit: (row: SortableRow) => void;
  emptyMessage?: string;
}

const SortableOverlayList: React.FC<SortableOverlayListProps> = ({
  rows, overlayMap, onReorder, onEdit, emptyMessage = "Nothing here yet.",
}) => {
  const [localRows, setLocalRows] = useState(rows);
  const ids = useMemo(() => localRows.map((r) => r.id), [localRows]);

  React.useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localRows.findIndex((r) => r.id === active.id);
    const newIndex = localRows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = [...localRows];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    setLocalRows(next);
    onReorder(next);
  };

  if (localRows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">{emptyMessage}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {localRows.map((row) => (
            <SortableRowItem
              key={row.id}
              row={row}
              overlay={overlayMap.get(row.itemKey)}
              onEdit={onEdit}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default SortableOverlayList;
