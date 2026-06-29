import React, { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Lead, Recruit, PipelineStage } from "@/lib/types";
import type { KanbanStageData } from "@/lib/contactsFilters";
import { buildKanbanColumns, resolveDragOutcome } from "@/lib/contactsKanban";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Loader2, AlertTriangle } from "lucide-react";
import KanbanColumn from "./KanbanColumn";
import { KanbanCardBody, KANBAN_CARD_SHELL } from "./KanbanCard";
import { cn } from "@/lib/utils";

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
  /** Contacts QA Fix Pass 1 (Fix 4): Leads-only — dragging onto a convert_to_client stage opens the conversion guard instead of persisting a status. Boards without this prop (Recruits) fall back to a plain status move. */
  onConvertRequest?: (contactId: string) => void;
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
  onConvertRequest,
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

  // Contacts QA Fix Pass 1 (Fix 11): the card currently being dragged, rendered in a
  // DragOverlay so it follows the pointer across the whole board (escaping each column's
  // overflow clip) instead of the old hidden/clipped in-column transform.
  const [activeCard, setActiveCard] = useState<Lead | Recruit | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    if (!canDrag) return;
    const card = columns.flatMap((c) => c.cards).find((c) => c.id === String(event.active.id)) ?? null;
    setActiveCard(card);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveCard(null);
    if (!canDrag) return; // no update-status permission — ignore any drag
    const { active, over } = event;
    if (!over) return;
    const outcome = resolveDragOutcome({
      activeId: String(active.id),
      overId: String(over.id),
      columns,
    });
    if (outcome.kind === "none") return; // no-op: Unmapped target, unchanged, or invalid
    // Fix 4: a convert_to_client target opens ConvertLeadModal (no status persisted yet).
    // Boards without a convert handler (Recruits) fall back to a plain status move.
    if (outcome.kind === "convert" && onConvertRequest) {
      onConvertRequest(String(active.id));
      return;
    }
    await onStatusChange(String(active.id), outcome.status);
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveCard(null)}
    >
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
      {/* Fix 11: the dragged card follows the pointer in a portal, unclipped by columns. */}
      <DragOverlay>
        {activeCard ? (
          <div className={cn(KANBAN_CARD_SHELL, "w-[300px] cursor-grabbing shadow-2xl border-primary ring-2 ring-primary/30 rotate-2")}>
            <KanbanCardBody
              contact={activeCard}
              type={tab === "Leads" ? "lead" : "recruit"}
              agentProfiles={agentProfiles}
              onEdit={() => {}}
              renderLeadSourceBadge={renderLeadSourceBadge}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
