import React, { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Lead, Recruit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Pencil, Phone, Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface KanbanCardBodyProps {
  contact: Lead | Recruit;
  type: "lead" | "recruit";
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  onEdit: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
}

interface KanbanCardProps extends KanbanCardBodyProps {
  id: string;
  onClick: (contact: Lead | Recruit) => void;
  /** Contacts Build 5: when false the card is not draggable (no status-update permission). */
  canDrag?: boolean;
}

const getAgentInitials = (agentId: string, profiles: { id: string; firstName: string; lastName: string }[]) => {
  const p = profiles.find(p => p.id === agentId);
  if (!p) return "?";
  return `${p.firstName[0]}${p.lastName[0]}`.toUpperCase();
};

const getAgentName = (agentId: string, profiles: { id: string; firstName: string; lastName: string }[]) => {
  const p = profiles.find(p => p.id === agentId);
  if (!p) return "Unassigned";
  return `${p.firstName} ${p.lastName}`;
};

const isLead = (c: Lead | Recruit): c is Lead => "leadScore" in c;

/** Shared card-shell classes used by BOTH the sortable card and the DragOverlay clone. */
export const KANBAN_CARD_SHELL =
  "group relative bg-card rounded-xl border border-border p-4 transition-all duration-300";

/**
 * Contacts QA Fix Pass 1 (Fix 11): presentational card content with NO useSortable,
 * so it can be reused inside the DragOverlay without registering a second sortable
 * with the same id. Both the in-flow sortable card and the overlay clone render this.
 */
export const KanbanCardBody: React.FC<KanbanCardBodyProps> = ({
  contact,
  type,
  agentProfiles,
  onEdit,
  onCall,
  renderLeadSourceBadge,
}) => {
  return (
    <>
      {/* Top Section: Name and Actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {contact.firstName} {contact.lastName}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {contact.state || "No State"}
            </span>
            {isLead(contact) && (
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  contact.leadScore >= 8 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                )}
              >
                Score: {contact.leadScore}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(contact); }}
                  className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit Contact</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {onCall && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCall(contact); }}
                    className="p-1.5 rounded-lg hover:bg-success/10 text-muted-foreground hover:text-success transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Quick Call</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
          <Mail className="w-3 h-3 shrink-0" />
          <span className="truncate">{contact.email || "No email"}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Phone className="w-3 h-3 shrink-0" />
          <span>{contact.phone || "No phone"}</span>
        </div>
      </div>

      {/* Footer Section: Source and Agent */}
      <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isLead(contact) && renderLeadSourceBadge ? (
            renderLeadSourceBadge(contact.leadSource)
          ) : (
            <span className="text-[10px] text-muted-foreground truncate block italic">
              {type === "recruit" ? "Recruit Pipeline" : contact.leadSource}
            </span>
          )}
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center border border-primary/20">
                  {getAgentInitials(contact.assignedAgentId, agentProfiles)}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Assigned: {getAgentName(contact.assignedAgentId, agentProfiles)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
};

export const KanbanCard: React.FC<KanbanCardProps> = ({
  id,
  contact,
  type,
  agentProfiles,
  onEdit,
  onClick,
  onCall,
  renderLeadSourceBadge,
  canDrag = true,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !canDrag });

  // Contacts QA Fix Pass 1 (Fix 11): record the pointer-down position so a click that
  // follows a drag (pointer moved past the sensor's ~5px activation distance) does NOT
  // open the full-screen contact. Deterministic, no timeout.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // The in-flow card is a dimmed placeholder while the DragOverlay clone follows the pointer.
    opacity: isDragging ? 0.4 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    const start = pointerDownPos.current;
    pointerDownPos.current = null;
    if (start && (Math.abs(e.clientX - start.x) > 4 || Math.abs(e.clientY - start.y) > 4)) return;
    onClick(contact);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      onPointerDownCapture={(e) => { pointerDownPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleClick}
      className={cn(
        KANBAN_CARD_SHELL,
        "mb-3 hover:shadow-xl hover:border-primary/50",
        canDrag ? "cursor-grab active:cursor-grabbing touch-none select-none" : "cursor-pointer",
        isDragging && "ring-2 ring-primary/20",
      )}
    >
      <KanbanCardBody
        contact={contact}
        type={type}
        agentProfiles={agentProfiles}
        onEdit={onEdit}
        onCall={onCall}
        renderLeadSourceBadge={renderLeadSourceBadge}
      />
    </div>
  );
};
