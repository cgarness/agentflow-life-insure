import React, { useState, useEffect, useRef } from "react";
import {
  X, Phone, Mail, Calendar, ArrowRight, Pencil, Trash2,
  GitMerge, Clock, Pin, Headphones, FileText, RefreshCw,
  MessageSquare, ChevronDown,
} from "lucide-react";
import { ContactLocalTime } from "@/components/shared/ContactLocalTime";
import { Lead, LeadStatus, ContactNote, ContactActivity, Call } from "@/lib/types";
import { mockUsers, mockCalls, calcAging, getAgentName } from "@/lib/mock-data";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
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

function generateMockHistory(lead: Lead): HistoryItem[] {
  const agentName = getAgentName(lead.assignedAgentId);
  const contactName = `${lead.firstName} ${lead.lastName}`;
  return [
    { id: `h1-${lead.id}`, type: "call", description: `Call by ${agentName} — 3:42 — Left Voicemail`, timestamp: new Date(Date.now() - 2 * 3600000).toISOString(), agentName },
    { id: `h2-${lead.id}`, type: "appointment", description: `Appointment: Sales Call on ${new Date(Date.now() + 2 * 86400000).toLocaleDateString()} at 10:00 AM — Scheduled`, timestamp: new Date(Date.now() - 4 * 3600000).toISOString(), agentName },
    { id: `h3-${lead.id}`, type: "email", description: `Email sent to ${contactName}`, detail: "Email available after SMTP is configured", timestamp: new Date(Date.now() - 86400000).toISOString(), agentName },
    { id: `h4-${lead.id}`, type: "call", description: `Call by ${agentName} — 7:15 — Interested`, timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), agentName },
    { id: `h5-${lead.id}`, type: "sms", description: `SMS sent to ${lead.phone}`, detail: "SMS available after Telnyx is configured", timestamp: new Date(Date.now() - 3 * 86400000).toISOString(), agentName },
    { id: `h6-${lead.id}`, type: "appointment", description: `Appointment: Follow Up on ${new Date(Date.now() - 5 * 86400000).toLocaleDateString()} at 2:00 PM — Completed`, timestamp: new Date(Date.now() - 5 * 86400000).toISOString(), agentName },
    { id: `h7-${lead.id}`, type: "call", description: `Call by ${agentName} — 1:20 — No Answer`, timestamp: new Date(Date.now() - 6 * 86400000).toISOString(), agentName },
  ];
}

const historyIconConfig: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  call: { bg: "bg-blue-100", text: "text-blue-600", icon: <Phone className="w-3.5 h-3.5" /> },
  email: { bg: "bg-green-100", text: "text-green-600", icon: <Mail className="w-3.5 h-3.5" /> },
  sms: { bg: "bg-teal-100", text: "text-teal-600", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  appointment: { bg: "bg-purple-100", text: "text-purple-600", icon: <Calendar className="w-3.5 h-3.5" /> },
};

const historyFilterMap: Record<string, string> = { Calls: "call", Emails: "email", SMS: "sms", Appointments: "appointment" };

// ---- Other mock generators ----
function generateMockActivities(lead: Lead): ContactActivity[] {
  const existing = mockActivities.filter(a => a.contactId === lead.id);
  if (existing.length > 0) return existing;
  const agentName = getAgentName(lead.assignedAgentId);
  return [
    { id: `ga1-${lead.id}`, contactId: lead.id, contactType: "lead", type: "import", description: "Lead imported via CSV", agentId: lead.assignedAgentId, agentName, createdAt: lead.createdAt },
    { id: `ga2-${lead.id}`, contactId: lead.id, contactType: "lead", type: "status", description: `Status changed from New to ${lead.status}`, agentId: lead.assignedAgentId, agentName, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: `ga3-${lead.id}`, contactId: lead.id, contactType: "lead", type: "call", description: `Called by ${agentName} — 3:42 — Left Voicemail`, agentId: lead.assignedAgentId, agentName, createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: `ga4-${lead.id}`, contactId: lead.id, contactType: "lead", type: "note", description: `Note added by ${agentName}`, agentId: lead.assignedAgentId, agentName, createdAt: new Date(Date.now() - 3600000).toISOString() },
  ];
}

function generateMockCalls(lead: Lead): Call[] {
  const existing = mockCalls.filter(c => c.contactId === lead.id);
  if (existing.length > 0) return existing;
  const agentName = getAgentName(lead.assignedAgentId);
  return [
    { id: `gc1-${lead.id}`, contactId: lead.id, contactType: "lead", contactName: `${lead.firstName} ${lead.lastName}`, agentId: lead.assignedAgentId, agentName, direction: "outbound", duration: 222, disposition: "Left Voicemail", createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: `gc2-${lead.id}`, contactId: lead.id, contactType: "lead", contactName: `${lead.firstName} ${lead.lastName}`, agentId: lead.assignedAgentId, agentName, direction: "outbound", duration: 463, disposition: "Interested", notes: "Discussed term options", createdAt: new Date(Date.now() - 86400000).toISOString() },
  ];
}

function generateMockNotes(lead: Lead): ContactNote[] {
  const existing = mockNotes.filter(n => n.contactId === lead.id);
  if (existing.length > 0) return existing;
  const agentName = getAgentName(lead.assignedAgentId);
  return [
    { id: `gn1-${lead.id}`, contactId: lead.id, contactType: "lead", note: "Initial contact made. Expressed interest in term life coverage.", pinned: true, agentId: lead.assignedAgentId, agentName, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: `gn2-${lead.id}`, contactId: lead.id, contactType: "lead", note: "Follow-up scheduled for next week.", pinned: false, agentId: lead.assignedAgentId, agentName, createdAt: new Date(Date.now() - 86400000).toISOString() },
  ];
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
  const [calls, setCalls] = useState<Call[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"All" | "Calls" | "Emails" | "SMS" | "Appointments">("All");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<LeadStatus>(lead?.status ?? "New");
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const statusDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    async function loadData() {
      if (!lead) return;
      setEditForm({ ...lead });

      const [fetchedNotes, fetchedActivities] = await Promise.all([
        notesSupabaseApi.getByContact(lead.id),
        activitiesSupabaseApi.getByContact(lead.id)
      ]);

      setLocalNotes(fetchedNotes);
      setActivities(fetchedActivities);
      setCalls(generateMockCalls(lead));
      setHistoryItems(generateMockHistory(lead));
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
    }
    loadData();
  }, [lead]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
    };
    if (statusDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusDropdownOpen]);

  if (!lead) return null;

  const agents = mockUsers.filter(u => u.status === "Active");

  const handleStatusChange = async (newStatus: LeadStatus) => {
    setStatusDropdownOpen(false);
    setLocalStatus(newStatus);
    setEditForm(f => ({ ...f, status: newStatus }));
    await onUpdate(lead.id, { status: newStatus });
    await activitiesSupabaseApi.add({ contactId: lead.id, contactType: "lead", type: "status", description: `Status changed to ${newStatus}`, agentId: "u1" });
    toast.success(`Status updated to ${newStatus}`);
  };

  const handleFieldChange = (key: string, value: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    setEditForm(f => ({ ...f, [key]: value }));
    setHasChanges(true);
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
          const agentName = getAgentName((editForm as any)[key]); // eslint-disable-line @typescript-eslint/no-explicit-any
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
    setErrors({});
  };

  const tryClose = () => {
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

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const inputCls = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";
  const selectCls = inputCls;

  const renderField = (label: string, key: string, type: "text" | "email" | "number" | "select" | "textarea" | "date" = "text", options?: string[]) => {
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
          <div className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{val || "—"}</div>
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
                    {allStatuses.map(s => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={`w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2 transition-all duration-150 ${localStatus === s ? "font-semibold" : ""}`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor[s]}`} />
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
              <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm font-medium" disabled><MessageSquare className="size-4 mr-1" />SMS</Button></span></TooltipTrigger><TooltipContent>Configure Telnyx in Settings</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm font-medium" disabled><Mail className="size-4 mr-1" />Email</Button></span></TooltipTrigger><TooltipContent>Configure SMTP in Settings</TooltipContent></Tooltip>
              <Button className="px-4 py-2.5 text-sm font-medium bg-purple-500 hover:bg-purple-600 text-white" onClick={() => setShowAppointmentModal(true)}><Calendar className="size-4 mr-1" />Schedule</Button>
              <Button className="px-4 py-2.5 text-sm font-medium bg-green-500 hover:bg-green-600 text-white" onClick={() => setConfirmConvert(true)}><ArrowRight className="size-4 mr-1" />Convert</Button>
              <Button variant="ghost" className="px-4 py-2.5 text-sm font-medium" onClick={() => { if (editMode) handleCancel(); else setEditMode(true); }}><Pencil className="size-4" /></Button>
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
                    <div className="grid grid-cols-2 gap-4">
                      {renderField("First Name", "firstName")}
                      {renderField("Last Name", "lastName")}
                      {renderField("Phone", "phone")}
                      {renderField("Email", "email", "email")}
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
                    {editMode && (
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleSave}>Save Changes</Button>
                        <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                      </div>
                    )}
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
                    {calls.length === 0 ? (
                      <div className="text-center py-12">
                        <Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No calls recorded yet</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-muted-foreground border-b">
                              <th className="text-left py-2 font-medium">Date</th>
                              <th className="text-left py-2 font-medium">Agent</th>
                              <th className="text-left py-2 font-medium">Duration</th>
                              <th className="text-left py-2 font-medium">Disposition</th>
                              <th className="text-left py-2 font-medium">Notes</th>
                              <th className="py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {calls.map(c => (
                              <tr key={c.id} className="border-b last:border-0">
                                <td className="py-2.5 text-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                                <td className="py-2.5 text-foreground">{c.agentName}</td>
                                <td className="py-2.5 text-foreground">{formatDuration(c.duration)}</td>
                                <td className="py-2.5"><span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{c.disposition || "—"}</span></td>
                                <td className="py-2.5 text-muted-foreground">{c.notes || "—"}</td>
                                <td className="py-2.5">
                                  <Tooltip><TooltipTrigger asChild><span><Button size="sm" variant="outline" disabled className="text-xs">Play</Button></span></TooltipTrigger><TooltipContent>Recording available after Telnyx is connected</TooltipContent></Tooltip>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT 35% — ACTIVITY TIMELINE */}
            <div className="w-[35%] flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
                <h3 className="text-sm font-semibold text-foreground">Activity Timeline</h3>
                <button className="text-muted-foreground hover:text-foreground"><RefreshCw className="w-4 h-4" /></button>
              </div>
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
      <Dialog open={confirmConvert} onOpenChange={setConfirmConvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Client</DialogTitle>
            <DialogDescription>
              Convert {lead.firstName} {lead.lastName} to a Client? This will move them to the Clients tab.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmConvert(false)}>Cancel</Button>
            <Button className="bg-green-500 hover:bg-green-600 text-white" onClick={() => { logActivity(`Converted to Client by ${AGENT_NAME}`, "convert"); setConfirmConvert(false); onClose(); toast.success("Contact converted to Client"); }}>Confirm</Button>
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
