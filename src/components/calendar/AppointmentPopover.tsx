import React, { useEffect, useRef, useState } from "react";
import { X, Pencil, User } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_COLORS, CalAppointmentStatus } from "@/contexts/CalendarContext";
import { toast } from "sonner";

const STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "No Show", "Cancelled"];

interface Props {
  appointment: CalendarAppointment;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onEdit: (a: CalendarAppointment) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
}

const AppointmentPopover: React.FC<Props> = ({ appointment, anchorRect, onClose, onEdit, onDelete, onStatusChange, onOpenContact }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const typeColor = APPOINTMENT_TYPE_COLORS[appointment.type];
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status];
  const dateStr = new Date(appointment.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  // Position near anchor
  const style: React.CSSProperties = { position: "fixed", zIndex: 200, width: 280 };
  if (anchorRect) {
    style.top = Math.min(anchorRect.bottom + 4, window.innerHeight - 350);
    style.left = Math.min(anchorRect.left, window.innerWidth - 300);
  } else {
    style.top = "50%"; style.left = "50%"; style.transform = "translate(-50%,-50%)";
  }

  return (
    <div ref={ref} style={style} className="bg-card border border-border rounded-lg shadow-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-foreground pr-4">{appointment.title}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: typeColor + "33", color: typeColor }}>{appointment.type}</span>
        <div className="relative">
          <button onClick={() => setStatusOpen(!statusOpen)} className="text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer" style={{ backgroundColor: statusColor + "33", color: statusColor }}>
            {appointment.status} ▾
          </button>
          {statusOpen && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 py-1 min-w-[120px]">
              {STATUSES.map(s => (
                <button key={s} onClick={() => { onStatusChange(appointment.id, s); setStatusOpen(false); toast.success(`Status updated to ${s}`); }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors duration-150">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{dateStr}</div>
      <div className="text-xs text-muted-foreground">{appointment.startTime} – {appointment.endTime}</div>
      {appointment.contactName && (
        <div className="flex items-center gap-1.5 text-xs">
          <User className="w-3 h-3 text-muted-foreground" />
          {appointment.contactId ? (
            <button onClick={() => onOpenContact?.(appointment.contactId)} className="hover:underline transition-colors duration-150" style={{ color: "#14B8A6" }}>{appointment.contactName}</button>
          ) : (
            <span className="text-foreground">{appointment.contactName}</span>
          )}
        </div>
      )}
      {appointment.agent && <div className="text-xs text-muted-foreground">Agent: {appointment.agent}</div>}
      {appointment.notes && <div className="text-xs text-muted-foreground italic">{appointment.notes}</div>}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <button onClick={() => onEdit(appointment)} className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors duration-150" style={{ backgroundColor: "#3B82F6" }}>
          <Pencil className="w-3 h-3" /> Edit
        </button>
        {confirmDel ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Delete?</span>
            <button onClick={() => { onDelete(appointment.id); toast.error("Appointment deleted"); onClose(); }} className="text-red-500 font-medium">Yes</button>
            <button onClick={() => setConfirmDel(false)} className="text-muted-foreground font-medium">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="px-3 py-1.5 rounded-md text-xs font-medium text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors duration-150">Delete</button>
        )}
      </div>
    </div>
  );
};

export default AppointmentPopover;
