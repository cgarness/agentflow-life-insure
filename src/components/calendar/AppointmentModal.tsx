import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, Mail, Plus, Clock } from "lucide-react";
import { CalendarAppointment, CalAppointmentType, CalAppointmentStatus, APPOINTMENT_TYPE_COLORS } from "@/contexts/CalendarContext";

import { toast as toastSonner } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ContactMiniCard from "./ContactMiniCard";
import { cn } from "@/lib/utils";

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
            className={cn(
              "pr-10 h-9",
              error && "border-destructive focus-visible:ring-destructive",
              className
            )}
            onFocus={() => setOpen(true)}
          />
        </PopoverTrigger>
        <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      <PopoverContent className="w-[220px] p-0 z-[200]" align="start">
        <div className="flex h-72 divide-x divide-border overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10">Hr</div>
              {hours.map(h => (
                <button
                  key={h}
                  type="button"
                  className={cn(
                    "w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors",
                    h === currentH ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                  )}
                  onClick={() => updateValue(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="flex-1 border-x border-border">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10">Min</div>
              {minutes.map(m => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    "w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors",
                    m === currentM ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                  )}
                  onClick={() => updateValue(undefined, m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="w-[60px]">
            <div className="p-1 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase text-center sticky top-0 bg-popover z-10"></div>
              {periods.map(p => (
                <button
                  key={p}
                  type="button"
                  className={cn(
                    "w-full text-center px-2 py-1.5 text-xs rounded-sm transition-colors",
                    p === currentP ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                  )}
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

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<CalendarAppointment, "id">) => void;
  onDelete?: (id: string) => void;
  editing?: CalendarAppointment | null;
  defaultDate?: Date;
  defaultTime?: string;
  prefillContactName?: string;
  prefillContactId?: string;
}

const AppointmentModal: React.FC<Props> = ({ open, onClose, onSave, onDelete, editing, defaultDate, defaultTime, prefillContactName, prefillContactId }) => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
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
  const [agents, setAgents] = useState<{ id: string; firstName: string; lastName: string }[]>([]);

  useEffect(() => {
    supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active").then(({ data }) => {
      if (data) setAgents(data.map((p: any) => ({ id: p.id, firstName: p.first_name || "", lastName: p.last_name || "" })));
    });
  }, []);

  const contactInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (editing || userInteractedWithEnd) return;
    const startMin = timeToMinutes(startTime);
    const duration = TYPE_DURATIONS[type] || 30;
    setEndTime(minutesToTime(startMin + duration));
  }, [type, startTime, editing, userInteractedWithEnd]);

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

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-w-[480px] p-0 overflow-hidden border-none shadow-2xl bg-card z-[100]">
        <DialogHeader className="p-5 border-b border-border bg-muted/20">
          <DialogTitle className="text-xl font-bold tracking-tight">
            {editing ? "Edit Appointment" : "Schedule Appointment"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-medium text-xs">
            Plan your next engagement with precision.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto no-scrollbar">
          {/* Contact Section */}
          {(editing && contactId && contactInfo) || prefillContactName ? (
            <div className="bg-accent/30 rounded-xl p-4 border border-border/50">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 block">Designated Contact</label>
              <div className="flex items-center justify-between">
                <button 
                  onClick={contactInfo ? handleBadgeClick : undefined}
                  className="flex items-center gap-2 group transition-all"
                >
                  <div className="w-10 h-10 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-600 font-bold text-sm shadow-sm group-hover:bg-teal-500/20">
                    {(contactInfo?.name || prefillContactName)?.[0]}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{contactInfo?.name || prefillContactName}</p>
                    <p className="text-[11px] text-muted-foreground font-medium">{contactInfo?.phone || "No phone listed"}</p>
                  </div>
                </button>
                {contactId && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 text-[11px] font-bold text-primary gap-1 hover:bg-primary/10"
                    onClick={() => { navigate('/contacts', { state: { openContactId: contactId } }); onClose(); }}
                  >
                    View CRM <Plus className="w-3 h-3 rotate-45" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <label className="text-xs font-bold text-foreground uppercase tracking-wider mb-1.5 block">Contact Search</label>
              <div className="relative">
                <Input
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
                  placeholder="Search lead by name or phone..."
                  className="h-10 text-sm shadow-sm border-border focus-visible:ring-primary/20"
                />
              </div>

              {contactDropdownOpen && !showCreateForm && (
                 <div ref={dropdownRef} className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
                    {searchLoading && <div className="px-4 py-3 text-xs text-muted-foreground italic flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" /> Searching...
                    </div>}
                    {!searchLoading && contactResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault();
                          setContactName(c.name);
                          setSelectedContactId(c.id);
                          setContactDropdownOpen(false);
                          if (!title.trim()) setTitle(`Call with ${c.name.split(" ")[0]}`);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent flex items-center justify-between border-b border-border last:border-0 transition-colors"
                      >
                        <span className="font-semibold">{c.name}</span>
                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{c.phone}</span>
                      </button>
                    ))}
                    {!searchLoading && contactResults.length === 0 && (
                      <div className="px-4 py-3 text-xs text-muted-foreground font-medium">No results found</div>
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
                        }}
                        className="w-full text-left px-4 py-3 text-xs font-bold text-primary hover:bg-primary/5 flex items-center gap-2 bg-primary/10 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Quick Create: "{contactName}"</span>
                      </button>
                    )}
                  </div>
              )}

              {showCreateForm && (
                <div className="mt-3 p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-4 animate-in zoom-in-95 duration-200 shadow-inner">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-primary uppercase tracking-wider">New Lead Entry</p>
                    <button onClick={() => setShowCreateForm(false)} className="text-[10px] text-muted-foreground hover:text-foreground underline">Back to Search</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input value={newFirstName} onChange={e => setNewFirstName(e.target.value)} placeholder="First Name *" className="h-9 text-xs" />
                    <Input value={newLastName} onChange={e => setNewLastName(e.target.value)} placeholder="Last Name *" className="h-9 text-xs" />
                  </div>
                  <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone Number *" className="h-9 text-xs" />
                  <Input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email Address (Optional)" className="h-9 text-xs" />
                  <Button
                    size="sm"
                    className="w-full h-8 text-[11px] font-bold uppercase tracking-wider bg-primary hover:bg-primary/90"
                    onClick={async () => {
                      if (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim()) {
                        toastSonner.error("Required fields missing");
                        return;
                      }
                      const { data: newLead, error } = await supabase
                        .from('leads')
                        .insert([{
                          first_name: newFirstName.trim(),
                          last_name: newLastName.trim(),
                          phone: newPhone.trim(),
                          email: newEmail.trim() || null,
                          status: "New",
                          organization_id: organizationId,
                        }])
                        .select().single();

                      if (error || !newLead) {
                        toastSonner.error("Lead creation failed");
                        return;
                      }
                      setContactName(`${newLead.first_name} ${newLead.last_name}`);
                      setSelectedContactId(newLead.id);
                      setShowCreateForm(false);
                      if (!title.trim()) setTitle(`Call with ${newLead.first_name}`);
                      toastSonner.success("Lead registered");
                    }}
                  >
                    Save & Proceed
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Appointment Details */}
          <div className="space-y-4 pt-2 border-t border-border/50">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Subject *</label>
                <Input 
                  value={title} 
                  onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(p => { const n = {...p}; delete n.title; return n; }); }}
                  placeholder="What is this call about?" 
                  className={cn("h-10 text-sm shadow-sm", errors.title && "border-destructive ring-destructive/20")} 
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Type</label>
                <select 
                  value={type} 
                  onChange={e => setType(e.target.value as CalAppointmentType)} 
                  className="w-full h-10 px-3 rounded-md bg-background text-sm text-foreground border border-input focus:ring-2 focus:ring-ring focus:outline-none shadow-sm"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Status</label>
                <select 
                  value={status} 
                  onChange={e => setStatus(e.target.value as CalAppointmentStatus)} 
                  className="w-full h-10 px-3 rounded-md bg-background text-sm text-foreground border border-input focus:ring-2 focus:ring-ring focus:outline-none shadow-sm"
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Scheduled Date *</label>
                <Input 
                  type="date" 
                  value={date} 
                  onChange={e => { setDate(e.target.value); if (errors.date) setErrors(p => { const n = {...p}; delete n.date; return n; }); }}
                  className={cn("h-10 text-sm shadow-sm", errors.date && "border-destructive ring-destructive/20")} 
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Starts *</label>
                <TimeSelect 
                  value={startTime} 
                  onChange={setStartTime} 
                  placeholder="Start Time"
                  error={!!errors.startTime}
                  className="shadow-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Ends *</label>
                <TimeSelect 
                  value={endTime} 
                  onChange={val => { setEndTime(val); setUserInteractedWithEnd(true); }} 
                  placeholder="End Time"
                  error={!!errors.endTime}
                  className="shadow-sm"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Assigned Advisor</label>
                <select 
                  value={agent} 
                  onChange={e => setAgent(e.target.value)} 
                  className="w-full h-10 px-3 rounded-md bg-background text-sm text-foreground border border-input focus:ring-2 focus:ring-ring focus:outline-none shadow-sm"
                  disabled={currentUserRole !== "Admin" && currentUserRole !== "Team Leader"}
                >
                  {agents.map(a => (
                    <option key={a.id} value={`${a.firstName} ${a.lastName}`}>{a.firstName} {a.lastName}</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 block">Internal Notes</label>
                <textarea 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  rows={3} 
                  className="w-full min-h-[80px] px-3 py-2.5 rounded-md bg-background text-sm text-foreground border border-input focus:ring-2 focus:ring-ring focus:outline-none shadow-sm resize-none custom-scrollbar"
                  placeholder="Add any specific context for the advisor..."
                />
              </div>
            </div>
          </div>
          
          {/* Action Row for Editing */}
          {editing && (
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/50">
              <Button 
                variant="outline" 
                size="sm"
                className="text-[10px] font-bold uppercase gap-1.5 bg-green-500/5 text-green-600 border-green-500/20 hover:bg-green-500/10 h-8"
                onClick={() => { toastSonner.success(`Preparing dialer...`); window.dispatchEvent(new CustomEvent("openDialer")); }}
              >
                <Phone className="w-3 h-3" /> Call {contactName.split(' ')[0]}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="text-[10px] font-bold uppercase gap-1.5 bg-blue-500/5 text-blue-600 border-blue-500/20 hover:bg-blue-500/10 h-8"
                onClick={() => toastSonner.success(`Confirmation SMS queued`)}
              >
                <MessageSquare className="w-3 h-3" /> SMS Conf
              </Button>
               <Button 
                variant="outline" 
                size="sm"
                className="text-[10px] font-bold uppercase gap-1.5 bg-purple-500/5 text-purple-600 border-purple-500/20 hover:bg-purple-500/10 h-8"
                onClick={() => toastSonner.success(`Confirmation Email queued`)}
              >
                <Mail className="w-3 h-3" /> Email Conf
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="p-5 border-t border-border bg-muted/20 flex items-center justify-between sm:justify-between">
          <div className="flex-1">
            {editing && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                  <span className="text-[10px] font-bold text-destructive uppercase tracking-widest">Confirm?</span>
                  <Button variant="ghost" size="sm" onClick={handleDelete} className="h-7 text-[10px] bg-destructive/10 text-destructive hover:bg-destructive/20 font-bold px-3">YES</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} className="h-7 text-[10px] font-bold px-3 uppercase">NO</Button>
                </div>
              ) : (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setConfirmDelete(true)}
                  className="h-8 text-[10px] font-bold text-destructive uppercase hover:bg-destructive/10 px-3 tracking-widest"
                >
                  Terminate
                </Button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-9 px-4 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:bg-accent">
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleSave} 
              className="h-9 px-6 text-xs font-bold uppercase tracking-widest bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
            >
              {editing ? "Commit Changes" : "Confirm Schedule"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {miniCardOpen && contactInfo && (
        <ContactMiniCard contact={contactInfo} anchorRect={miniCardRect} onClose={() => setMiniCardOpen(false)} onModalClose={onClose} />
      )}
    </Dialog>
  );
};

function advanceTime(time: string): string {
  const min = timeToMinutes(time);
  return minutesToTime(min + 30);
}

export default AppointmentModal;
