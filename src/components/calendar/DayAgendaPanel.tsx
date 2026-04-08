import React, { useState } from "react";
import { Plus, Pencil, Calendar as CalIcon, User, ChevronDown, Phone, MessageSquare, Mail } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_COLORS, CalAppointmentStatus } from "@/contexts/CalendarContext";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

const STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "No Show", "Cancelled"];

interface Props {
  selectedDate: Date;
  appointments: CalendarAppointment[];
  onAdd: () => void;
  onEdit: (a: CalendarAppointment) => void;
  onStatusChange: (id: string, status: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
}

const DayAgendaPanel: React.FC<Props> = ({ selectedDate, appointments, onAdd, onEdit, onStatusChange, onOpenContact }) => {
  const isToday = (() => {
    const n = new Date();
    return selectedDate.getFullYear() === n.getFullYear() && selectedDate.getMonth() === n.getMonth() && selectedDate.getDate() === n.getDate();
  })();

  const dateLabel = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="w-[340px] shrink-0 bg-card border-l border-border flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{dateLabel}</h3>
            {isToday && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: "#3B82F6" }}>Today</span>}
          </div>
          <button onClick={onAdd} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {appointments.length > 0 ? `${appointments.length} appointment${appointments.length !== 1 ? "s" : ""}` : "No appointments"}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <CalIcon className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No appointments</p>
            <p className="text-xs text-muted-foreground mt-1">Click + Add to schedule one</p>
          </div>
        ) : (
          appointments.map(a => <AgendaCard key={a.id} appointment={a} onEdit={onEdit} onStatusChange={onStatusChange} onOpenContact={onOpenContact} />)
        )}
      </div>
    </div>
  );
};

const AgendaCard: React.FC<{
  appointment: CalendarAppointment;
  onEdit: (a: CalendarAppointment) => void;
  onStatusChange: (id: string, status: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
}> = ({ appointment, onEdit, onStatusChange, onOpenContact }) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const typeColor = APPOINTMENT_TYPE_COLORS[appointment.type];
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status];
  const contactFirstName = appointment.contactName?.split(" ")[0] || "Contact";

  return (
    <TooltipProvider>
      <div className="relative bg-accent/50 rounded-lg p-3 group" style={{ borderLeft: `3px solid ${typeColor}` }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div className="text-sm text-muted-foreground">{appointment.startTime} – {appointment.endTime}</div>
        <div className="text-base font-bold text-foreground mt-0.5">{appointment.title}</div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: typeColor + "33", color: typeColor }}>{appointment.type}</span>
          <div className="relative">
            <button onClick={() => setStatusOpen(!statusOpen)} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-pointer flex items-center gap-0.5" style={{ backgroundColor: statusColor + "33", color: statusColor }}>
              {appointment.status} <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 py-1 min-w-[110px]">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => { onStatusChange(appointment.id, s); setStatusOpen(false); toast.success(`Status updated to ${s}`); }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors duration-150">{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        {appointment.contactName && (
          <div className="flex items-center gap-1 mt-1.5 text-sm">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            {appointment.contactId ? (
              <button onClick={() => onOpenContact?.(appointment.contactId)} className="hover:underline transition-colors duration-150" style={{ color: "#14B8A6" }}>{appointment.contactName}</button>
            ) : (
              <span className="text-foreground">{appointment.contactName}</span>
            )}
          </div>
        )}
        {hovered && (
          <button onClick={() => onEdit(appointment)} className="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150">
            <Pencil className="w-3 h-3" />
          </button>
        )}

        {/* Action buttons on hover */}
        <div className={`flex items-center gap-1.5 mt-2 transition-all duration-150 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled={!appointment.contactId}
                onClick={() => { toast.success(`Opening dialer for ${appointment.contactName}`); window.dispatchEvent(new CustomEvent("openDialer")); }}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-150 ${!appointment.contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                style={{ backgroundColor: "#22C55E1A", color: "#22C55E", border: "1px solid #22C55E4D" }}>
                <Phone className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Call {contactFirstName}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled={!appointment.contactId}
                onClick={() => toast.success(`Appointment confirmation text sent to ${appointment.contactName}`)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-150 ${!appointment.contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                style={{ backgroundColor: "#3B82F61A", color: "#3B82F6", border: "1px solid #3B82F64D" }}>
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Send confirmation text</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled={!appointment.contactId}
                onClick={() => toast.success(`Appointment confirmation email sent to ${appointment.contactName}`)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-150 ${!appointment.contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                style={{ backgroundColor: "#A855F71A", color: "#A855F7", border: "1px solid #A855F74D" }}>
                <Mail className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Send confirmation email</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default DayAgendaPanel;
