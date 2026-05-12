import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Lead, Recruit, UserProfile } from "@/lib/types";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { Pencil, Phone, Mail, MoreHorizontal, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface KanbanCardProps {
  id: string;
  contact: Lead | Recruit;
  type: "lead" | "recruit";
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  onEdit: (contact: Lead | Recruit) => void;
  onClick: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
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

export const KanbanCard: React.FC<KanbanCardProps> = ({
  id,
  contact,
  type,
  agentProfiles,
  onEdit,
  onClick,
  onCall,
  renderLeadSourceBadge,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const isLead = (c: Lead | Recruit): c is Lead => "leadScore" in c;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative bg-card rounded-xl border border-border p-4 mb-3 cursor-grab active:cursor-grabbing hover:shadow-xl hover:border-primary/50 transition-all duration-300",
        isDragging && "shadow-2xl border-primary ring-2 ring-primary/20"
      )}
      onClick={() => onClick(contact)}
    >
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

      {/* Drag Handle (Visible on hover) */}
      <div 
        {...attributes} 
        {...listeners} 
        className="absolute -left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-primary"
      >
        <GripVertical className="w-4 h-4" />
      </div>
    </div>
  );
};
