import React, { useState, useEffect, useRef } from "react";
import {
  X, Phone, Mail, Calendar, ArrowRight, Pencil, Trash2,
  GitMerge, Clock, Pin, FileText, RefreshCw,
  MessageSquare, ChevronDown, Loader2, Play, Save, Clipboard, AlertTriangle,
} from "lucide-react";
import { ContactLocalTime } from "@/components/shared/ContactLocalTime";
import { Lead, LeadStatus, ContactNote, ContactActivity, Client, PolicyType, PipelineStage } from "@/lib/types";
import { calcAging } from "@/lib/data-helpers";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
import { conversionSupabaseApi } from "@/lib/supabase-conversion";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
const leadSources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar", "Cold Call", "TV Ad", "Radio Ad", "Other"];
const healthStatuses = ["Excellent", "Good", "Fair", "Poor"];
const bestTimes = ["Morning 8am-12pm", "Afternoon 12pm-5pm", "Evening 5pm-8pm", "Anytime"];

const statusBadgeColor: Record<string, string> = {
  New: "bg-gray-500 text-white",
  Contacted: "bg-blue-500 text-white",
  Interested: "bg-yellow-500 text-white",
  "Follow Up": "bg-orange-500 text-white",
  Hot: "bg-red-500 text-white",
  "Not Interested": "bg-gray-400 text-white",
  "Closed Won": "bg-green-500 text-white",
  "Closed Lost": "bg-red-700 text-white",
};

const statusDotColor: Record<string, string> = {
  New: "bg-gray-500",
  Contacted: "bg-blue-500",
  Interested: "bg-yellow-500",
  "Follow Up": "bg-orange-500",
  Hot: "bg-red-500",
  "Not Interested": "bg-gray-400",
  "Closed Won": "bg-green-500",
  "Closed Lost": "bg-red-700",
};

function scoreColor(s: number) {
  if (s >= 9) return "bg-green-500 text-white";
  if (s >= 7) return "bg-yellow-500 text-white";
  if (s >= 4) return "bg-orange-500 text-white";
  return "bg-red-500 text-white";
}

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

// ---- History types & mock data ----
interface HistoryItem {
  id: string;
  type: "call" | "email" | "sms" | "appointment";
  description: string;
  detail?: string;
  timestamp: string;
  agentName: string;
}



const historyIconConfig: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  call: { bg: "bg-blue-100", text: "text-blue-600", icon: <Phone className="w-3.5 h-3.5" /> },
  email: { bg: "bg-green-100", text: "text-green-600", icon: <Mail className="w-3.5 h-3.5" /> },
  sms: { bg: "bg-teal-100", text: "text-teal-600", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  appointment: { bg: "bg-purple-100", text: "text-purple-600", icon: <Calendar className="w-3.5 h-3.5" /> },
};

const historyFilterMap: Record<string, string> = { Calls: "call", Emails: "email", SMS: "sms", Appointments: "appointment" };

interface CallRecord {
  id: string;
  created_at: string;
  duration: number | null;
  disposition: string | null;
  disposition_name: string | null;
  direction: string | null;
  recording_url: string | null;
  caller_id_used: string | null;
}


const activityIcon = (type: string) => {
  switch (type) {
    case "call": return <Phone className="w-3.5 h-3.5" />;
    case "note": return <FileText className="w-3.5 h-3.5" />;
    case "status": return <Pencil className="w-3.5 h-3.5" />;
    case "appointment": return <Calendar className="w-3.5 h-3.5" />;
    case "import": return <ArrowRight className="w-3.5 h-3.5" />;
    case "convert": return <ArrowRight className="w-3.5 h-3.5" />;
    default: return <Clock className="w-3.5 h-3.5" />;
  }
};

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

const CopyField: React.FC<{ value?: string | number | null }> = ({ value }) => {
  if (!value && value !== 0) return <span className="text-muted-foreground">—</span>;
  const display = String(value);
  return (
    <div className="flex items-center justify-between group w-full">
      <span className="text-foreground font-medium">{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(display); toast.success("Copied to clipboard"); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
      >
        <Clipboard className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface ContactModalProps {
  lead: Lead | null;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Lead>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvert?: (lead: Lead) => void;
}

const ContactModal: React.FC<ContactModalProps> = ({ lead, onClose, onUpdate, onDelete, onConvert }) => {
  const { addAppointment } = useCalendar();
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"Overview" | "Notes" | "History" | "Calls">("Overview");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [localNotes, setLocalNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [pinNewNote, setPinNewNote] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"All" | "Calls" | "Emails" | "SMS" | "Appointments">("All");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<LeadStatus>(lead?.status ?? "New");
  const [showSmsCompose, setShowSmsCompose] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const [convertStep, setConvertStep] = useState<"form" | "confirm">("form");
  const [policyForm, setPolicyForm] = useState<Partial<Client>>({
    policyType: "Term",
    carrier: "",
    policyNumber: "",
    premiumAmount: "",
    faceAmount: "",
    issueDate: new Date().toISOString().split("T")[0],
  });
  const [converting, setConverting] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [rightTab, setRightTab] = useState<"Activity" | "Conversations">("Activity");
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoItems, setConvoItems] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [convoFilter, setConvoFilter] = useState<"All" | "Calls" | "SMS" | "Email">("All");
  const [composeTab, setComposeTab] = useState<"SMS" | "Email">("SMS");
  const [composeText, setComposeText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [phoneNumbers, setPhoneNumbers] = useState<{ id: string; phone_number: string; friendly_name: string | null; is_default: boolean }[]>([]);
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");
  const [templates, setTemplates] = useState<{ id: string; name: string; type: string; subject: string | null; content: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [agents, setAgents] = useState<{ id: string; firstName: string; lastName: string }[]>([]);

  const AGENT_NAME = "Chris Garcia";

  const logActivity = (description: string, type: string) => {
    const entry: ContactActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contactId: lead?.id ?? "",
      contactType: "lead",
      type,
      description,
      agentId: "u1",
      agentName: AGENT_NAME,
      createdAt: new Date().toISOString(),
    };
    setActivities(prev => [entry, ...prev]);
    setLastUpdated(new Date().toISOString());
  };

  const handleSmsSend = async () => {
    if (!smsText.trim() || !lead) return;
    setSmsSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("You must be logged in to send messages", { duration: 5000 });
        setSmsSending(false);
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
            to: lead.phone,
            body: smsText.trim(),
            lead_id: lead.id,
          }),
        }
      );
      const result = await res.json();
      if (!result.success) {
        toast.error(result.error || "Failed to send message", { duration: 5000 });
        setSmsSending(false);
        return;
      }
      toast.success("Message sent", { duration: 3000 });
      setShowSmsCompose(false);
      setSmsText("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send message", { duration: 5000 });
    } finally {
      setSmsSending(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      if (!lead) return;
      setEditForm({ ...lead });

      const [fetchedNotes, fetchedActivities, fetchedStages] = await Promise.all([
        notesSupabaseApi.getByContact(lead.id),
        activitiesSupabaseApi.getByContact(lead.id),
        pipelineSupabaseApi.getLeadStages()
      ]);

      setLocalNotes(fetchedNotes);
      setActivities(fetchedActivities);
      setPipelineStages(fetchedStages);

      // Fetch real call history from Supabase
      setCallsLoading(true);
      const { data: callHistory } = await supabase
        .from('calls')
        .select('id, created_at, duration, disposition_name, direction, recording_url, caller_id_used')
        .eq('contact_id', lead.id)
        .order('created_at', { ascending: false });
      setCalls((callHistory as CallRecord[]) || []);
      setCallsLoading(false);
      setHistoryItems([]);

      // Fetch agents list
      const { data: profileData } = await supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active");
      if (profileData) setAgents(profileData.map((p: any) => ({ id: p.id, firstName: p.first_name || "", lastName: p.last_name || "" }))); // eslint-disable-line @typescript-eslint/no-explicit-any
      setActiveTab("Overview");
      setEditMode(false);
      setHasChanges(false);
      setErrors({});
      setNewNote("");
      setNoteError("");
      setPinNewNote(false);
      setHistoryFilter("All");
      setStatusDropdownOpen(false);
      setLocalStatus(lead.status);
      setShowAppointmentModal(false);
      setShowSmsCompose(false);
      setSmsText("");
      setSmsSending(false);
    }
    loadData();
  }, [lead]);

  useEffect(() => {
    supabase.from("phone_numbers").select("id, phone_number, friendly_name, is_default").eq("status", "active").order("is_default", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setPhoneNumbers(data);
          const def = data.find(n => n.is_default) || data[0];
          if (def) setSelectedFromNumber(def.phone_number);
        }
      });
  }, []);

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
    if (rightTab !== "Conversations" || !lead?.id) return;
    setConvoLoading(true);
    Promise.all([
      supabase.from("calls").select("id, direction, duration, disposition_name, recording_url, started_at, caller_id_used").eq("contact_id", lead.id).eq("contact_type", "lead").order("started_at", { ascending: true }),
      supabase.from("messages").select("id, direction, body, sent_at, from_number").eq("lead_id", lead.id).order("sent_at", { ascending: true })
    ]).then(([callsRes, msgsRes]) => {
      const calls = (callsRes.data || []).map(c => ({ ...c, _type: "call", _ts: new Date((c as any).started_at).getTime() })); // eslint-disable-line @typescript-eslint/no-explicit-any
      const msgs = (msgsRes.data || []).map(m => ({ ...m, _type: "sms", _ts: new Date((m as any).sent_at).getTime() })); // eslint-disable-line @typescript-eslint/no-explicit-any
      setConvoItems([...calls, ...msgs].sort((a, b) => a._ts - b._ts));
      setConvoLoading(false);
    });
  }, [rightTab, lead?.id]);

  const filtered = convoFilter === "All" ? convoItems : convoItems.filter(i => i._type === convoFilter.toLowerCase());

  useEffect(() => {
    if (rightTab === "Conversations" && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [rightTab, filtered.length]);

  if (!lead) return null;

  const getAgentDisplayName = (agentId: string) => {
    const a = agents.find(ag => ag.id === agentId);
    return a ? `${a.firstName} ${a.lastName}` : agentId;
  };

  const handleStatusChange = async (newStatus: string) => {
    setStatusDropdownOpen(false);
    setLocalStatus(newStatus as LeadStatus);
    setEditForm(f => ({ ...f, status: newStatus as LeadStatus }));
    
    // Check if this status is a conversion stage
    const stage = pipelineStages.find(s => s.name === newStatus);
    if (stage?.convertToClient) {
      setConfirmConvert(true);
      setConvertStep("form");
    }

    await onUpdate(lead.id, { status: newStatus as LeadStatus });
    await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "status", description: `Status changed to ${newStatus}`, agentId: "u1" });
    toast.success(`Status updated to ${newStatus}`);
  };

  const handleFieldChange = (key: string, value: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    setEditForm(f => ({ ...f, [key]: value }));
    setHasChanges(true);
    setHasUnsavedChanges(true);
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!editForm.firstName?.trim()) errs.firstName = "First name is required";
    if (!editForm.lastName?.trim()) errs.lastName = "Last name is required";
    if (!editForm.phone?.trim()) errs.phone = "Phone is required";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    // Detect specific field changes
    const changedFields: string[] = [];
    const fieldLabels: Record<string, string> = { firstName: "First name", lastName: "Last name", phone: "Phone number", email: "Email", state: "State", leadSource: "Lead source", leadScore: "Lead score", age: "Age", dateOfBirth: "Date of birth", healthStatus: "Health status", bestTimeToCall: "Best time to call", assignedAgentId: "Assigned agent", spouseInfo: "Spouse info", notes: "Notes" };
    for (const key of Object.keys(fieldLabels)) {
      if ((editForm as any)[key] !== (lead as any)[key]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (key === "assignedAgentId") {
          const agentName = getAgentDisplayName((editForm as any)[key]); // eslint-disable-line @typescript-eslint/no-explicit-any
          changedFields.push(`Assigned agent changed to ${agentName}`);
        } else if (key === "leadSource") {
          changedFields.push(`Lead source changed to ${(editForm as any)[key]}`); // eslint-disable-line @typescript-eslint/no-explicit-any
        } else {
          changedFields.push(`${fieldLabels[key]} updated`);
        }
      }
    }
    await onUpdate(lead.id, editForm);
    setEditMode(false);
    setHasChanges(false);
    setHasUnsavedChanges(false);

    await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "note", description: `Contact details updated by ${AGENT_NAME}`, agentId: "u1" });
    for (const cf of changedFields) {
      await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "note", description: cf, agentId: "u1" });
    }

    toast.success("Contact updated successfully");
  };

  const handleCancel = () => {
    setEditForm({ ...lead });
    setEditMode(false);
    setHasChanges(false);
    setHasUnsavedChanges(false);
    setErrors({});
  };

  const tryClose = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. Close anyway?")) return;
      onClose();
      return;
    }
    if (editMode && hasChanges) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) { setNoteError("Note cannot be empty"); return; }
    setNoteError("");

    try {
      const addedNote = await notesSupabaseApi.add(lead.id, "lead", newNote.trim(), "u1");
      setLocalNotes(prev => {
        const next = [addedNote, ...prev];
        return next.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      });
      setNewNote("");
      setPinNewNote(false);
      await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "note", description: `Note added by ${AGENT_NAME}`, agentId: "u1" });
      toast.success("Note added");
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(e.message);
    }
  };

  const handleTogglePin = async (noteId: string) => {
    toast.error("Pinning is not currently supported in DB");
  };

  const handleDeleteNote = async (noteId: string) => {
    // Delete note not implemented in DB wrapper yet; optimistic UI only for now
    setLocalNotes(prev => prev.filter(n => n.id !== noteId));
    setDeleteNoteId(null);
    await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "delete", description: `Note deleted by ${AGENT_NAME}`, agentId: "u1" });
    toast.success("Note deleted");
  };

  const inputCls = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";
  const selectCls = inputCls;

  const renderField = (label: string, key: string, type: "text" | "email" | "number" | "select" | "textarea" | "date" = "text", options?: string[], copyable?: boolean) => {
    const val = (editForm as any)[key] ?? ""; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (
      <div>
        <label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>
        {editMode ? (
          <>
            {type === "select" ? (
              <select value={val} onChange={e => handleFieldChange(key, e.target.value)} className={selectCls}>
                <option value="">—</option>
                {options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : type === "textarea" ? (
              <textarea value={val} onChange={e => handleFieldChange(key, e.target.value)} rows={3} className={`${inputCls} min-h-[72px] py-2`} />
            ) : (
              <input type={type} value={val} onChange={e => handleFieldChange(key, type === "number" ? Number(e.target.value) : e.target.value)}
                min={type === "number" && key === "leadScore" ? 1 : undefined}
                max={type === "number" && key === "leadScore" ? 10 : undefined}
                className={inputCls} />
            )}
            {errors[key] && <p className="text-xs text-red-500 mt-0.5">{errors[key]}</p>}
          </>
        ) : (
          <div className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center"><CopyField value={val} /></div>
        )}
      </div>
    );
  };

  return (
    <TooltipProvider>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={tryClose}>
        <div className="fixed inset-0 bg-black/60 transition-all duration-150" />

        {/* Modal */}
        <div
          className="relative bg-background border border-border rounded-lg shadow-2xl flex flex-col animate-in fade-in duration-150"
          style={{ width: "90vw", maxWidth: 1100, height: "90vh" }}
          onClick={e => e.stopPropagation()}
        >
          {/* ===== HERO ===== */}
          <div className="px-6 py-4 border-b border-border flex items-center gap-4 shrink-0">
            {/* Avatar + Name */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-14 h-14 rounded-full bg-blue-500 text-white flex items-center justify-center text-lg font-bold shrink-0">
                {lead.firstName[0]}{lead.lastName[0]}
              </div>
              <h2 className="text-2xl font-bold text-foreground">{lead.firstName} {lead.lastName}</h2>
            </div>
            {/* Status — centered */}
            <div className="flex-1 flex items-center justify-center">
              <div className="relative" ref={statusDropdownRef}>
                <button
                  onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                  className={`text-sm px-4 py-2 rounded-full font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${statusBadgeColor[localStatus]}`}
                >
                  {localStatus}
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {statusDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-lg shadow-md py-1 min-w-[180px]">
                    {(pipelineStages.length > 0 ? pipelineStages.map(s => s.name) : allStatuses).map(s => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={`w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2 transition-all duration-150 ${localStatus === s ? "font-semibold" : ""}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor[s] || "bg-gray-400"}`} />
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <Button className="px-4 py-2.5 text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white" onClick={() => { logActivity(`Call initiated by ${AGENT_NAME}`, "call"); toast.info("Dialer opening..."); }}><Phone className="size-4 mr-1" />Call</Button>
              {lead.phone ? (
                <Button variant="outline" className="px-4 py-2.5 text-sm font-medium" onClick={() => { setShowSmsCompose(true); setSmsText(""); }}><MessageSquare className="size-4 mr-1" />SMS</Button>
              ) : (
                <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm font-medium" disabled><MessageSquare className="size-4 mr-1" />SMS</Button></span></TooltipTrigger><TooltipContent>No phone number</TooltipContent></Tooltip>
              )}
              <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm font-medium" disabled><Mail className="size-4 mr-1" />Email</Button></span></TooltipTrigger><TooltipContent>Configure SMTP in Settings</TooltipContent></Tooltip>
              <Button className="px-4 py-2.5 text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white" onClick={() => setShowAppointmentModal(true)}><Calendar className="size-4 mr-1" />Schedule</Button>
              <Button className="px-4 py-2.5 text-sm font-medium bg-green-500 hover:bg-green-600 text-white" onClick={() => setConfirmConvert(true)}><ArrowRight className="size-4 mr-1" />Convert</Button>
              <Button variant="ghost" className="px-4 py-2.5 text-sm font-medium" onClick={tryClose}><X className="size-4" /></Button>
            </div>
          </div>

          {/* ===== TWO COLUMNS ===== */}
          <div className="flex flex-1 min-h-0">
            {/* LEFT 65% */}
            <div className="w-[65%] flex flex-col border-r border-border min-h-0">
              {/* Tabs */}
              <div className="flex items-center justify-between border-b border-border px-6 shrink-0">
                <div className="flex">
                  {(["Overview", "Notes", "History", "Calls"] as const).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 ${activeTab === t ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
                      {t}
                    </button>
                  ))}
                </div>
                {lead.state && (
                  <div className="flex items-center gap-1.5 ml-auto bg-[#14B8A6]/15 text-[#14B8A6] border border-[#14B8A6]/30 px-3 py-1 rounded-full text-xs font-medium">
                    <Clock className="w-3 h-3 text-[#14B8A6]" />
                    <ContactLocalTime state={lead.state} size="md" />
                  </div>
                )}
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* OVERVIEW TAB */}
                {activeTab === "Overview" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</span>
                      {!editMode
                        ? <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><Pencil className="w-3 h-3" /> Edit</button>
                        : <div className="flex items-center gap-2">
                            <button onClick={() => { setEditMode(false); setHasUnsavedChanges(false); setEditForm({ ...lead }); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                            <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"><Save className="w-3 h-3" /> Save</button>
                          </div>
                      }
                    </div>
                    {editMode && hasUnsavedChanges && (
                      <div className="mb-3 flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>You have unsaved changes.</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      {renderField("First Name", "firstName")}
                      {renderField("Last Name", "lastName")}
                      {renderField("Phone", "phone", "text", undefined, true)}
                      {renderField("Email", "email", "email", undefined, true)}
                      {renderField("State", "state", "select", US_STATES)}
                      {renderField("Status", "status", "select", allStatuses)}
                      {renderField("Lead Source", "leadSource", "select", leadSources)}
                      {renderField("Lead Score", "leadScore", "number")}
                      {renderField("Age", "age", "number")}
                      {renderField("Date of Birth", "dateOfBirth", "date")}
                      {renderField("Health Status", "healthStatus", "select", healthStatuses)}
                      {renderField("Best Time to Call", "bestTimeToCall", "select", bestTimes)}
                      {renderField("Assigned Agent", "assignedAgentId", "select", agents.map(a => a.id))}
                      {renderField("Spouse Info", "spouseInfo")}
                    </div>
                    <div>{renderField("Notes", "notes", "textarea")}</div>
                  </div>
                )}

                {/* NOTES TAB */}
                {activeTab === "Notes" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <textarea
                        value={newNote}
                        onChange={e => { setNewNote(e.target.value); if (noteError) setNoteError(""); }}
                        placeholder="Add a note about this contact..."
                        rows={3}
                        className={`${inputCls} min-h-[72px] py-2`}
                      />
                      {noteError && <p className="text-xs text-red-500">{noteError}</p>}
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                          <input type="checkbox" checked={pinNewNote} onChange={e => setPinNewNote(e.target.checked)} className="rounded" />
                          Pin note
                        </label>
                        <Button size="sm" onClick={handleAddNote}>Add Note</Button>
                      </div>
                    </div>

                    {localNotes.length === 0 ? (
                      <div className="text-center py-8">
                        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No notes yet. Add one above.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {localNotes.map(n => (
                          <div key={n.id} className={`rounded-lg border border-border p-3 bg-card ${n.pinned ? "ring-1 ring-yellow-500/30" : ""}`}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-foreground flex-1">{n.note}</p>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => handleTogglePin(n.id)} className="p-1">
                                  <Pin className={`w-3.5 h-3.5 ${n.pinned ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} />
                                </button>
                                <button onClick={() => setDeleteNoteId(n.id)} className="p-1 text-red-500 hover:text-red-600">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{n.agentName} · {timeAgo(n.createdAt)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* HISTORY TAB */}
                {activeTab === "History" && (
                  <div>
                    {/* Filter pills */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                      {(["All", "Calls", "Emails", "SMS", "Appointments"] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setHistoryFilter(f)}
                          className={`px-3 py-1 text-xs font-medium rounded-full transition-all duration-150 ${historyFilter === f
                            ? "bg-blue-500 text-white"
                            : "border border-border text-muted-foreground hover:text-foreground"
                            }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const filtered = historyFilter === "All"
                        ? historyItems
                        : historyItems.filter(h => h.type === historyFilterMap[historyFilter]);

                      const filterLabel = historyFilter === "All" ? "" : historyFilter.toLowerCase();

                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-12">
                            <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">No {filterLabel} history yet</p>
                          </div>
                        );
                      }

                      return (
                        <div>
                          {filtered
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map(item => {
                              const config = historyIconConfig[item.type];
                              return (
                                <div key={item.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0">
                                  <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${config.bg} ${config.text}`}>
                                    {config.icon}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground">{item.description}</p>
                                    {item.detail && (
                                      <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                                    {timeAgo(item.timestamp)}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* CALLS TAB */}
                {activeTab === "Calls" && (
                  <div>
                    {callsLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="animate-pulse flex items-center gap-4 py-3 border-b border-border">
                            <div className="h-6 w-20 bg-muted rounded-full" />
                            <div className="h-4 w-32 bg-muted rounded" />
                            <div className="h-4 w-16 bg-muted rounded" />
                            <div className="h-6 w-24 bg-muted rounded-full" />
                            <div className="flex-1" />
                            <div className="h-4 w-20 bg-muted rounded" />
                          </div>
                        ))}
                      </div>
                    ) : calls.length === 0 ? (
                      <div className="text-center py-12">
                        <Phone className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">No calls yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Calls will appear here after the first call is made.</p>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {calls.map(c => {
                          const dur = c.duration && c.duration > 0
                            ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s`
                            : "No answer";
                          const isInbound = c.direction === "inbound";
                          return (
                            <div key={c.id} className="py-3 border-b border-border last:border-0">
                              <div className="flex items-center gap-3">
                                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isInbound ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                                  {isInbound ? "Inbound" : "Outbound"}
                                </span>
                                <span className="text-sm text-foreground">
                                  {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-sm text-muted-foreground">{dur}</span>
                                {(c.disposition || c.disposition_name) ? (
                                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                    {c.disposition || c.disposition_name}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">No disposition</span>
                                )}
                              </div>
                              <div className="mt-2">
                                {c.recording_url ? (
                                  <audio controls className="w-full h-8" preload="none">
                                    <source src={c.recording_url} type="audio/mpeg" />
                                  </audio>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No recording</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT 35% — ACTIVITY / CONVERSATIONS */}
            <div className="w-[35%] flex flex-col min-h-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <div className="flex bg-accent rounded-lg p-1 gap-1">
                  <button onClick={() => setRightTab("Activity")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${rightTab === "Activity" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Activity</button>
                  <button onClick={() => setRightTab("Conversations")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${rightTab === "Conversations" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Conversations</button>
                </div>
              </div>
              {rightTab === "Activity" && (
                <>
                  <p className="text-xs text-muted-foreground px-4 pt-2">Last updated {timeAgo(lastUpdated)}</p>
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((a, i) => (
                      <div key={a.id} className={`flex items-start gap-2 ${i === 0 ? "animate-fade-in" : ""}`}>
                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${activityDotColor(a.type)}`} />
                        <div>
                          <p className="text-xs text-foreground leading-tight">{a.description}</p>
                          <p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                    {activities.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>}
                  </div>
                </>
              )}
              {rightTab === "Conversations" && (
                <>
                  <div className="flex gap-2 px-4 py-2 flex-shrink-0">
                    {["All", "Calls", "SMS", "Email"].map(f => (
                      <button key={f} onClick={() => setConvoFilter(f as any)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${convoFilter === f ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{f}</button>
                    ))}
                  </div>
                  <div ref={threadRef} className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-2">
                    {convoLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!convoLoading && filtered.length === 0 && (
                      <div className="flex items-center justify-center py-8">
                        <p className="text-sm text-muted-foreground">No conversations yet</p>
                      </div>
                    )}
                    {!convoLoading && filtered.map(item => {
                      if (item._type === "call") {
                        return (
                          <div key={item.id} className="bg-accent/50 rounded-xl px-4 py-3 text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Phone className="w-4 h-4 text-primary" />
                              <span className="font-medium text-foreground">{item.direction === "outbound" ? "Outbound" : "Inbound"} Call</span>
                              {item.duration > 0 && <span className="text-muted-foreground">· {Math.floor(item.duration/60)}:{String(item.duration%60).padStart(2,'0')}</span>}
                              {item.disposition_name && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{item.disposition_name}</span>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{new Date(item.started_at).toLocaleString()}</p>
                            {item.caller_id_used && (
                              <p className="text-xs text-muted-foreground mt-0.5">From: {item.caller_id_used}</p>
                            )}
                            {item.recording_url && <button className="flex items-center gap-1 mt-1 text-xs text-primary hover:underline"><Play className="w-3 h-3" /> Play Recording</button>}
                          </div>
                        );
                      }
                      if (item._type === "sms") {
                        return (
                          <div key={item.id} className={`flex ${item.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                            <div className={`rounded-xl px-4 py-3 max-w-[80%] text-sm ${item.direction === "outbound" ? "text-white rounded-br-sm" : "bg-accent text-foreground rounded-bl-sm"}`} style={item.direction === "outbound" ? { backgroundColor: "#16a34a" } : undefined}>
                              <p>{item.body}</p>
                              <p className="text-xs mt-1 opacity-70">{new Date(item.sent_at).toLocaleString()}</p>
                              {item.from_number && (
                                <p className="text-xs mt-0.5 opacity-60">From: {item.from_number}</p>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (item._type === "email") {
                        return (
                          <div key={item.id} className={`flex ${item.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                            <div className={`rounded-xl px-4 py-3 max-w-[80%] text-sm ${item.direction === "outbound" ? "text-white rounded-br-sm" : "bg-accent text-foreground rounded-bl-sm"}`} style={item.direction === "outbound" ? { backgroundColor: "#0d9488" } : undefined}>
                              <div className="flex items-center gap-1 mb-1 opacity-80"><Mail className="w-3 h-3" /><span className="text-xs font-medium">Email</span></div>
                              <p>{item.body}</p>
                              <p className="text-xs mt-1 opacity-70">{new Date(item.sent_at).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                  <div className="border-t border-border p-3 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted-foreground flex-shrink-0">From:</span>
                      <select
                        value={selectedFromNumber}
                        onChange={e => setSelectedFromNumber(e.target.value)}
                        className="flex-1 text-xs bg-accent border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        {phoneNumbers.map(n => (
                          <option key={n.id} value={n.phone_number}>
                            {n.friendly_name ? `${n.friendly_name} (${n.phone_number})` : n.phone_number}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-1 mb-2">
                      {["SMS", "Email"].map(t => (
                        <button key={t} onClick={() => setComposeTab(t as any)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${composeTab === t ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{t}</button>
                      ))}
                    </div>
                    <div className="relative">
                      {composeTab === "Email" ? (
                        <div className="space-y-2 mb-2">
                          <input
                            type="text"
                            placeholder="Subject"
                            value={emailSubject}
                            onChange={e => setEmailSubject(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 border border-border"
                          />
                          <textarea
                            placeholder="Body"
                            value={composeText}
                            onChange={e => setComposeText(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 border border-border resize-none"
                          />
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center mb-2">
                          <input value={composeText} onChange={e => setComposeText(e.target.value)} placeholder="Type a message..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                      )}
                      <div className="flex gap-2 items-center justify-end">
                        <div className="relative">
                          <button
                            onClick={() => {
                              supabase.from("message_templates").select("id, name, type, subject, content").eq("type", composeTab.toLowerCase())
                                .then(({ data }) => { if (data) setTemplates(data); setShowTemplates(true); });
                            }}
                            className="p-2 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          {showTemplates && (
                            <div className="absolute bottom-full mb-1 right-0 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                                <span className="text-xs font-semibold text-foreground">Templates</span>
                                <button onClick={() => setShowTemplates(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                              </div>
                              {templates.length === 0
                                ? <div className="px-3 py-4 text-xs text-muted-foreground text-center">No {composeTab} templates yet</div>
                                : templates.map(t => (
                                    <button key={t.id} onClick={() => {
                                      setComposeText(t.content);
                                      if (t.subject) setEmailSubject(t.subject);
                                      setShowTemplates(false);
                                    }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent border-b border-border last:border-0 transition-colors">
                                      <div className="font-medium text-foreground text-xs">{t.name}</div>
                                      <div className="text-muted-foreground text-xs truncate mt-0.5">{t.content}</div>
                                    </button>
                                  ))
                              }
                            </div>
                          )}
                        </div>
                        <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Send</button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ===== FOOTER ===== */}
          <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4 mr-1" />Delete Contact</Button>
              <Button size="sm" variant="outline" onClick={() => { logActivity(`Merge attempted by ${AGENT_NAME}`, "merge"); toast.info("Merge feature coming soon"); }}><GitMerge className="w-4 h-4 mr-1" />Merge</Button>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground">Created: {new Date(lead.createdAt).toLocaleDateString()}</span>
              <span className="text-xs text-muted-foreground">Last updated: {new Date(lead.updatedAt).toLocaleDateString()}</span>
              <Button size="sm" variant="outline" onClick={tryClose}>Close</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Delete {lead.firstName} {lead.lastName}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { logActivity(`Contact deleted by ${AGENT_NAME}`, "delete"); await onDelete(lead.id); setConfirmDelete(false); onClose(); toast.success("Contact deleted"); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirm Dialog */}
      <Dialog open={confirmConvert} onOpenChange={(open) => { setConfirmConvert(open); if (!open) setConvertStep("form"); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{convertStep === "form" ? "Enter Policy Info" : "Confirm Conversion"}</DialogTitle>
            <DialogDescription>
              {convertStep === "form" 
                ? "Enter the policy and sale details to convert this lead to a client."
                : `Are you sure you want to convert ${lead.firstName} ${lead.lastName} to a client? This will move them to the Clients tab.`
              }
            </DialogDescription>
          </DialogHeader>

          {convertStep === "form" ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Policy Type *</label>
                  <select 
                    value={policyForm.policyType} 
                    onChange={e => setPolicyForm(f => ({ ...f, policyType: e.target.value as PolicyType }))}
                    className={selectCls}
                  >
                    {["Term", "Whole Life", "IUL", "Final Expense"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Carrier *</label>
                  <input 
                    value={policyForm.carrier} 
                    onChange={e => setPolicyForm(f => ({ ...f, carrier: e.target.value }))}
                    placeholder="e.g. Mutual of Omaha"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Policy #</label>
                  <input 
                    value={policyForm.policyNumber} 
                    onChange={e => setPolicyForm(f => ({ ...f, policyNumber: e.target.value }))}
                    placeholder="Optional"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issue Date</label>
                  <input 
                    type="date"
                    value={policyForm.issueDate} 
                    onChange={e => setPolicyForm(f => ({ ...f, issueDate: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Premium Amount *</label>
                  <input 
                    value={policyForm.premiumAmount} 
                    onChange={e => setPolicyForm(f => ({ ...f, premiumAmount: e.target.value }))}
                    placeholder="e.g. $150.00"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Face Amount *</label>
                  <input 
                    value={policyForm.faceAmount} 
                    onChange={e => setPolicyForm(f => ({ ...f, faceAmount: e.target.value }))}
                    placeholder="e.g. $500,000"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Beneficiary Name</label>
                <input 
                  value={policyForm.beneficiaryName || ""} 
                  onChange={e => setPolicyForm(f => ({ ...f, beneficiaryName: e.target.value }))}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
            </div>
          ) : (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Contact:</span>
                <span className="font-medium">{lead.firstName} {lead.lastName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Policy:</span>
                <span className="font-medium">{policyForm.policyType} - {policyForm.carrier}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Premium:</span>
                <span className="font-medium">{policyForm.premiumAmount}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            {convertStep === "form" ? (
              <>
                <Button variant="outline" onClick={() => { setConfirmConvert(false); setConvertStep("form"); }}>Cancel</Button>
                <Button 
                  className="bg-primary hover:bg-primary/90 text-primary-foreground" 
                  disabled={!policyForm.carrier || !policyForm.premiumAmount || !policyForm.faceAmount}
                  onClick={() => setConvertStep("confirm")}
                >
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setConvertStep("form")}>Back</Button>
                <Button 
                  className="bg-green-500 hover:bg-green-600 text-white" 
                  disabled={converting}
                  onClick={async () => {
                    setConverting(true);
                    try {
                      await conversionSupabaseApi.convertLeadToClient(lead, policyForm);
                      logActivity(`Converted to Client by ${AGENT_NAME}`, "convert");
                      setConfirmConvert(false);
                      setConvertStep("form");
                      onClose();
                      toast.success("Contact converted to Client successfully!");
                      if (onConvert) onConvert(lead);
                    } catch (err: any) {
                      toast.error(`Conversion failed: ${err.message}`);
                    } finally {
                      setConverting(false);
                    }
                  }}
                >
                  {converting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Confirm Conversion
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard Changes Dialog */}
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Are you sure you want to leave?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmDiscard(false)}>Stay</Button>
            <Button variant="outline" onClick={() => { setConfirmDiscard(false); setEditMode(false); setHasChanges(false); onClose(); }}>Leave Without Saving</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Note Dialog */}
      <Dialog open={!!deleteNoteId} onOpenChange={() => setDeleteNoteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Note</DialogTitle>
            <DialogDescription>Are you sure you want to delete this note? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteNoteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteNoteId && handleDeleteNote(deleteNoteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SMS Compose Dialog */}
      <Dialog open={showSmsCompose} onOpenChange={setShowSmsCompose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send SMS</DialogTitle>
            <DialogDescription>
              Send a message to {lead.firstName} {lead.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted/60 px-3 py-2">
              <p className="text-sm font-medium text-foreground">{lead.firstName} {lead.lastName}</p>
              <p className="text-xs text-muted-foreground">{lead.phone}</p>
            </div>
            <textarea
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
              placeholder="Type your message..."
              rows={4}
              className={`${inputCls} min-h-[100px] py-2`}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSmsCompose(false)}>Cancel</Button>
            <Button onClick={handleSmsSend} disabled={smsSending || !smsText.trim()}>
              {smsSending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {smsSending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Appointment Modal (from Schedule button) */}
      <AppointmentModal
        open={showAppointmentModal}
        onClose={() => setShowAppointmentModal(false)}
        onSave={async (data) => {
          // Save to Supabase
          const startDate = new Date(data.date);
          const timeParts = data.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (timeParts) {
            let hours = parseInt(timeParts[1]);
            const minutes = parseInt(timeParts[2]);
            const ampm = timeParts[3].toUpperCase();
            if (ampm === "PM" && hours !== 12) hours += 12;
            if (ampm === "AM" && hours === 12) hours = 0;
            startDate.setHours(hours, minutes, 0, 0);
          }
          const endDate = new Date(data.date);
          const endParts = data.endTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (endParts) {
            let hours = parseInt(endParts[1]);
            const minutes = parseInt(endParts[2]);
            const ampm = endParts[3].toUpperCase();
            if (ampm === "PM" && hours !== 12) hours += 12;
            if (ampm === "AM" && hours === 12) hours = 0;
            endDate.setHours(hours, minutes, 0, 0);
          }
          const { error } = await supabase.from('appointments').insert([{
            title: data.title,
            contact_name: data.contactName,
            contact_id: lead?.id,
            type: data.type,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            notes: data.notes,
          }]);
          if (error) {
            toast.error("Failed to schedule appointment");
            return;
          }
          addAppointment(data);
          logActivity(`Appointment scheduled for ${new Date(data.date).toLocaleDateString()}`, "appointment");
          setShowAppointmentModal(false);
          toast.success("Appointment scheduled");
        }}
        prefillContactName={lead ? `${lead.firstName} ${lead.lastName}` : undefined}
        prefillContactId={lead?.id}
      />
    </TooltipProvider>
  );
};

export default ContactModal;
