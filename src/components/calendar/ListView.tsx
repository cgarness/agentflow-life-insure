import React, { useState } from "react";
import { Calendar as CalIcon, User, Pencil, Trash2, ChevronDown, Plus, X } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_COLORS, CalAppointmentType, CalAppointmentStatus } from "@/contexts/CalendarContext";
import { toast } from "sonner";

const ALL_TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Policy Anniversary", "Other"];
const ALL_STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}

interface Props {
  appointments: CalendarAppointment[];
  onEdit: (a: CalendarAppointment) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, s: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
  onSchedule: () => void;
}

const ListView: React.FC<Props> = ({ appointments, onEdit, onDelete, onStatusChange, onOpenContact, onSchedule }) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const thirtyOut = new Date(today); thirtyOut.setDate(thirtyOut.getDate() + 30);

  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [fromDate, setFromDate] = useState(toDateStr(today));
  const [toDate, setToDate] = useState(toDateStr(thirtyOut));

  const hasFilters = typeFilter !== "All" || statusFilter !== "All" || fromDate !== toDateStr(today) || toDate !== toDateStr(thirtyOut);

  const clearFilters = () => {
    setTypeFilter("All"); setStatusFilter("All"); setFromDate(toDateStr(today)); setToDate(toDateStr(thirtyOut));
  };

  const filtered = appointments.filter(a => {
    const d = new Date(a.date); d.setHours(0,0,0,0);
    if (typeFilter !== "All" && a.type !== typeFilter) return false;
    if (statusFilter !== "All" && a.status !== statusFilter) return false;
    if (fromDate) { const fd = new Date(fromDate + "T00:00:00"); if (d < fd) return false; }
    if (toDate) { const td = new Date(toDate + "T23:59:59"); if (d > td) return false; }
    return true;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const grouped: { dateLabel: string; items: CalendarAppointment[] }[] = [];
  const seen = new Map<string, number>();
  for (const a of filtered) {
    const d = new Date(a.date);
    const key = toDateStr(d);
    const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (seen.has(key)) {
      grouped[seen.get(key)!].items.push(a);
    } else {
      seen.set(key, grouped.length);
      grouped.push({ dateLabel: label, items: [a] });
    }
  }

  const inputCls = "h-8 px-2 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-card rounded-lg border border-border p-3">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={inputCls}>
          <option value="All">All Types</option>
          {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="All">All Statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inputCls} />
          To <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inputCls} />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors duration-150">
            <X className="w-3 h-3" /> Clear Filters
          </button>
        )}
      </div>

      {/* List */}
      {grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card rounded-lg border border-border">
          <CalIcon className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-base font-medium text-foreground">No appointments found</p>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or schedule a new appointment</p>
          <button onClick={onSchedule} className="mt-4 px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2 transition-colors duration-150" style={{ backgroundColor: "#3B82F6" }}>
            <Plus className="w-4 h-4" /> Schedule Appointment
          </button>
        </div>
      ) : (
        grouped.map(g => (
          <div key={g.dateLabel}>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-base font-semibold text-muted-foreground">{g.dateLabel}</h3>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-2">
              {g.items.map(a => <ListCard key={a.id} appointment={a} onEdit={onEdit} onDelete={onDelete} onStatusChange={onStatusChange} onOpenContact={onOpenContact} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const ListCard: React.FC<{
  appointment: CalendarAppointment;
  onEdit: (a: CalendarAppointment) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, s: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
}> = ({ appointment, onEdit, onDelete, onStatusChange, onOpenContact }) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const typeColor = APPOINTMENT_TYPE_COLORS[appointment.type];
  const statusColor = APPOINTMENT_STATUS_COLORS[appointment.status];

  return (
    <div className="bg-card rounded-lg border border-border p-4 flex items-start gap-4 hover:shadow-md transition-all duration-150" style={{ borderLeft: `4px solid ${typeColor}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono text-muted-foreground">{appointment.startTime} – {appointment.endTime}</span>
          <span className="text-base font-bold text-foreground">{appointment.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: typeColor + "33", color: typeColor }}>{appointment.type}</span>
          <div className="relative">
            <button onClick={() => setStatusOpen(!statusOpen)} className="text-[11px] px-2 py-0.5 rounded-full font-medium cursor-pointer flex items-center gap-0.5" style={{ backgroundColor: statusColor + "33", color: statusColor }}>
              {appointment.status} <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-10 py-1 min-w-[120px]">
                {ALL_STATUSES.map(s => (
                  <button key={s} onClick={() => { onStatusChange(appointment.id, s); setStatusOpen(false); toast.success(`Status updated to ${s}`); }}
                    className="block w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors duration-150">{s}</button>
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
        {appointment.agent && <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground"><User className="w-3.5 h-3.5" /> {appointment.agent}</div>}
        {appointment.notes && <p className="text-sm text-muted-foreground italic mt-1 truncate">{appointment.notes.slice(0, 60)}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(appointment)} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {confirmDel ? (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Delete?</span>
            <button onClick={() => { onDelete(appointment.id); toast.error("Appointment deleted"); }} className="text-red-500 font-medium">Yes</button>
            <button onClick={() => setConfirmDel(false)} className="text-muted-foreground">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-accent transition-colors duration-150">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ListView;
