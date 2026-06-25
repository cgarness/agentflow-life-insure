import React, { useMemo } from "react";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Lead, Recruit, PipelineStage } from "@/lib/types";
import type { KanbanStageData } from "@/lib/contactsFilters";
import { buildKanbanColumns, resolveDragTarget } from "@/lib/contactsKanban";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Loader2, AlertTriangle } from "lucide-react";
import KanbanColumn from "./KanbanColumn";

interface ContactKanbanBoardProps {
  tab: "Leads" | "Recruits";
  /** Full filtered per-status data (exact counts + bounded card slices) from the Kanban RPC. */
  stages: KanbanStageData<Lead | Recruit>[];
  /** Configured pipeline stages (drive column order + colors). */
  pipelineStages: PipelineStage[];
  perColumnLimit: number;
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  loading?: boolean;
  error?: string | null;
  /** Contacts Build 5: when false, drag-to-update-status is disabled (no permission). */
  canDrag?: boolean;
  onStatusChange: (contactId: string, newStatus: string) => Promise<void>;
  onEdit: (contact: Lead | Recruit) => void;
  onClick: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  onAddContact?: (status: string) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
}

export const ContactKanbanBoard: React.FC<ContactKanbanBoardProps> = ({
  tab,
  stages,
  pipelineStages,
  agentProfiles,
  loading,
  error,
  canDrag = true,
  onStatusChange,
  onEdit,
  onClick,
  onCall,
  onAddContact,
  renderLeadSourceBadge,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Ordered configured columns + a trailing Unmapped column (pure, testable).
  const columns = useMemo(() => buildKanbanColumns(stages, pipelineStages), [stages, pipelineStages]);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canDrag) return; // no update-status permission — ignore any drag
    const { active, over } = event;
    if (!over) return;
    const target = resolveDragTarget({
      activeId: String(active.id),
      overId: String(over.id),
      columns,
    });
    if (target == null) return; // no-op: Unmapped target, unchanged, or invalid
    await onStatusChange(String(active.id), target);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-foreground font-medium">Couldn't load the board</p>
        <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
      </div>
    );
  }

  if (loading && columns.every((c) => c.total === 0)) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <ScrollArea className="w-full whitespace-nowrap pb-4">
        <div className="flex gap-4 p-1 min-h-[calc(100vh-280px)]">
          {columns.map((col) => (
            <KanbanColumn
              key={col.key}
              column={col}
              type={tab === "Leads" ? "lead" : "recruit"}
              agentProfiles={agentProfiles}
              onEdit={onEdit}
              onClick={onClick}
              onCall={onCall}
              onAddContact={onAddContact}
              renderLeadSourceBadge={renderLeadSourceBadge}
              canDrag={canDrag}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </DndContext>
  );
};
