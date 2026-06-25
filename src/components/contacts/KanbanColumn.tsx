import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Lead, Recruit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { COLUMN_DROP_PREFIX, type KanbanColumnModel } from "@/lib/contactsKanban";
import { KanbanCard } from "./KanbanCard";
import { Plus } from "lucide-react";

interface KanbanColumnProps {
  column: KanbanColumnModel;
  type: "lead" | "recruit";
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  onEdit: (contact: Lead | Recruit) => void;
  onClick: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  onAddContact?: (status: string) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
  /** Contacts Build 5: when false, drag-to-update-status is disabled for this board. */
  canDrag?: boolean;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  type,
  agentProfiles,
  onEdit,
  onClick,
  onCall,
  onAddContact,
  renderLeadSourceBadge,
  canDrag = true,
}) => {
  // The whole column is a droppable target so empty / zero-card / truncated
  // columns still accept a drop. Unmapped is disabled (no canonical target).
  // Build 5: when the user lacks update-status permission, no column is droppable.
  const { setNodeRef, isOver } = useDroppable({
    id: COLUMN_DROP_PREFIX + column.key,
    disabled: column.isUnmapped || !canDrag,
  });

  const truncated = column.cards.length < column.total;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col min-w-[280px] max-w-[320px] h-full rounded-2xl p-4 border",
        column.isUnmapped ? "bg-muted/40 border-dashed border-border" : "bg-accent/30 border-border/50",
        isOver && !column.isUnmapped && "ring-2 ring-primary/40 bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shadow-sm shrink-0" style={{ backgroundColor: column.color }} />
          <h3 className="text-sm font-semibold text-foreground truncate">{column.label}</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-background/50 text-muted-foreground font-bold border border-border/30 shrink-0">
            {column.total}
          </span>
        </div>
        {!column.isUnmapped && (
          <button
            onClick={() => onAddContact?.(column.key)}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Truncation note — exact count is always the header badge; the slice is bounded. */}
      {truncated && (
        <p className="text-[10px] text-muted-foreground/70 italic mb-2 px-1">
          Showing {column.cards.length} of {column.total}
        </p>
      )}
      {column.isUnmapped && (
        <p className="text-[10px] text-muted-foreground/70 italic mb-2 px-1">
          Status not in your pipeline configuration
        </p>
      )}

      <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
        <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((contact) => (
            <KanbanCard
              key={contact.id}
              id={contact.id}
              contact={contact}
              type={type}
              agentProfiles={agentProfiles}
              onEdit={onEdit}
              onClick={onClick}
              onCall={onCall}
              renderLeadSourceBadge={renderLeadSourceBadge}
              canDrag={canDrag}
            />
          ))}
        </SortableContext>

        {column.cards.length === 0 && (
          <div className="h-24 flex items-center justify-center border-2 border-dashed border-border/50 rounded-xl bg-accent/20">
            <p className="text-xs text-muted-foreground/60 italic font-medium">No contacts</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default KanbanColumn;
