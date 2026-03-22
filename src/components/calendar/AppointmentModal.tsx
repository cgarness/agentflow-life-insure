import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X, Phone, MessageSquare, Mail, Plus, Clock } from "lucide-react";
import { CalendarAppointment, CalAppointmentType, CalAppointmentStatus, APPOINTMENT_TYPE_COLORS } from "@/contexts/CalendarContext";
import { mockUsers } from "@/lib/mock-data";
import { toast as toastSonner } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import ContactMiniCard from "./ContactMiniCard";


const TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Other"];
const STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];

const TYPE_DURATIONS: Record<string, number> = {
  "Sales Call": 30,
  "Follow Up": 20,
  "Recruit Interview": 45,
  "Policy Review": 60,
  "Policy Anniversary": 60,
  "Other": 30,
};

const timeToMinutes = (t: string): number => {
  const match = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const p = match[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return h * 60 + m;
};

const minutesToTime = (min: number): string => {
  const m = min % 1440; // wrap around day
  let h = Math.floor(m / 60);
  const minutes = m % 60;
  const p = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${minutes.toString().padStart(2, "0")} ${p}`;
};

const TimeSelect: React.FC<{
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  error?: boolean;
}> = ({ value, onChange, onBlur, placeholder, className, error }) => {
  const [open, setOpen] = React.useState(false);
  
  const parseValue = (v: string) => {
    const match = v.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return { h: "10", m: "00", p: "AM" };
    return { 
      h: match[1], 
      m: match[2].padStart(2, "0"), 
      p: match[3].toUpperCase() 
    };
  };

  const { h: currentH, m: currentM, p: currentP } = parseValue(value || "10:00 AM");

  const updateValue = (newH?: string, newM?: string, newP?: string) => {
    const h = newH || currentH;
    const m = newM || currentM;
    const p = newP || currentP;
    onChange(`${h}:${m} ${p}`);
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const periods = ["AM", "PM"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <Input 
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            onBlur={onBlur}
            placeholder={placeholder}
            className={`${className} pr-10 ${error ? "border-red-500 focus-visible:ring-red-500" : ""}`}
            onFocus={() => setOpen(true)}
          />
        </PopoverTrigger>
        <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      <PopoverContent className="w-[220px] p-0 z-[200]" align="start">
        <div className="flex h-72 divide-x divide-border overflow-hidden">
          {/* Hours */}
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10">Hr</div>
              {hours.map(h => (
                <button
                  key={h}
                  type="button"
                  className={`w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors ${h === currentH ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"}`}
                  onClick={() => updateValue(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          </ScrollArea>
          {/* Minutes */}
          <ScrollArea className="flex-1 border-x border-border">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10">Min</div>
              {minutes.map(m => (
                <button
                  key={m}
                  type="button"
                  className={`w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors ${m === currentM ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"}`}
                  onClick={() => updateValue(undefined, m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </ScrollArea>
          {/* AM/PM */}
          <ScrollArea className="w-[60px]">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10"></div>
              {periods.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors ${p === currentP ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"}`}
                  onClick={() => updateValue(undefined, undefined, p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const agents = mockUsers.filter(u => u.status === "Active");

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<CalendarAppointment, "id">) => void;
  onDelete?: (id: string) => void;
  editing?: CalendarAppointment | null;
  defaultDate?: Date;
  defaultTime?: string;
  /** Pre-fill contact name (locks the contact field) */
  prefillContactName?: string;
  /** Pre-fill contact id */
  prefillContactId?: string;
}

const AppointmentModal: React.FC<Props> = ({ open, onClose, onSave, onDelete, editing, defaultDate, defaultTime, prefillContactName, prefillContactId }) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalAppointmentType>("Sales Call");
  const [status, setStatus] = useState<CalAppointmentStatus>("Scheduled");
  const [contactName, setContactName] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00 AM");
  const [endTime, setEndTime] = useState("10:30 AM");
  const [userInteractedWithEnd, setUserInteractedWithEnd] = useState(false);
  const [agent, setAgent] = useState("Chris Garcia");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [miniCardOpen, setMiniCardOpen] = useState(false);
  const [miniCardRect, setMiniCardRect] = useState<DOMRect | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string; name: string; phone: string; email: string; state?: string; status?: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const contactInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Current user is Admin
  const currentUserRole = "Admin";

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setErrors({});
    setMiniCardOpen(false);
    setContactDropdownOpen(false);
    setShowCreateForm(false);
    setSelectedContactId("");
    setContactResults([]);
    setNewFirstName(""); setNewLastName(""); setNewPhone(""); setNewEmail("");

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
      const firstName = prefillContactName?.split(" ")[0] || "";
      setTitle(prefillContactName ? `Call with ${firstName}` : "");
      setType("Sales Call"); setStatus("Scheduled");
      setContactName(prefillContactName || "");
      setStartTime(defaultTime || "10:00 AM");
      setEndTime(defaultTime ? advanceTime(defaultTime) : "10:30 AM");
      setAgent("Chris Garcia"); setNotes("");
      if (defaultDate) {
        const d = defaultDate;
        setDate(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`);
      } else {
        const d = new Date();
        setDate(`${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`);
      }
    }
  }, [open, editing, defaultDate, defaultTime, prefillContactName]);

  const contactId = editing?.contactId || prefillContactId || selectedContactId || "";
  const [contactInfo, setContactInfo] = useState<{ name: string; phone: string; email: string; state: string; status: string; contactId: string } | null>(null);

  useEffect(() => {
    if (!contactId) {
      setContactInfo(null);
      return;
    }
    const fetchLeadInfo = async () => {
      const { data, error } = await supabase.from('leads').select('*').eq('id', contactId).maybeSingle();
      if (data && !error) {
        setContactInfo({
          name: `${data.first_name} ${data.last_name}`,
          phone: data.phone || "",
          email: data.email || "",
          state: data.state || "",
          status: data.status || "",
          contactId: data.id
        });
      }
    };
    fetchLeadInfo();
  }, [contactId]);

  // Auto-populate end time based on duration
  useEffect(() => {
    if (editing || userInteractedWithEnd) return;
    
    const startMin = timeToMinutes(startTime);
    const duration = TYPE_DURATIONS[type] || 30;
    setEndTime(minutesToTime(startMin + duration));
  }, [type, startTime, editing, userInteractedWithEnd]);

  if (!open) return null;

  const contactFirstName = contactName.split(" ")[0] || "Contact";

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Title is required";
    if (!type) e.type = "Type is required";
    if (!date) e.date = "Date is required";
    if (!startTime) e.startTime = "Start time is required";
    if (startTime && endTime) {
      const si = timeToMinutes(startTime);
      const ei = timeToMinutes(endTime);
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
      title: title.trim(), type, status,
      contactName: contactName.trim(),
      contactId: editing?.contactId ?? prefillContactId ?? selectedContactId ?? "",
      date: dateObj, startTime, endTime, agent: agent.trim(), notes: notes.trim(),
    });
    toastSonner.success(editing ? "Appointment updated" : "Appointment scheduled successfully");
    onClose();
  };


  const handleDelete = () => {
    if (editing && onDelete) {
      onDelete(editing.id);
      toastSonner.error("Appointment deleted");
      onClose();
    }

  };

  const handleBadgeClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMiniCardRect(rect);
    setMiniCardOpen(true);
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
          {/* Contact Name — first field */}
          {(editing && contactId && contactInfo) || prefillContactName ? (
            <div className="mb-6">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Contact</p>
              <div className="flex items-center gap-3">
                <button onClick={contactInfo ? handleBadgeClick : undefined}
                  className="text-lg font-semibold px-4 py-2 rounded-full transition-colors duration-150"
                  style={{ backgroundColor: "#14B8A626", color: "#14B8A6", border: "1px solid #14B8A64D", cursor: contactInfo ? "pointer" : "default" }}>
                  {contactInfo?.name || prefillContactName}
                </button>
                {contactInfo && (
                  <button onClick={() => { navigate('/contacts', { state: { openContactId: contactId } }); setMiniCardOpen(false); onClose(); toastSonner.info(`Opening contact record for ${contactInfo.name}`); }}
                    className="text-sm hover:underline cursor-pointer" style={{ color: "#3B82F6" }}>
                    View Contact →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <label className="text-sm font-medium text-foreground block mb-1">Contact Name</label>
              <input
                ref={contactInputRef}
                value={contactName}
                onChange={async (e) => {
                  const val = e.target.value;
                  setContactName(val);
                  setShowCreateForm(false);
                  setSelectedContactId("");
                  
                  if (val.trim().length >= 2) {
                    setContactDropdownOpen(true);
                    setSearchLoading(true);
                    const { data, error } = await supabase
                      .from('leads')
                      .select('id, first_name, last_name, phone, email')
                      .or(`first_name.ilike.%${val}%,last_name.ilike.%${val}%,phone.ilike.%${val}%`)
                      .limit(5);
                    if (!error && data) {
                      setContactResults(data.map(l => ({ 
                        id: l.id, 
                        name: `${l.first_name} ${l.last_name}`, 
                        phone: l.phone || "", 
                        email: l.email || "" 
                      })));
                    }
                    setSearchLoading(false);
                  } else {
                    setContactDropdownOpen(false);
                    setContactResults([]);
                  }
                }}
                onFocus={() => { if (contactName.trim().length >= 2) setContactDropdownOpen(true); }}
                onBlur={() => { setTimeout(() => setContactDropdownOpen(false), 200); }}
                placeholder="Search or enter contact name"
                className={`${inputCls} text-base placeholder:text-muted-foreground`}
                autoComplete="off"
              />
              {!showCreateForm && <p className="text-xs text-muted-foreground mt-1">Type 2+ chars to search leads</p>}


              {/* Search dropdown */}
              {contactDropdownOpen && !showCreateForm && (
                 <div ref={dropdownRef} className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {searchLoading && <div className="px-3 py-2 text-xs text-muted-foreground italic">Searching leads...</div>}
                    {!searchLoading && contactResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault();
                          setContactName(c.name);
                          setSelectedContactId(c.id);
                          setContactDropdownOpen(false);
                          if (!title.trim()) {
                            setTitle(`Call with ${c.name.split(" ")[0]}`);
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors duration-150 flex items-center justify-between"
                      >
                        <span>{c.name}</span>
                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                    {!searchLoading && contactResults.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No leads found</div>
                    )}
                    {!searchLoading && (
                      <button
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault();
                          setContactDropdownOpen(false);
                          setShowCreateForm(true);
                          const parts = contactName.trim().split(/\s+/);
                          setNewFirstName(parts[0] || "");
                          setNewLastName(parts.slice(1).join(" ") || "");
                          setNewPhone("");
                          setNewEmail("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors duration-150 flex items-center gap-2"
                        style={{ backgroundColor: "#3B82F60D" }}
                      >
                        <Plus className="w-4 h-4" style={{ color: "#3B82F6" }} />
                        <span style={{ color: "#3B82F6" }} className="font-medium">Create new lead: {contactName}</span>
                      </button>
                    )}
                  </div>
              )}


              {/* Inline mini-form for creating a new contact */}
              {showCreateForm && (
                <div className="mt-3 p-4 rounded-lg border border-border bg-accent/30 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Create New Contact</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
                      <input value={newFirstName} onChange={e => setNewFirstName(e.target.value)} className={inputCls} placeholder="First name" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
                      <input value={newLastName} onChange={e => setNewLastName(e.target.value)} className={inputCls} placeholder="Last name" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Phone Number *</label>
                    <input value={newPhone} onChange={e => setNewPhone(e.target.value)} className={inputCls} placeholder="(555) 000-0000" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Email (optional)</label>
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputCls} placeholder="email@example.com" />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim()) {
                          toastSonner.error("First name, last name, and phone are required");
                          return;
                        }
                        
                        const { data: newLead, error } = await supabase
                          .from('leads')
                          .insert([{ 
                            first_name: newFirstName.trim(), 
                            last_name: newLastName.trim(),
                            phone: newPhone.trim(),
                            email: newEmail.trim() || null,
                            status: "New"
                          }])
                          .select().single();

                        if (error || !newLead) {
                          toastSonner.error("Failed to create lead");
                          return;
                        }

                        const fullName = `${newLead.first_name} ${newLead.last_name}`;
                        setContactName(fullName);
                        setSelectedContactId(newLead.id);
                        setShowCreateForm(false);
                        if (!title.trim()) {
                          setTitle(`Call with ${newLead.first_name}`);
                        }
                        toastSonner.success("New lead created");
                      }}
                      className="px-4 py-2 rounded-md text-sm font-medium text-white transition-colors duration-150"
                      style={{ backgroundColor: "#3B82F6" }}
                    >
                      Save Lead & Continue

                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground border border-border hover:bg-accent transition-colors duration-150"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Title *</label>
            <input value={title} onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(p => { const n = {...p}; delete n.title; return n; }); }}
              placeholder="Appointment title" className={`${inputCls} ${errors.title ? "border-red-500" : ""}`} />
            {errors.title && <p className="text-xs text-red-500 mt-0.5">{errors.title}</p>}
          </div>
          {/* Type */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Appointment Type *</label>
            <select value={type} onChange={e => setType(e.target.value as CalAppointmentType)} className={`${inputCls} ${errors.type ? "border-red-500" : ""}`}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.type && <p className="text-xs text-red-500 mt-0.5">{errors.type}</p>}
          </div>
          {/* Status */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as CalAppointmentStatus)} className={inputCls}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {/* Date */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Date *</label>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); if (errors.date) setErrors(p => { const n = {...p}; delete n.date; return n; }); }}
              className={`${inputCls} ${errors.date ? "border-red-500" : ""}`} />
            {errors.date && <p className="text-xs text-red-500 mt-0.5">{errors.date}</p>}
          </div>
          {/* Time Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">Start Time *</label>
              <TimeSelect 
                value={startTime} 
                onChange={setStartTime} 
                placeholder="10:00 AM"
                error={!!errors.startTime}
              />
              {errors.startTime && <p className="text-xs text-red-500 mt-0.5">{errors.startTime}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">End Time *</label>
              <TimeSelect 
                value={endTime} 
                onChange={val => {
                  setEndTime(val);
                  setUserInteractedWithEnd(true);
                }} 
                placeholder="10:30 AM"
                error={!!errors.endTime}
              />
              {errors.endTime && <p className="text-xs text-red-500 mt-0.5">{errors.endTime}</p>}
            </div>
          </div>

          {/* Agent */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Agent</label>
            {currentUserRole === "Admin" || currentUserRole === "Team Leader" ? (
              <select value={agent} onChange={e => setAgent(e.target.value)} className={inputCls}>
                {agents.map(a => (
                  <option key={a.id} value={`${a.firstName} ${a.lastName}`}>{a.firstName} {a.lastName}</option>
                ))}
              </select>
            ) : (
              <div className="w-full h-9 px-3 rounded-md text-sm text-foreground flex items-center cursor-default" style={{ backgroundColor: "#33415580" }}>
                {agent}
              </div>
            )}
          </div>
          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} min-h-[72px] py-2`} />
          </div>
        </div>

        {/* Action buttons (edit only) */}
        {editing && (
          <div className="px-5 pb-4">
            <div className="border-t border-border pt-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  disabled={!contactId}
                  onClick={() => { toastSonner.success(`Opening dialer for ${contactName}`); window.dispatchEvent(new CustomEvent("openDialer")); }}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${!contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
                  style={{ backgroundColor: "#22C55E1A", color: "#22C55E", border: "1px solid #22C55E4D" }}>
                  <Phone className="w-3.5 h-3.5" /> Call {contactFirstName}
                </button>
                <button
                  disabled={!contactId}
                  onClick={() => toastSonner.success(`Appointment confirmation text sent to ${contactName}`)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${!contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
                  style={{ backgroundColor: "#3B82F61A", color: "#3B82F6", border: "1px solid #3B82F64D" }}>
                  <MessageSquare className="w-3.5 h-3.5" /> Confirm via Text
                </button>
                <button
                  disabled={!contactId}
                  onClick={() => toastSonner.success(`Appointment confirmation email sent to ${contactName}`)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${!contactId ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
                  style={{ backgroundColor: "#A855F71A", color: "#A855F7", border: "1px solid #A855F74D" }}>
                  <Mail className="w-3.5 h-3.5" /> Confirm via Email
                </button>

              </div>
            </div>
          </div>
        )}

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

      {/* Contact Mini Card */}
      {miniCardOpen && contactInfo && (
        <ContactMiniCard contact={contactInfo} anchorRect={miniCardRect} onClose={() => setMiniCardOpen(false)} onModalClose={onClose} />
      )}
    </div>
  );
};

function advanceTime(time: string): string {
  const min = timeToMinutes(time);
  return minutesToTime(min + 30);
}

export default AppointmentModal;
