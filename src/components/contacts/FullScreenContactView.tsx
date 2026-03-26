import React, { useState, useEffect, useRef } from "react";
import { X, Phone, Mail, Calendar, Pencil, Trash2, ArrowLeft, Clock, Pin, FileText, MessageSquare, ChevronDown, Play, Save, Clipboard, AlertTriangle, Loader2 } from "lucide-react";
import { ContactLocalTime } from "@/components/shared/ContactLocalTime";
import { LeadStatus, ContactNote, ContactActivity, PipelineStage } from "@/lib/types";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";

type ContactType = "lead" | "client" | "recruit";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
const leadSources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar", "Cold Call", "TV Ad", "Radio Ad", "Other"];
const healthStatuses = ["Excellent", "Good", "Fair", "Poor"];
const bestTimes = ["Morning 8am-12pm", "Afternoon 12pm-5pm", "Evening 5pm-8pm", "Anytime"];
const recruitStatuses = ["Prospect", "Contacted", "Interview", "Licensed", "Active"];
const policyTypes = ["Term", "Whole Life", "IUL", "Final Expense"];

// Hardcoded fallbacks - will be matched against settings
const fallbackStatusStyles: Record<string, string> = {
  New: "#3B82F6",
  Contacted: "#CA8A04",
  Interested: "#16A34A",
  "Follow Up": "#9333EA",
  Hot: "#EA580C",
  "Not Interested": "#DC2626",
  "Closed Won": "#16A34A",
  "Closed Lost": "#DC2626",
  Prospect: "#6B7280",
  Interview: "#CA8A04",
  Licensed: "#9333EA",
  Active: "#16A34A",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

const activityDotColor = (type: string) => {
  switch (type) {
    case "call": return "bg-blue-500";
    case "note": return "bg-gray-500";
    case "status": return "bg-blue-500";
    case "appointment": return "bg-purple-500";
    case "import": return "bg-gray-500";
    case "convert": return "bg-green-500";
    case "delete": return "bg-red-500";
    case "pin": return "bg-yellow-500";
    case "merge": return "bg-gray-500";
    default: return "bg-blue-500";
  }
};

const formatName = (name: string) => {
  if (!name) return '';
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

const CopyField: React.FC<{ value?: string | number | null }> = ({ value }) => {
  if (!value && value !== 0) return <span className="text-muted-foreground italic">—</span>;
  const display = String(value);
  if (display === 'null' || display === 'undefined' || display.trim() === '') return <span className="text-muted-foreground italic">—</span>;
  return (
    <div className="flex items-center justify-between group w-full min-w-0">
      <span className="text-foreground font-medium truncate mr-2" title={display}>{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(display); toast.success("Copied to clipboard"); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
      >
        <Clipboard className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface FullScreenContactViewProps {
  contact: any; // Allow lead/client/recruit polymorphic type
  type: ContactType;
  onClose: () => void;
  onUpdate: (id: string, data: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvert?: (contact: any) => void;
}

const FullScreenContactView: React.FC<FullScreenContactViewProps> = ({ contact, type, onClose, onUpdate, onDelete, onConvert }) => {
  const { collapsed } = useSidebarContext();
  const { organizationId } = useOrganization();
  const { addAppointment } = useCalendar();
  const { profile } = useAuth();
  const [showAppt, setShowAppt] = useState(false);
  const [rightTab, setRightTab] = useState<"Activity" | "Notes" | "Campaigns">("Activity");
  
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [localNotes, setLocalNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [pinNewNote, setPinNewNote] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>(contact?.status || "");
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [agents, setAgents] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const AGENT_NAME = profile ? `${profile.first_name} ${profile.last_name}` : "Agent";
  const AGENT_ID = profile?.id || "u1";
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());

  const getStatusColor = (status: string) => {
    const stage = pipelineStages.find(s => s.name === status);
    if (stage) return stage.color;
    return fallbackStatusStyles[status] || "#6B7280";
  };

  // Conversations
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoItems, setConvoItems] = useState<any[]>([]);
  const [convoFilter, setConvoFilter] = useState<"All" | "Calls" | "SMS" | "Email">("All");
  const [composeTab, setComposeTab] = useState<"SMS" | "Email">("SMS");
  const [composeText, setComposeText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contact?.id) {
      const url = new URL(window.location.href);
      url.searchParams.set("contact", contact.id);
      url.searchParams.set("type", type);
      window.history.replaceState({}, "", url.toString());
    }
  }, [contact?.id, type]);

  useEffect(() => {
    async function loadData() {
      if (!contact) return;
      setEditForm({ ...contact });
      setLocalStatus(contact.status || contact.policyType || "New");

      const [fetchedNotes, fetchedActivities] = await Promise.all([
        notesSupabaseApi.getByContact(contact.id),
        activitiesSupabaseApi.getByContact(contact.id)
      ]);

      setLocalNotes(fetchedNotes);
      setActivities(fetchedActivities);

      if (type === "lead" || type === "recruit") {
        const fetchedStages = type === "recruit" 
          ? await pipelineSupabaseApi.getRecruitStages() 
          : await pipelineSupabaseApi.getLeadStages();
        setPipelineStages(fetchedStages);
      }

      if (type === "lead") {
        const { data: campaignLinks } = await supabase
          .from("campaign_leads")
          .select("campaign_id, campaigns(id, name, type, status)")
          .eq("lead_id", contact.id);
        
        if (campaignLinks) {
          setCampaigns(campaignLinks.map((cl: any) => cl.campaigns).filter(Boolean));
        }
      }

      const { data: profileData } = await supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active");
      if (profileData) setAgents(profileData.map((p: any) => ({ id: p.id, firstName: p.first_name || "", lastName: p.last_name || "" })));

      setEditMode(false);
      setHasChanges(false);
      setHasUnsavedChanges(false);
      setErrors({});
      setNewNote("");
      setNoteError("");
      setPinNewNote(false);
      setStatusDropdownOpen(false);
      setShowAppt(false);
      setEmailSubject("");
      
      loadConversations();
    }
    loadData();
  }, [contact, type]);

  const loadConversations = async () => {
    if (!contact?.id) return;
    setConvoLoading(true);
    
    // Fetch calls and messages in parallel
    const [callsRes, msgsRes] = await Promise.all([
      supabase.from("calls").select("id, direction, duration, disposition_name, recording_url, started_at, caller_id_used").eq("contact_id", contact.id).order("started_at", { ascending: true }),
      supabase.from("messages").select("id, direction, body, sent_at, from_number").eq("lead_id", contact.id).order("sent_at", { ascending: true })
    ]);

    const calls = (callsRes.data || []).map(c => ({ ...c, _type: "call", _ts: new Date((c as any).started_at).getTime() }));
    const msgs = (msgsRes.data || []).map(m => ({ ...m, _type: "sms", _ts: new Date((m as any).sent_at).getTime() }));
    
    setConvoItems([...calls, ...msgs].sort((a, b) => a._ts - b._ts));
    setConvoLoading(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
    };
    if (statusDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusDropdownOpen]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [convoItems, convoFilter]);

  if (!contact) return null;

  const filteredConvos = convoFilter === "All" ? convoItems : convoItems.filter(i => i._type === convoFilter.toLowerCase());

  const getAgentDisplayName = (agentId: string) => {
    const a = agents.find(ag => ag.id === agentId);
    return a ? `${a.firstName} ${a.lastName}` : agentId;
  };

  const handleStatusChange = async (newStatus: string) => {
    setStatusDropdownOpen(false);
    setLocalStatus(newStatus);
    setEditForm((f: any) => ({ ...f, status: newStatus }));
    
    await onUpdate(contact.id, { status: newStatus });
    await activitiesSupabaseApi.add({ contactId: contact.id, contactType: type, type: "status", description: `Status changed to ${newStatus}`, agentId: AGENT_ID }, organizationId);
    toast.success(`Status updated to ${newStatus}`);
  };

  const logActivity = (description: string, activityType: string) => {
    const entry: ContactActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contactId: contact.id,
      contactType: type,
      type: activityType,
      description,
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      createdAt: new Date().toISOString(),
    };
    setActivities(prev => [entry, ...prev]);
    setLastUpdated(new Date().toISOString());
  };

  const handleFieldChange = (key: string, value: any) => {
    setEditForm((f: any) => ({ ...f, [key]: value }));
    setHasChanges(true);
    setHasUnsavedChanges(true);
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!editForm.firstName?.trim()) errs.firstName = "First name is required";
    if (!editForm.lastName?.trim()) errs.lastName = "Last name is required";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    
    await onUpdate(contact.id, editForm);
    setEditMode(false);
    setHasChanges(false);
    setHasUnsavedChanges(false);
    
    await activitiesSupabaseApi.add({ contactId: contact.id, contactType: type, type: "note", description: `${type.charAt(0).toUpperCase() + type.slice(1)} details updated by ${AGENT_NAME}`, agentId: AGENT_ID }, organizationId);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} updated successfully`);
  };

  const handleCancel = () => {
    setEditForm({ ...contact });
    setEditMode(false);
    setHasChanges(false);
    setHasUnsavedChanges(false);
    setErrors({});
  };

  const tryClose = () => {
    if (hasUnsavedChanges) {
      setConfirmDiscard(true);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("contact");
      url.searchParams.delete("type");
      window.history.replaceState({}, "", url.toString());
      onClose();
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) { setNoteError("Note cannot be empty"); return; }
    setNoteError("");
    try {
      const addedNote = await notesSupabaseApi.add(contact.id, type, newNote.trim(), AGENT_ID, organizationId, pinNewNote);
      setLocalNotes(prev => {
        const next = [addedNote, ...prev];
        return next.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      });
      setNewNote("");
      setPinNewNote(false);
      logActivity(`Note added by ${AGENT_NAME}`, "note");
      toast.success("Note added");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleTogglePin = async (note: ContactNote) => {
    try {
      const updatedNote = await notesSupabaseApi.togglePin(note.id, note.pinned);
      setLocalNotes(prev => {
        const next = prev.map(n => n.id === note.id ? updatedNote : n);
        return next.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      });
      toast.success(updatedNote.pinned ? "Note pinned" : "Note unpinned");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await notesSupabaseApi.deleteNote(noteId);
      setLocalNotes(prev => prev.filter(n => n.id !== noteId));
      setDeleteNoteId(null);
      logActivity(`Note deleted by ${AGENT_NAME}`, "delete");
      toast.success("Note deleted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSendMessage = async () => {
    if (!composeText.trim() || !contact.phone) return;
    setMessageSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("You must be logged in to send messages", { duration: 5000 });
        setMessageSending(false);
        return;
      }
      
      const res = await fetch(
        `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/telnyx-sms`,
        {
          method: "POST",
          headers: {
             "Content-Type": "application/json",
             Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
              to: contact.phone,
              body: composeText.trim(),
              subject: composeTab === "Email" ? emailSubject.trim() : undefined,
              lead_id: contact.id,
          }),
        }
      );
      const result = await res.json();
      if (!result.success) {
        toast.error(result.error || "Failed to send message", { duration: 5000 });
        setMessageSending(false);
        return;
      }
      toast.success("Message sent");
      setComposeText("");
      setEmailSubject("");
      // Optimistically add message
      const optimMsg = { id: `optim-${Date.now()}`, body: composeText.trim(), direction: "outbound", _type: "sms", _ts: Date.now(), sent_at: new Date().toISOString() };
      setConvoItems(prev => [...prev, optimMsg]);
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
    } finally {
      setMessageSending(false);
    }
  };

  const inputCls = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

  const renderField = (label: string, key: string, fieldType: "text" | "email" | "number" | "select" | "textarea" | "date" = "text", options?: string[]) => {
    const val = editForm[key] ?? "";
    return (
      <div className="bg-muted/50 rounded-lg px-3 py-2">
        <label className="text-xs text-muted-foreground block mb-1">{label}</label>
        {editMode ? (
          <>
            {fieldType === "select" ? (
              <select value={val} onChange={e => handleFieldChange(key, e.target.value)} className={inputCls}>
                <option value="">—</option>
                {options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : fieldType === "textarea" ? (
              <textarea value={val} onChange={e => handleFieldChange(key, e.target.value)} rows={3} className={`${inputCls} min-h-[72px] py-2`} />
            ) : (
              <input type={fieldType} value={val} onChange={e => handleFieldChange(key, fieldType === "number" ? Number(e.target.value) : e.target.value)}
                className={inputCls} />
            )}
            {errors[key] && <p className="text-xs text-red-500 mt-0.5">{errors[key]}</p>}
          </>
        ) : (
          <CopyField value={val} />
        )}
      </div>
    );
  };

  const availableStatuses = pipelineStages.length > 0 
    ? pipelineStages.map(s => s.name) 
    : (type === "recruit" ? recruitStatuses : allStatuses);

  return (
    <div className={cn(
      "fixed top-16 right-0 bottom-0 bg-background z-[100] flex flex-col animate-in slide-in-from-right-2 duration-300 h-[calc(100vh-4rem)] overflow-hidden",
      collapsed ? "md:left-16" : "md:left-60"
    )}>
      {/* HEADER */}
      <div className="bg-card border-b border-border px-6 h-16 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <button onClick={tryClose} className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-4">
            {/* CONTACT TYPE BADGE */}
            <span className={cn(
              "h-9 px-3 flex items-center justify-center text-[11px] uppercase tracking-wider font-bold rounded-lg shadow-sm border whitespace-nowrap",
              type === 'lead' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
              type === 'client' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
              'bg-orange-500/10 text-orange-500 border-orange-500/20'
            )}>
              {type}
            </span>

            {/* LOCAL TIME - standout green */}
            {contact.state && (
              <div className="h-9 px-3 flex items-center gap-2 bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg border border-green-500/20 shadow-sm whitespace-nowrap">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold uppercase tracking-wider"><ContactLocalTime state={contact.state} /></span>
              </div>
            )}

            {/* STATUS DROPDOWN */}
            {type !== "client" ? (
              <div className="relative" ref={statusDropdownRef}>
                <button 
                  onClick={() => setStatusDropdownOpen(!statusDropdownOpen)} 
                  className="h-9 px-3 rounded-lg font-bold text-[11px] uppercase tracking-wider inline-flex items-center gap-2 transition-all shadow-sm border" 
                  style={getStatusColorStyle(getStatusColor(localStatus))}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(localStatus) }} />
                  {localStatus} <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                </button>
                {statusDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 z-50 bg-popover border border-border rounded-xl shadow-xl py-2 min-w-[180px] animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase">Change Status</div>
                    {availableStatuses.map((s: string) => (
                      <button key={s} onClick={() => handleStatusChange(s)} className={cn(
                        "w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent flex items-center gap-3 transition-colors",
                        localStatus === s ? "bg-accent/50 font-semibold" : ""
                      )}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getStatusColor(s) }} /> {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="h-9 px-3 flex items-center justify-center text-[11px] font-bold bg-green-500 text-white shadow-sm uppercase tracking-wider border-green-600/20 border rounded-lg">{contact.policyType || 'Client'}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  className="h-10 px-4 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all font-semibold"
                  onClick={() => {
                    logActivity(`Call initiated by ${AGENT_NAME}`, "call");
                    window.dispatchEvent(new CustomEvent("quick-call", {
                      detail: {
                        phone: contact.phone,
                        contactId: contact.id,
                        name: `${contact.firstName} ${contact.lastName}`
                      }
                    }));
                  }}
                >
                  <Phone className="w-4 h-4 fill-current" /> Call
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start call via dialer</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  className="h-10 px-4 flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg transition-all font-semibold"
                  onClick={() => setShowAppt(true)}
                >
                  <Calendar className="w-4 h-4" /> Schedule
                </Button>
              </TooltipTrigger>
              <TooltipContent>Schedule an appointment</TooltipContent>
            </Tooltip>

            {type === "lead" && onConvert && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    className="h-10 px-4 flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all font-semibold"
                    onClick={() => onConvert(contact)}
                  >
                    <ArrowLeft className="w-4 h-4 rotate-180" /> Convert
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Convert lead to client</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* 3 COLUMN LAYOUT */}
      <div className="flex flex-1 overflow-hidden min-w-0 w-full">

        {/* LEFT DOCK - Contacts Overview */}
        <div className="w-[340px] xl:w-[380px] 2xl:w-[420px] bg-card border-r border-border flex flex-col min-h-0 shadow-sm z-10 shrink-0">
          <div className="px-6 h-14 border-b border-border flex items-center justify-between shrink-0 bg-muted/10">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-bold shadow-sm",
                type === 'client' ? 'bg-green-500' : type === 'recruit' ? 'bg-orange-500' : 'bg-primary'
              )}>
                {contact.firstName?.[0]}{contact.lastName?.[0]}
              </div>
              <h3 className="font-bold text-sm text-foreground truncate max-w-[180px]">{formatName(`${contact.firstName || ''} ${contact.lastName || ''}`.trim())}</h3>
            </div>
            {!editMode ? (
              <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline transition-colors"><Pencil className="w-3 h-3" /> EDIT</button>
            ) : (
               <div className="flex items-center gap-3">
                <button onClick={handleCancel} className="text-xs font-bold text-muted-foreground hover:text-foreground uppercase italic tracking-tight underline-offset-4 hover:underline">Cancel</button>
                <button onClick={handleSave} className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 uppercase tracking-tight bg-primary/10 px-2 py-1 rounded-md"><Save className="w-3.5 h-3.5" /> SAVE</button>
               </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {editMode && hasUnsavedChanges && (
              <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> <span>You have unsaved changes.</span>
              </div>
            )}
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {renderField("First Name", "firstName")}
                {renderField("Last Name", "lastName")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {renderField("Phone", "phone", "text")}
                {renderField("Email", "email", "email")}
              </div>
              
              {type === "lead" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("State", "state", "select", US_STATES)}
                    {renderField("Source", "leadSource", "select", leadSources)}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("Score", "leadScore", "number")}
                    {renderField("Age", "age", "number")}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("DOB", "dateOfBirth", "date")}
                    <div />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("Health", "healthStatus", "select", healthStatuses)}
                    {renderField("Best Time", "bestTimeToCall", "select", bestTimes)}
                  </div>
                  {renderField("Spouse Info", "spouseInfo")}
                </>
              )}
              
              {type === "client" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("Policy Type", "policyType", "select", policyTypes)}
                    {renderField("Carrier", "carrier")}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("Policy #", "policyNumber")}
                    {renderField("Premium", "premiumAmount")}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {renderField("Face Amount", "faceAmount")}
                    {renderField("Issue Date", "issueDate", "date")}
                  </div>
                </>
              )}
              
              {type === "recruit" && (
                <div className="flex flex-col gap-2">
                   {renderField("Status", "status", "select", recruitStatuses)}
                </div>
              )}
              
              <div className="bg-muted/50 rounded-lg px-3 py-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">Assigned Agent</label>
                {editMode ? (
                  <select value={editForm.assignedAgentId || ""} onChange={e => handleFieldChange("assignedAgentId", e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
                  </select>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${contact.assignedAgentId ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <CopyField value={getAgentDisplayName(contact.assignedAgentId)} />
                  </div>
                )}
              </div>
              
              {/* Only show overview notes map in overview, detailed notes are in tabs */}
              <div>{renderField("System Notes", "notes", "textarea")}</div>
            </div>
            
            <div className="mt-auto pt-4 border-t border-border">
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-sm text-destructive hover:underline">
                <Trash2 className="w-3.5 h-3.5" /> Delete {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN - Conversations */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/20">
          <div className="px-6 h-14 border-b border-border flex items-center justify-between shrink-0 bg-card z-10">
             <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Conversations</h3>
             </div>
             <div className="flex bg-muted rounded-lg p-0.5">
                {["All", "Calls", "SMS", "Email"].map(f => (
                  <button key={f} onClick={() => setConvoFilter(f as any)} className={cn(
                    "px-3 py-1 rounded-md text-[10px] font-bold transition-all uppercase tracking-tight",
                    convoFilter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}>{f}</button>
                ))}
             </div>
          </div>

          
          {/* Thread Area */}
          <div ref={threadRef} className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-4 bg-muted/30">
            {convoLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!convoLoading && filteredConvos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                 <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center mb-3">
                    <MessageSquare className="w-5 h-5 text-muted-foreground" />
                 </div>
                 <h4 className="text-sm font-medium text-foreground">No conversations yet</h4>
                 <p className="text-xs text-muted-foreground mt-1 max-w-xs">Calls, texts, and emails with this {type} will appear here.</p>
              </div>
            )}
            
            {!convoLoading && filteredConvos.map(item => {
              if (item._type === "call") {
                return (
                  <div key={item.id} className="flex justify-center my-2">
                    <div className="bg-card border border-border rounded-2xl px-5 py-3 text-sm shadow-sm max-w-[85%]">
                      <div className="flex items-center justify-between gap-6 mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${item.direction === 'inbound' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}`}>
                             <Phone className="w-3 h-3" />
                          </div>
                          <span className="font-medium text-foreground text-[13px]">{item.direction === "outbound" ? "Outbound Call" : "Inbound Call"}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-medium">{item.duration > 0 ? `${Math.floor(item.duration/60)}:${String(item.duration%60).padStart(2,'0')}` : 'No Answer'}</span>
                      </div>
                      <div className="flex items-center justify-between ml-8">
                         {item.disposition_name ? (
                           <span className="text-[11px] bg-accent text-foreground px-2 py-0.5 rounded-md">{item.disposition_name}</span>
                         ) : <span />}
                         <p className="text-[10px] text-muted-foreground">{new Date(item.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                      </div>
                      {item.recording_url && (
                        <div className="ml-8 mt-2.5 pt-2.5 border-t border-border/50">
                           <button className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"><Play className="w-3.5 h-3.5" /> Play Recording</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              
              const isOutbound = item.direction === "outbound";
              
              if (item._type === "sms") {
                return (
                  <div key={item.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                    <div className={`flex flex-col max-w-[75%] ${isOutbound ? "items-end" : "items-start"}`}>
                       <div className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed shadow-sm ${isOutbound ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-card border border-border text-foreground rounded-bl-sm"}`}>
                         <p>{item.body}</p>
                       </div>
                       <p className="text-[10px] text-muted-foreground mt-1 mx-1">{new Date(item.sent_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                    </div>
                  </div>
                );
              }
              
              if (item._type === "email") {
                return (
                  <div key={item.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                    <div className={`flex flex-col max-w-[85%] ${isOutbound ? "items-end" : "items-start"}`}>
                       <div className={`rounded-xl px-5 py-3.5 text-[13px] leading-relaxed shadow-sm border ${isOutbound ? "bg-card border-border text-foreground rounded-br-sm" : "bg-card border-border text-foreground rounded-bl-sm"}`}>
                         <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</span>
                         </div>
                         <p>{item.body}</p>
                       </div>
                       <p className="text-[10px] text-muted-foreground mt-1 mx-1">{new Date(item.sent_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
          
          {/* Composer */}
          <div className="bg-card border-t border-border p-4 shrink-0 shadow-sm z-10 relative">
             <div className="flex gap-1.5 mb-3">
               {["SMS", "Email"].map(t => (
                 <button key={t} onClick={() => setComposeTab(t as any)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${composeTab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{t}</button>
               ))}
             </div>
             <div className="flex flex-col gap-2 bg-accent/50 p-2 rounded-xl border border-border focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
                {composeTab === "Email" && (
                   <input 
                     value={emailSubject}
                     onChange={e => setEmailSubject(e.target.value)}
                     placeholder="Subject Line"
                     className="w-full px-3 py-2 bg-transparent text-sm font-bold border-b border-border/50 focus:outline-none placeholder:text-muted-foreground/50"
                   />
                )}
                <div className="flex items-end gap-2">
                  <textarea 
                     value={composeText} 
                     onChange={e => { setComposeText(e.target.value); }} 
                     placeholder={composeTab === "Email" ? "Write your email content..." : `Message ${contact.firstName || 'contact'}...`}
                     rows={Math.max(1, Math.min(6, composeText.split('\n').length))}
                     className="flex-1 min-h-[40px] max-h-[200px] px-3 py-2.5 bg-transparent resize-none text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.shiftKey && composeTab === "SMS") {
                         e.preventDefault();
                         handleSendMessage();
                       }
                     }}
                  />
                  <div className="flex items-center gap-1 mb-1 shadow-sm bg-card/50 rounded-lg p-1 border">
                    <button onClick={() => toast.info("Templates coming soon")} className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
                       <FileText className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={handleSendMessage} 
                      disabled={!composeText.trim() || messageSending || (composeTab === "SMS" && !contact.phone) || (composeTab === "Email" && !contact.email)}
                      className="h-9 px-4 rounded-md bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-all shrink-0 shadow-sm"
                    >
                       {messageSending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                    </button>
                  </div>
                </div>
              </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Activity/Notes/Campaigns */}
        <div className="w-[320px] xl:w-[350px] 2xl:w-[380px] bg-card border-l border-border flex flex-col min-h-0 shadow-sm z-10 shrink-0">
          <div className="px-4 h-14 border-b border-border shrink-0 bg-muted/10 flex items-center justify-center">
            <div className="flex bg-muted rounded-lg p-0.5 w-full">
              <button onClick={() => setRightTab("Activity")} className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tight",
                rightTab === "Activity" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}>Activity</button>
              <button onClick={() => setRightTab("Notes")} className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tight",
                rightTab === "Notes" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}>Notes</button>
               {type === "lead" && (
                  <button onClick={() => setRightTab("Campaigns")} className={cn(
                    "flex-1 px-3 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tight",
                    rightTab === "Campaigns" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}>Campaigns</button>
               )}
            </div>
          </div>

          
          <div className="flex-1 overflow-y-auto w-full">
            {/* ACTIVITY TAB */}
            {rightTab === "Activity" && (
              <div className="px-5 py-5 space-y-4">
                 <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent Timeline</p>
                 <div className="space-y-2 pb-4">
                   {activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((a, i) => (
                     <div key={a.id} className="border-l-2 border-primary/30 pl-3 py-2 hover:bg-muted/50 rounded-r-md transition-colors">
                       <p className="text-[13px] text-foreground leading-snug">{a.description}</p>
                       <p className="text-xs text-muted-foreground mt-1">{timeAgo(a.createdAt)} • {a.agentName}</p>
                     </div>
                   ))}
                   {activities.length === 0 && (
                     <div className="pl-5 pt-2">
                       <p className="text-xs text-muted-foreground">No activity recorded yet</p>
                     </div>
                   )}
                 </div>
              </div>
            )}
            
            {/* NOTES TAB */}
            {rightTab === "Notes" && (
              <div className="px-5 py-5 flex flex-col h-full">
                <div className="space-y-3 shrink-0 mb-6">
                  <textarea 
                     value={newNote} 
                     onChange={e => { setNewNote(e.target.value); if (noteError) setNoteError(""); }} 
                     placeholder="Type a new note..." 
                     rows={3} 
                     className="w-full h-auto px-3 py-2.5 rounded-xl bg-accent/50 text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all resize-none" 
                  />
                  {noteError && <p className="text-xs text-red-500">{noteError}</p>}
                  <div className="flex items-center justify-between">
                     <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                       <input type="checkbox" checked={pinNewNote} onChange={e => setPinNewNote(e.target.checked)} className="rounded" />
                       Pin to top
                     </label>
                     <Button size="sm" onClick={handleAddNote} className="h-8 text-xs px-4">Add Note</Button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto -mx-4 px-4 pb-4">
                   {localNotes.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FileText className="w-8 h-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-foreground font-medium">No Notes Yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Important details and context will be stored here.</p>
                     </div>
                   ) : (
                     <div className="space-y-3">
                       {localNotes.map(n => (
                         <div key={n.id} className={`rounded-xl border border-border p-3.5 bg-card shadow-sm ${n.pinned ? "ring-1 ring-yellow-500/50 bg-yellow-500/5" : ""}`}>
                            <div className="flex items-start justify-between gap-3">
                               <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap flex-1">{n.note}</p>
                               <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                                 <button onClick={() => handleTogglePin(n)} className="p-1.5 rounded hover:bg-accent transition-colors" title={n.pinned ? "Unpin note" : "Pin note"}>
                                     <Pin className={`w-3.5 h-3.5 ${n.pinned ? "text-yellow-500 fill-yellow-500 rotate-45" : "text-muted-foreground hover:text-foreground"}`} />
                                 </button>
                                 <button onClick={() => setDeleteNoteId(n.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                 </button>
                               </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground font-medium">
                               <span>{n.agentName}</span>
                               <span>{new Date(n.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                            </div>
                         </div>
                       ))}
                     </div>
                   )}
                </div>
              </div>
            )}
            
            {/* CAMPAIGNS TAB */}
            {rightTab === "Campaigns" && type === "lead" && (
               <div className="px-5 py-5">
                  {campaigns.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                       <p className="text-sm text-foreground font-medium">Not in any campaigns</p>
                       <p className="text-xs text-muted-foreground mt-1">This lead is not currently part of any dialer campaigns.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                       {campaigns.map(c => (
                         <div key={c.id} className="border border-border rounded-xl p-4 bg-card shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                               <h4 className="font-semibold text-sm text-foreground truncate">{c.name}</h4>
                               <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.status === 'Active' ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>{c.status}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                               <span className="capitalize">{c.type || 'Personal'}</span>
                            </div>
                         </div>
                       ))}
                    </div>
                  )}
               </div>
            )}
          </div>
        </div>
        
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {type}</DialogTitle>
            <DialogDescription>Delete {formatName(`${contact.firstName || ''} ${contact.lastName || ''}`.trim())}? This permanently removes all associated data.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { await onDelete(contact.id); setConfirmDelete(false); onClose(); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard Changes?</DialogTitle>
            <DialogDescription>You have unsaved edits in the contact profile. Leave without saving?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>Keep Editing</Button>
            <Button onClick={() => { setConfirmDiscard(false); onClose(); }}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!deleteNoteId} onOpenChange={() => setDeleteNoteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Note</DialogTitle>
            <DialogDescription>Are you sure you want to delete this note?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteNoteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteNoteId && handleDeleteNote(deleteNoteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppointmentModal
        open={showAppt}
        onClose={() => setShowAppt(false)}
        onSave={async (data) => {
          const startDate = new Date(data.date);
          const tp = data.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (tp) { let h = parseInt(tp[1]); const m = parseInt(tp[2]); const ap = tp[3].toUpperCase(); if (ap === "PM" && h !== 12) h += 12; if (ap === "AM" && h === 12) h = 0; startDate.setHours(h, m, 0, 0); }
          const endDate = new Date(data.date);
          const ep = data.endTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (ep) { let h = parseInt(ep[1]); const m = parseInt(ep[2]); const ap = ep[3].toUpperCase(); if (ap === "PM" && h !== 12) h += 12; if (ap === "AM" && h === 12) h = 0; endDate.setHours(h, m, 0, 0); }
          
          const { error } = await supabase.from('appointments').insert([{ title: data.title, contact_name: data.contactName, contact_id: contact?.id, contact_type: type, type: data.type, start_time: startDate.toISOString(), end_time: endDate.toISOString(), notes: data.notes }]);
          if (error) { toast.error("Failed to schedule appointment"); return; }
          
          addAppointment(data);
          logActivity(`Appointment scheduled for ${new Date(data.date).toLocaleDateString()}`, "appointment");
          setShowAppt(false);
          toast.success("Appointment scheduled");
        }}
        prefillContactName={contact ? `${contact.firstName} ${contact.lastName}` : undefined}
      />
    </div>
  );
};

export default FullScreenContactView;
