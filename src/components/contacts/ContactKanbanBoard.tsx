import React, { useMemo } from "react";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Lead, Recruit } from "@/lib/types";
import { KanbanCard } from "./KanbanCard";
import { getStatusColorStyle } from "@/lib/utils";
import { Plus, MoreHorizontal } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface KanbanColumnProps {
  status: string;
  color: string;
  contacts: (Lead | Recruit)[];
  type: "lead" | "recruit";
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  onEdit: (contact: Lead | Recruit) => void;
  onClick: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  onAddContact?: (status: string) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  status,
  color,
  contacts,
  type,
  agentProfiles,
  onEdit,
  onClick,
  onCall,
  onAddContact,
  renderLeadSourceBadge,
}) => {
  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] h-full bg-accent/30 rounded-2xl p-4 border border-border/50">
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <div 
            className="w-2.5 h-2.5 rounded-full shadow-sm" 
            style={{ backgroundColor: color }}
          />
          <h3 className="text-sm font-semibold text-foreground">{status}</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-background/50 text-muted-foreground font-bold border border-border/30">
            {contacts.length}
          </span>
        </div>
        <button 
          onClick={() => onAddContact?.(status)}
          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
        <SortableContext
          items={contacts.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {contacts.map(contact => (
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
            />
          ))}
        </SortableContext>
        
        {contacts.length === 0 && (
          <div className="h-24 flex items-center justify-center border-2 border-dashed border-border/50 rounded-xl bg-accent/20">
            <p className="text-xs text-muted-foreground/60 italic font-medium">No contacts</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface ContactKanbanBoardProps {
  tab: "Leads" | "Recruits";
  contacts: (Lead | Recruit)[];
  statusColors: Record<string, string>;
  agentProfiles: { id: string; firstName: string; lastName: string }[];
  onStatusChange: (contactId: string, newStatus: string) => Promise<void>;
  onEdit: (contact: Lead | Recruit) => void;
  onClick: (contact: Lead | Recruit) => void;
  onCall?: (contact: Lead | Recruit) => void;
  onAddContact?: (status: string) => void;
  renderLeadSourceBadge?: (source: string) => React.ReactNode;
}

export const ContactKanbanBoard: React.FC<ContactKanbanBoardProps> = ({
  tab,
  contacts,
  statusColors,
  agentProfiles,
  onStatusChange,
  onEdit,
  onClick,
  onCall,
  onAddContact,
  renderLeadSourceBadge,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const contactId = active.id as string;
    const overId = over.id as string;

    // Determine if we dropped onto a column or another card
    let newStatus = overId;
    if (!statusColors[overId]) {
      // Dropped onto a card, find its status
      const overContact = contacts.find(c => c.id === overId);
      if (overContact) {
        newStatus = overContact.status;
      }
    }

    const contact = contacts.find(c => c.id === contactId);
    if (contact && contact.status !== newStatus) {
      await onStatusChange(contactId, newStatus);
    }
  };

  const columns = Object.keys(statusColors).map(status => ({
    status,
    color: statusColors[status],
    contacts: contacts.filter(c => c.status === status),
  }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <ScrollArea className="w-full whitespace-nowrap pb-4">
        <div className="flex gap-4 p-1 min-h-[calc(100vh-280px)]">
          {columns.map(col => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              color={col.color}
              contacts={col.contacts}
              type={tab === "Leads" ? "lead" : "recruit"}
              agentProfiles={agentProfiles}
              onEdit={onEdit}
              onClick={onClick}
              onCall={onCall}
              onAddContact={onAddContact}
              renderLeadSourceBadge={renderLeadSourceBadge}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </DndContext>
  );
};
