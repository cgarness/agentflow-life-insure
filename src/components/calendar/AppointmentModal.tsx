import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { CalendarAppointment, CalAppointmentType, CalAppointmentStatus, APPOINTMENT_TYPE_COLORS } from "@/contexts/CalendarContext";
import { toast } from "sonner";

const TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Other"];
const STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];

const TIMES: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hr = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    TIMES.push(`${hr}:${m.toString().padStart(2, "0")} ${ampm}`);
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<CalendarAppointment, "id">) => void;
  onDelete?: (id: string) => void;
  editing?: CalendarAppointment | null;
  defaultDate?: Date;
}

const AppointmentModal: React.FC<Props> = ({ open, onClose, onSave, onDelete, editing, defaultDate }) => {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalAppointmentType>("Sales Call");
  const [status, setStatus] = useState<CalAppointmentStatus>("Scheduled");
  const [contactName, setContactName] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00 AM");
  const [endTime, setEndTime] = useState("10:30 AM");
  const [agent, setAgent] = useState("Chris Garcia");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setErrors({});
    if (editing) {
      setTitle(editing.title);
      setType(editing.type);
      setStatus(editing.status);
      setContactName(editing.contactName);
      const d = new Date(editing.date);
      setDate(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`);
      setStartTime(editing.startTime);
      setEndTime(editing.endTime);
      setAgent(editing.agent);
      setNotes(editing.notes);
    } else {
      setTitle(""); setType("Sales Call"); setStatus("Scheduled"); setContactName("");
      setStartTime("10:00 AM"); setEndTime("10:30 AM"); setAgent("Chris Garcia"); setNotes("");
      if (defaultDate) {
        const d = defaultDate;
        setDate(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`);
      } else {
        const d = new Date();
        setDate(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`);
      }
    }
  }, [open, editing, defaultDate]);

  if (!open) return null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Title is required";
    if (!type) e.type = "Type is required";
    if (!date) e.date = "Date is required";
    if (!startTime) e.startTime = "Start time is required";
    if (startTime && endTime) {
      const si = TIMES.indexOf(startTime);
      const ei = TIMES.indexOf(endTime);
      if (ei <= si) e.endTime = "End time must be after start time";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const [y, m, d] = date.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    onSave({
      title: title.trim(),
      type, status, contactName: contactName.trim(),
      contactId: editing?.contactId ?? "",
      date: dateObj, startTime, endTime, agent: agent.trim(), notes: notes.trim(),
    });
    if (editing) {
      toast.success("Appointment updated");
    } else {
      toast.success("Appointment scheduled successfully");
    }
    onClose();
  };

  const handleDelete = () => {
    if (editing && onDelete) {
      onDelete(editing.id);
      toast.error("Appointment deleted");
      onClose();
    }
  };

  const inputCls = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-card border border-border rounded-lg shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{editing ? "Edit Appointment" : "Schedule Appointment"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors duration-150"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Title *</label>
            <input value={title} onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(p => { const n = {...p}; delete n.title; return n; }); }}
              placeholder="Appointment title" className={`${inputCls} ${errors.title ? "border-red-500" : ""}`} />
            {errors.title && <p className="text-xs text-red-500 mt-0.5">{errors.title}</p>}
          </div>
          {/* Type */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Appointment Type *</label>
            <select value={type} onChange={e => setType(e.target.value as CalAppointmentType)} className={`${inputCls} ${errors.type ? "border-red-500" : ""}`}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.type && <p className="text-xs text-red-500 mt-0.5">{errors.type}</p>}
          </div>
          {/* Status */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as CalAppointmentStatus)} className={inputCls}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Contact */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Contact Name</label>
            <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Search or enter contact name" className={inputCls} />
          </div>
          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Date *</label>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); if (errors.date) setErrors(p => { const n = {...p}; delete n.date; return n; }); }}
              className={`${inputCls} ${errors.date ? "border-red-500" : ""}`} />
            {errors.date && <p className="text-xs text-red-500 mt-0.5">{errors.date}</p>}
          </div>
          {/* Time Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">Start Time *</label>
              <select value={startTime} onChange={e => setStartTime(e.target.value)} className={`${inputCls} ${errors.startTime ? "border-red-500" : ""}`}>
                {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {errors.startTime && <p className="text-xs text-red-500 mt-0.5">{errors.startTime}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">End Time *</label>
              <select value={endTime} onChange={e => setEndTime(e.target.value)} className={`${inputCls} ${errors.endTime ? "border-red-500" : ""}`}>
                {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {errors.endTime && <p className="text-xs text-red-500 mt-0.5">{errors.endTime}</p>}
            </div>
          </div>
          {/* Agent */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Agent</label>
            <input value={agent} onChange={e => setAgent(e.target.value)} className={inputCls} />
          </div>
          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} min-h-[72px] py-2`} />
          </div>
        </div>
        <div className="flex items-center justify-between p-5 border-t border-border">
          <div>
            {editing && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Delete this appointment?</span>
                  <button onClick={handleDelete} className="text-sm font-medium text-red-500 hover:text-red-400">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-sm font-medium text-muted-foreground hover:text-foreground">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="px-3 py-1.5 rounded-md text-sm font-medium text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors duration-150">Delete</button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground border border-border hover:bg-accent transition-colors duration-150">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm font-medium text-white transition-colors duration-150" style={{ backgroundColor: "#3B82F6" }}>
              Save Appointment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentModal;
