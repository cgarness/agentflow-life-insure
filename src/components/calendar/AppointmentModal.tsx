import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, Mail, Plus, Clock, User, Calendar as CalendarIcon } from "lucide-react";
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
import { DateInput } from "@/components/shared/DateInput";
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
              "pr-10 h-8 text-xs",
              error && "border-destructive focus-visible:ring-destructive",
              className
            )}
            onFocus={() => setOpen(true)}
          />
        </PopoverTrigger>
        <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
      <PopoverContent className="w-[200px] p-0 z-[200] overflow-hidden shadow-xl border-border" align="start">
        <div className="flex h-[200px] divide-x divide-border bg-popover">
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0.5">
              {hours.map(h => (
                <button
                  key={h}
                  type="button"
                  className={cn(
                    "w-full text-center px-1 py-1 text-[11px] rounded-sm transition-colors",
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
              {minutes.filter((_, i) => i % 5 === 0).map(m => ( // Shorter list for efficiency
                <button
                  key={m}
                  type="button"
                  className={cn(
                    "w-full text-center px-1 py-1 text-[11px] rounded-sm transition-colors",
                    m === currentM ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent"
                  )}
                  onClick={() => updateValue(undefined, m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </ScrollArea>
          <ScrollArea className="w-[50px]">
            <div className="p-1 space-y-0.5">
              {periods.map(p => (
                <button
                  key={p}
                  type="button"
                  className={cn(
                    "w-full text-center px-1 py-1 text-[11px] rounded-sm transition-colors",
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
    if (!title.trim()) e.title = "Required";
    if (!type) e.type = "Required";
    if (!date) e.date = "Required";
    if (!startTime) e.startTime = "Required";
    if (startTime && endTime) {
      const si = timeToMinutes(startTime);
      const ei = timeToMinutes(endTime);
      if (ei <= si) e.endTime = "Invalid";
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
    toastSonner.success(editing ? "Saved" : "Scheduled");
    onClose();
  };

  const handleDelete = () => {
    if (editing && onDelete) {
      onDelete(editing.id);
      toastSonner.error("Deleted");
      onClose();
    }
  };

  const handleBadgeClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMiniCardRect(rect);
    setMiniCardOpen(true);
  };

  const handleStartCall = () => {
    if (!contactInfo?.phone) return;
    window.dispatchEvent(new CustomEvent("quick-call", {
      detail: {
        phone: contactInfo.phone,
        contactId: contactId,
        name: contactInfo.name,
        type: "lead" 
      }
    }));
    toastSonner.info(`Connecting to ${contactInfo.name}...`);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-[480px] w-[95vw] max-h-[95vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl bg-card rounded-xl">
        <DialogHeader className="p-4 border-b border-primary/10 bg-primary/[0.03] flex flex-row items-center justify-between space-y-0">
          <div className="flex flex-col">
            <DialogTitle className="text-sm font-bold tracking-tight text-primary flex items-center gap-2">
              <CalendarIcon className="w-3.5 h-3.5" />
              {editing ? "Edit Appointment" : "Schedule Meeting"}
            </DialogTitle>
            <DialogDescription className="text-[10px] text-muted-foreground opacity-80">
              {editing ? "Update your meeting details." : "Set your next meeting details below."}
            </DialogDescription>
          </div>
          
          {editing && (
            <div className="flex items-center gap-1.5 mr-6">
              {contactInfo?.phone && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 rounded-full transition-colors"
                  onClick={handleStartCall}
                  title="Start Call"
                >
                  <Phone className="w-4 h-4" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-full transition-colors"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete Appointment"
                >
                  <Plus className="w-4 h-4 rotate-45" />
                </Button>
              )}
            </div>
          )}
        </DialogHeader>

        {confirmDelete && (
          <div className="absolute inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-card border border-destructive/20 rounded-xl p-6 shadow-2xl max-w-xs w-full text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <Plus className="w-6 h-6 rotate-45 text-destructive" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Delete Appointment?</h3>
                <p className="text-xs text-muted-foreground mt-1">This action cannot be undone.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 h-9 text-xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button variant="destructive" className="flex-1 h-9 text-xs font-bold" onClick={handleDelete}>Delete</Button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 space-y-4 flex-1 overflow-y-auto min-h-0 scrollbar-thin">
          {/* Contact Section */}
          {(editing && contactId && contactInfo) || prefillContactName ? (
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-600 font-bold text-xs">
                  {(contactInfo?.name || prefillContactName)?.[0]}
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground leading-tight">{contactInfo?.name || prefillContactName}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">{contactInfo?.phone || "No phone"}</p>
                </div>
              </div>
              {contactId && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-[10px] font-bold text-primary px-2 hover:bg-primary/5"
                  onClick={() => { navigate('/contacts', { state: { openContactId: contactId } }); onClose(); }}
                >
                  CRM <Plus className="w-2.5 h-2.5 rotate-45 ml-1" />
                </Button>
              )}
            </div>
          ) : (
            <div className="relative">
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
                  placeholder="Search contact..."
                  className="h-9 text-xs shadow-sm bg-muted/20 border-border"
                />
              </div>

              {contactDropdownOpen && !showCreateForm && (
                 <div ref={dropdownRef} className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {searchLoading && <div className="px-3 py-2 text-[10px] text-muted-foreground animate-pulse italic">Searching...</div>}
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
                        className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-accent flex items-center justify-between border-b border-border/50 last:border-0"
                      >
                        <span className="font-semibold">{c.name}</span>
                        <span className="text-[9px] font-bold text-muted-foreground bg-muted px-1.5 rounded">{c.phone}</span>
                      </button>
                    ))}
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
                        className="w-full text-left px-3 py-2 text-[10px] font-bold text-primary hover:bg-primary/5 bg-primary/10 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 inline mr-1.5" />
                        Quick Create: "{contactName}"
                      </button>
                    )}
                  </div>
              )}

              {showCreateForm && (
                <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2 animate-in zoom-in-95 duration-200">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={newFirstName} onChange={e => setNewFirstName(e.target.value)} placeholder="First Name *" className="h-7 text-[10px]" />
                    <Input value={newLastName} onChange={e => setNewLastName(e.target.value)} placeholder="Last Name *" className="h-7 text-[10px]" />
                  </div>
                  <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone *" className="h-7 text-[10px]" />
                  <Button
                    size="sm"
                    className="w-full h-7 text-[10px] font-bold"
                    onClick={async () => {
                      if (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim()) { toastSonner.error("Fields missing"); return; }
                      const { data: newLead, error } = await supabase
                        .from('leads').insert([{
                          first_name: newFirstName.trim(), last_name: newLastName.trim(),
                          phone: newPhone.trim(), email: newEmail.trim() || null,
                          status: "New", organization_id: organizationId,
                        }]).select().single();
                      if (error || !newLead) { toastSonner.error("Failed"); return; }
                      setContactName(`${newLead.first_name} ${newLead.last_name}`);
                      setSelectedContactId(newLead.id); setShowCreateForm(false);
                      if (!title.trim()) setTitle(`Call with ${newLead.first_name}`);
                      toastSonner.success("Created");
                    }}
                  >
                    Quick Add
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 pt-1">
            <div className="space-y-1">
               <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Subject line</label>
              <Input 
                value={title} 
                onChange={e => { setTitle(e.target.value); if (errors.title) setErrors(p => { const n = {...p}; delete n.title; return n; }); }}
                placeholder="Call purpose" 
                className={cn("h-8 text-xs shadow-sm", errors.title && "border-destructive ring-destructive/20")} 
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Type</label>
                <select 
                  value={type} 
                  onChange={e => setType(e.target.value as CalAppointmentType)} 
                  className="w-full h-8 px-2 rounded-lg bg-muted/20 text-xs text-foreground border border-border focus:ring-1 focus:ring-primary shadow-sm transition-all"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Status</label>
                <select 
                  value={status} 
                  onChange={e => setStatus(e.target.value as CalAppointmentStatus)} 
                  className="w-full h-8 px-2 rounded-lg bg-muted/20 text-xs text-foreground border border-border focus:ring-1 focus:ring-primary shadow-sm transition-all"
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Date</label>
                <DateInput 
                  value={date} 
                  onChange={val => { setDate(val); if (errors.date) setErrors(p => { const n = {...p}; delete n.date; return n; }); }}
                  className="w-full h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Assignee</label>
                <select 
                  value={agent} 
                  onChange={e => setAgent(e.target.value)} 
                  className="w-full h-8 px-2 rounded-lg bg-muted/20 text-xs text-foreground border border-border focus:ring-1 focus:ring-primary shadow-sm transition-all"
                  disabled={currentUserRole !== "Admin" && currentUserRole !== "Team Leader"}
                >
                  {agents.map(a => (
                    <option key={a.id} value={`${a.firstName} ${a.lastName}`}>{a.firstName} {a.lastName}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-xl border border-border/50">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Starts</label>
                <TimeSelect value={startTime} onChange={setStartTime} error={!!errors.startTime} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Ends</label>
                <TimeSelect value={endTime} onChange={val => { setEndTime(val); setUserInteractedWithEnd(true); }} error={!!errors.endTime} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Notes</label>
              <textarea 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                rows={2} 
                className="w-full min-h-[50px] px-3 py-2 rounded-md bg-background text-xs text-foreground border border-input focus:ring-1 focus:ring-primary shadow-sm resize-none"
                placeholder="Brief notes..."
              />
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-muted/5 flex items-center justify-end gap-3 sm:justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-4 text-[10px] font-bold uppercase text-muted-foreground hover:bg-muted transition-colors">
            CANCEL
          </Button>
          <Button 
            size="sm" 
            onClick={handleSave} 
            className="h-8 px-6 text-[10px] font-bold uppercase tracking-widest bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:translate-y-[-1px] transition-all"
          >
            CONFIRM
          </Button>
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
