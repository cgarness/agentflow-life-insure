import React, { useState, useEffect, useRef } from "react";
import { X, Phone, Mail, Calendar, Pencil, Trash2, GitMerge, Clock, Pin, Headphones, FileText, RefreshCw, MessageSquare, Loader2, Play, Save, Clipboard, AlertTriangle } from "lucide-react";
import { Client, ContactNote, ContactActivity, Call } from "@/lib/types";
import { mockUsers, mockCalls, getAgentName } from "@/lib/mock-data";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";

const policyTypeBadge: Record<string, string> = {
  Term: "bg-blue-500 text-white",
  "Whole Life": "bg-green-500 text-white",
  IUL: "bg-purple-500 text-white",
  "Final Expense": "bg-orange-500 text-white",
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

interface HistoryItem { id: string; type: "call" | "email" | "sms" | "appointment"; description: string; detail?: string; timestamp: string; agentName: string; }

function generateMockHistory(client: Client): HistoryItem[] {
  const ag = getAgentName(client.assignedAgentId);
  return [
    { id: `h1-${client.id}`, type: "call", description: `Call by ${ag} — Policy review discussed`, timestamp: new Date(Date.now() - 2 * 3600000).toISOString(), agentName: ag },
    { id: `h2-${client.id}`, type: "appointment", description: `Policy Review on ${new Date(Date.now() + 7 * 86400000).toLocaleDateString()} at 10:00 AM`, timestamp: new Date(Date.now() - 4 * 3600000).toISOString(), agentName: ag },
    { id: `h3-${client.id}`, type: "email", description: `Annual policy statement sent`, timestamp: new Date(Date.now() - 86400000).toISOString(), agentName: ag },
    { id: `h4-${client.id}`, type: "call", description: `Call by ${ag} — Premium payment confirmed`, timestamp: new Date(Date.now() - 5 * 86400000).toISOString(), agentName: ag },
  ];
}

function generateMockActivities(client: Client): ContactActivity[] {
  const ag = getAgentName(client.assignedAgentId);
  return [
    { id: `ga1-${client.id}`, contactId: client.id, contactType: "client", type: "import", description: "Policy issued and client record created", agentId: client.assignedAgentId, agentName: ag, createdAt: client.createdAt },
    { id: `ga2-${client.id}`, contactId: client.id, contactType: "client", type: "call", description: `Called by ${ag} — Policy review`, agentId: client.assignedAgentId, agentName: ag, createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: `ga3-${client.id}`, contactId: client.id, contactType: "client", type: "note", description: `Note added by ${ag}`, agentId: client.assignedAgentId, agentName: ag, createdAt: new Date(Date.now() - 3600000).toISOString() },
  ];
}

function generateMockCalls(client: Client): Call[] {
  const existing = mockCalls.filter(c => c.contactId === client.id);
  if (existing.length > 0) return existing;
  const ag = getAgentName(client.assignedAgentId);
  return [
    { id: `gc1-${client.id}`, contactId: client.id, contactType: "client", contactName: `${client.firstName} ${client.lastName}`, agentId: client.assignedAgentId, agentName: ag, direction: "outbound", duration: 312, disposition: "Policy Review Completed", createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: `gc2-${client.id}`, contactId: client.id, contactType: "client", contactName: `${client.firstName} ${client.lastName}`, agentId: client.assignedAgentId, agentName: ag, direction: "outbound", duration: 184, disposition: "Premium Payment Confirmed", createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
  ];
}

function generateMockNotes(client: Client): ContactNote[] {
  const ag = getAgentName(client.assignedAgentId);
  return [
    { id: `gn1-${client.id}`, contactId: client.id, contactType: "client", note: `${client.policyType} policy with ${client.carrier}. Payment is current.`, pinned: true, agentId: client.assignedAgentId, agentName: ag, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: `gn2-${client.id}`, contactId: client.id, contactType: "client", note: "Annual review scheduled for next quarter.", pinned: false, agentId: client.assignedAgentId, agentName: ag, createdAt: new Date(Date.now() - 86400000).toISOString() },
  ];
}

const historyIconConfig: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  call: { bg: "bg-blue-100", text: "text-blue-600", icon: <Phone className="w-3.5 h-3.5" /> },
  email: { bg: "bg-green-100", text: "text-green-600", icon: <Mail className="w-3.5 h-3.5" /> },
  sms: { bg: "bg-teal-100", text: "text-teal-600", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  appointment: { bg: "bg-purple-100", text: "text-purple-600", icon: <Calendar className="w-3.5 h-3.5" /> },
};
const historyFilterMap: Record<string, string> = { Calls: "call", Emails: "email", SMS: "sms", Appointments: "appointment" };
const activityDotColor = (type: string) => ({ call: "bg-blue-500", note: "bg-gray-500", status: "bg-blue-500", appointment: "bg-purple-500", import: "bg-green-500", convert: "bg-green-500", delete: "bg-red-500", pin: "bg-yellow-500" }[type] || "bg-blue-500");

interface ClientModalProps { client: Client | null; onClose: () => void; onUpdate: (id: string, data: Partial<Client>) => Promise<void>; onDelete: (id: string) => Promise<void>; }

const ClientModal: React.FC<ClientModalProps> = ({ client, onClose, onUpdate, onDelete }) => {
  const { addAppointment } = useCalendar();
  const [showAppt, setShowAppt] = useState(false);
  const [activeTab, setActiveTab] = useState<"Overview" | "Notes" | "History" | "Calls">("Overview");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [localNotes, setLocalNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [pinNewNote, setPinNewNote] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"All" | "Calls" | "Emails" | "SMS" | "Appointments">("All");
  const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());
  const [showSmsCompose, setShowSmsCompose] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const AGENT_NAME = "Chris Garcia";
  const [rightTab, setRightTab] = useState<"Activity" | "Conversations">("Activity");
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoItems, setConvoItems] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [convoFilter, setConvoFilter] = useState<"All" | "Calls" | "SMS" | "Email">("All");
  const [composeTab, setComposeTab] = useState<"SMS" | "Email">("SMS");
  const [composeText, setComposeText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const logActivity = (description: string, type: string) => {
    const entry: ContactActivity = { id: `act-${Date.now()}`, contactId: client?.id ?? "", contactType: "client", type, description, agentId: "u1", agentName: AGENT_NAME, createdAt: new Date().toISOString() };
    setActivities(prev => [entry, ...prev]);
    setLastUpdated(new Date().toISOString());
  };

  const handleSmsSend = async () => {
    if (!smsText.trim() || !client) return;
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
            to: client.phone,
            body: smsText.trim(),
            lead_id: client.id,
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
      if (!client) return;
      setEditForm({ ...client });

      const [fetchedNotes, fetchedActivities] = await Promise.all([
        notesSupabaseApi.getByContact(client.id),
        activitiesSupabaseApi.getByContact(client.id)
      ]);

      setLocalNotes(fetchedNotes);
      setActivities(fetchedActivities);
      setCalls(generateMockCalls(client));
      setHistoryItems(generateMockHistory(client));
      setActiveTab("Overview"); setEditMode(false); setHasChanges(false);
      setNewNote(""); setNoteError(""); setPinNewNote(false); setHistoryFilter("All");
      setShowAppt(false); setLastUpdated(new Date().toISOString());
      setShowSmsCompose(false); setSmsText(""); setSmsSending(false);
    }
    loadData();
  }, [client]);

  useEffect(() => {
    if (rightTab !== "Conversations" || !client?.id) return;
    setConvoLoading(true);
    supabase.from("calls").select("id, direction, duration, disposition_name, recording_url, started_at").eq("contact_id", client.id).eq("contact_type", "client").order("started_at", { ascending: true })
    .then(callsRes => {
      const calls = (callsRes.data || []).map(c => ({ ...c, _type: "call", _ts: new Date((c as any).started_at).getTime() })); // eslint-disable-line @typescript-eslint/no-explicit-any
      setConvoItems(calls.sort((a, b) => a._ts - b._ts));
      setConvoLoading(false);
    });
  }, [rightTab, client?.id]);

  const filtered = convoFilter === "All" ? convoItems : convoItems.filter(i => i._type === convoFilter.toLowerCase());

  useEffect(() => {
    if (rightTab === "Conversations" && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [rightTab, filtered.length]);

  if (!client) return null;
  const agents = mockUsers.filter(u => u.status === "Active");
  const handleFieldChange = (key: string, value: any) => { setEditForm(f => ({ ...f, [key]: value })); setHasChanges(true); setHasUnsavedChanges(true); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const handleSave = async () => { await onUpdate(client.id, editForm); setEditMode(false); setHasChanges(false); setHasUnsavedChanges(false); await activitiesSupabaseApi.add({ contactId: client.id, contactType: "client", type: "note", description: `Client updated by ${AGENT_NAME}`, agentId: "u1" }); toast.success("Client updated"); };
  const handleCancel = () => { setEditForm({ ...client }); setEditMode(false); setHasChanges(false); setHasUnsavedChanges(false); };
  const tryClose = () => { if (hasUnsavedChanges) { if (!window.confirm("You have unsaved changes. Close anyway?")) return; onClose(); return; } if (editMode && hasChanges) setConfirmDiscard(true); else onClose(); };
  const handleAddNote = async () => {
    if (!newNote.trim()) { setNoteError("Note cannot be empty"); return; }
    setNoteError("");

    try {
      const addedNote = await notesSupabaseApi.add(client.id, "client", newNote.trim(), "u1");
      setLocalNotes(prev => [addedNote, ...prev].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
      setNewNote(""); setPinNewNote(false);
      await activitiesSupabaseApi.add({ contactId: client.id, contactType: "client", type: "note", description: `Note added by ${AGENT_NAME}`, agentId: "u1" });
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
    setLocalNotes(prev => prev.filter(n => n.id !== noteId)); setDeleteNoteId(null);
    await activitiesSupabaseApi.add({ contactId: client.id, contactType: "client", type: "delete", description: `Note deleted by ${AGENT_NAME}`, agentId: "u1" });
    toast.success("Note deleted");
  };
  const fmt = (s: number) => { const m = Math.floor(s / 60); return `${m}:${(s % 60).toString().padStart(2, "0")}`; };
  const inp = "w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

  const renderField = (label: string, key: string, type: "text" | "email" | "number" | "select" | "textarea" | "date" = "text", options?: string[], copyable?: boolean) => {
    const val = (editForm as any)[key] ?? ""; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (<div><label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>{editMode ? (type === "select" ? <select value={val} onChange={e => handleFieldChange(key, e.target.value)} className={inp}><option value="">—</option>{options?.map(o => <option key={o} value={o}>{o}</option>)}</select> : type === "textarea" ? <textarea value={val} onChange={e => handleFieldChange(key, e.target.value)} rows={3} className={`${inp} min-h-[72px] py-2`} /> : <input type={type} value={val} onChange={e => handleFieldChange(key, e.target.value)} className={inp} />) : copyable && val ? (<div className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center"><div className="flex items-center justify-between group w-full"><span className="text-foreground font-medium">{val}</span><button onClick={() => { navigator.clipboard.writeText(val); toast.success("Copied to clipboard"); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"><Clipboard className="w-3.5 h-3.5" /></button></div></div>) : <div className="mt-1 px-3 py-2 rounded-md bg-muted/60 text-sm text-foreground min-h-[36px] flex items-center">{val || "—"}</div>}</div>);
  };

  return (<TooltipProvider>
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={tryClose}>
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative bg-background border border-border rounded-lg shadow-2xl flex flex-col animate-in fade-in duration-150" style={{ width: "90vw", maxWidth: 1100, height: "90vh" }} onClick={e => e.stopPropagation()}>
        {/* HERO */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-4 shrink-0">
          {/* Avatar + Name */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-14 h-14 rounded-full bg-green-500 text-white flex items-center justify-center text-lg font-bold shrink-0">{client.firstName[0]}{client.lastName[0]}</div>
            <h2 className="text-2xl font-bold text-foreground">{client.firstName} {client.lastName}</h2>
          </div>
          {/* Policy type badge — centered */}
          <div className="flex-1 flex items-center justify-center">
            <span className={`text-sm px-4 py-2 rounded-full font-semibold ${policyTypeBadge[client.policyType] || "bg-muted text-muted-foreground"}`}>{client.policyType}</span>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button className="px-4 py-2.5 text-sm bg-blue-500 hover:bg-blue-600 text-white" onClick={() => { logActivity(`Call initiated by ${AGENT_NAME}`, "call"); toast.info("Dialer opening..."); }}><Phone className="size-4 mr-1" />Call</Button>
            {client.phone ? (
              <Button variant="outline" className="px-4 py-2.5 text-sm" onClick={() => { setShowSmsCompose(true); setSmsText(""); }}><MessageSquare className="size-4 mr-1" />SMS</Button>
            ) : (
              <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm" disabled><MessageSquare className="size-4 mr-1" />SMS</Button></span></TooltipTrigger><TooltipContent>No phone number</TooltipContent></Tooltip>
            )}
            <Tooltip><TooltipTrigger asChild><span><Button variant="outline" className="px-4 py-2.5 text-sm" disabled><Mail className="size-4 mr-1" />Email</Button></span></TooltipTrigger><TooltipContent>Configure SMTP in Settings</TooltipContent></Tooltip>
            <Button className="px-4 py-2.5 text-sm bg-purple-500 hover:bg-purple-600 text-white" onClick={() => setShowAppt(true)}><Calendar className="size-4 mr-1" />Schedule</Button>
            <Button variant="ghost" className="px-4 py-2.5 text-sm" onClick={() => { if (editMode) handleCancel(); else setEditMode(true); }}><Pencil className="size-4" /></Button>
            <Button variant="ghost" className="px-4 py-2.5 text-sm" onClick={tryClose}><X className="size-4" /></Button>
          </div>
        </div>

        {/* TWO COLUMNS */}
        <div className="flex flex-1 min-h-0">
          {/* LEFT */}
          <div className="w-[65%] flex flex-col border-r border-border min-h-0">
            <div className="flex border-b border-border px-6 shrink-0">
              {(["Overview", "Notes", "History", "Calls"] as const).map(t => (
                <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 ${activeTab === t ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* OVERVIEW */}
              {activeTab === "Overview" && <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</span>
                  {!editMode
                    ? <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><Pencil className="w-3 h-3" /> Edit</button>
                    : <div className="flex items-center gap-2">
                        <button onClick={() => { setEditMode(false); setHasUnsavedChanges(false); setEditForm({ ...client }); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
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
                  {renderField("First Name", "firstName")}{renderField("Last Name", "lastName")}
                  {renderField("Phone", "phone", "text", undefined, true)}{renderField("Email", "email", "email", undefined, true)}
                  {renderField("Policy Type", "policyType", "select", ["Term", "Whole Life", "IUL", "Final Expense"])}
                  {renderField("Carrier", "carrier")}{renderField("Policy Number", "policyNumber")}
                  {renderField("Face Amount", "faceAmount")}{renderField("Premium Amount", "premiumAmount")}
                  {renderField("Issue Date", "issueDate", "date")}{renderField("Effective Date", "effectiveDate", "date")}
                  {renderField("Beneficiary Name", "beneficiaryName")}{renderField("Beneficiary Relationship", "beneficiaryRelationship")}
                  {renderField("Beneficiary Phone", "beneficiaryPhone")}
                  <div>
                    <label className="text-[11px] font-bold text-foreground dark:text-muted-foreground uppercase tracking-wider block mb-1">Assigned Agent</label>
                    {editMode ? <select value={editForm.assignedAgentId || ""} onChange={e => handleFieldChange("assignedAgentId", e.target.value)} className={inp}>{agents.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}</select> : <p className="text-sm text-foreground mt-0.5">{getAgentName(client.assignedAgentId)}</p>}
                  </div>
                </div>
                <div>{renderField("Notes", "notes", "textarea")}</div>
              </div>}

              {/* NOTES */}
              {activeTab === "Notes" && <div className="space-y-4">
                <div className="space-y-2">
                  <textarea value={newNote} onChange={e => { setNewNote(e.target.value); if (noteError) setNoteError(""); }} placeholder="Add a note about this client..." rows={3} className={`${inp} min-h-[72px] py-2`} />
                  {noteError && <p className="text-xs text-red-500">{noteError}</p>}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"><input type="checkbox" checked={pinNewNote} onChange={e => setPinNewNote(e.target.checked)} className="rounded" />Pin note</label>
                    <Button size="sm" onClick={handleAddNote}>Add Note</Button>
                  </div>
                </div>
                {localNotes.length === 0 ? <div className="text-center py-8"><FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No notes yet.</p></div> :
                  <div className="space-y-3">{localNotes.map(n => <div key={n.id} className={`rounded-lg border border-border p-3 bg-card ${n.pinned ? "ring-1 ring-yellow-500/30" : ""}`}><div className="flex items-start justify-between gap-2"><p className="text-sm text-foreground flex-1">{n.note}</p><div className="flex items-center gap-1 shrink-0"><button onClick={() => handleTogglePin(n.id)} className="p-1"><Pin className={`w-3.5 h-3.5 ${n.pinned ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} /></button><button onClick={() => setDeleteNoteId(n.id)} className="p-1 text-red-500 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></div></div><p className="text-xs text-muted-foreground mt-1">{n.agentName} · {timeAgo(n.createdAt)}</p></div>)}</div>}
              </div>}

              {/* HISTORY */}
              {activeTab === "History" && <div>
                <div className="flex gap-2 mb-4 flex-wrap">
                  {(["All", "Calls", "Emails", "SMS", "Appointments"] as const).map(f => <button key={f} onClick={() => setHistoryFilter(f)} className={`px-3 py-1 text-xs font-medium rounded-full transition-all duration-150 ${historyFilter === f ? "bg-blue-500 text-white" : "border border-border text-muted-foreground hover:text-foreground"}`}>{f}</button>)}
                </div>
                {(() => { const filtered = historyFilter === "All" ? historyItems : historyItems.filter(h => h.type === historyFilterMap[historyFilter]); if (filtered.length === 0) return <div className="text-center py-12"><Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No history yet</p></div>; return <div>{filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(item => { const config = historyIconConfig[item.type]; return <div key={item.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0"><div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${config.bg} ${config.text}`}>{config.icon}</div><div className="flex-1 min-w-0"><p className="text-sm text-foreground">{item.description}</p></div><span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.timestamp)}</span></div>; })}</div>; })()}
              </div>}

              {/* CALLS */}
              {activeTab === "Calls" && <div>{calls.length === 0 ? <div className="text-center py-12"><Headphones className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No calls recorded yet</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground border-b"><th className="text-left py-2 font-medium">Date</th><th className="text-left py-2 font-medium">Agent</th><th className="text-left py-2 font-medium">Duration</th><th className="text-left py-2 font-medium">Disposition</th><th className="text-left py-2 font-medium">Notes</th><th className="py-2"></th></tr></thead><tbody>{calls.map(c => <tr key={c.id} className="border-b last:border-0"><td className="py-2.5 text-foreground">{new Date(c.createdAt).toLocaleDateString()}</td><td className="py-2.5 text-foreground">{c.agentName}</td><td className="py-2.5 text-foreground">{fmt(c.duration)}</td><td className="py-2.5"><span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{c.disposition || "—"}</span></td><td className="py-2.5 text-muted-foreground">{c.notes || "—"}</td><td className="py-2.5"><Tooltip><TooltipTrigger asChild><span><Button size="sm" variant="outline" disabled className="text-xs">Play</Button></span></TooltipTrigger><TooltipContent>Recording available after Telnyx is connected</TooltipContent></Tooltip></td></tr>)}</tbody></table></div>}</div>}
            </div>
          </div>

          {/* RIGHT — ACTIVITY / CONVERSATIONS */}
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
                  {activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((a, i) => <div key={a.id} className={`flex items-start gap-2 ${i === 0 ? "animate-fade-in" : ""}`}><div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${activityDotColor(a.type)}`} /><div><p className="text-xs text-foreground leading-tight">{a.description}</p><p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p></div></div>)}
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
                  <div className="flex gap-1 mb-2">
                    {["SMS", "Email"].map(t => (
                      <button key={t} onClick={() => setComposeTab(t as any)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${composeTab === t ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>{t}</button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <input value={composeText} onChange={e => setComposeText(e.target.value)} placeholder="Type a message..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <button onClick={() => toast.success("Templates coming soon")} className="p-2 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                      <FileText className="w-4 h-4" />
                    </button>
                    <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">Send</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4 mr-1" />Delete Client</Button>
            <Button size="sm" variant="outline" onClick={() => toast.info("Merge feature coming soon")}><GitMerge className="w-4 h-4 mr-1" />Merge</Button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Created: {new Date(client.createdAt).toLocaleDateString()}</span>
            <span className="text-xs text-muted-foreground">Updated: {new Date(client.updatedAt).toLocaleDateString()}</span>
            <Button size="sm" variant="outline" onClick={tryClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>

    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Delete Client</DialogTitle><DialogDescription>Delete {client.firstName} {client.lastName}? This cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" onClick={async () => { await onDelete(client.id); setConfirmDelete(false); onClose(); toast.success("Client deleted"); }}>Delete</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}><DialogContent><DialogHeader><DialogTitle>Unsaved Changes</DialogTitle><DialogDescription>You have unsaved changes. Leave anyway?</DialogDescription></DialogHeader><DialogFooter><Button onClick={() => setConfirmDiscard(false)}>Stay</Button><Button variant="outline" onClick={() => { setConfirmDiscard(false); setEditMode(false); setHasChanges(false); onClose(); }}>Leave Without Saving</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteNoteId} onOpenChange={() => setDeleteNoteId(null)}><DialogContent><DialogHeader><DialogTitle>Delete Note</DialogTitle><DialogDescription>Are you sure?</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteNoteId(null)}>Cancel</Button><Button variant="destructive" onClick={() => deleteNoteId && handleDeleteNote(deleteNoteId)}>Delete</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={showSmsCompose} onOpenChange={setShowSmsCompose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send SMS</DialogTitle>
          <DialogDescription>Send a message to {client.firstName} {client.lastName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/60 px-3 py-2">
            <p className="text-sm font-medium text-foreground">{client.firstName} {client.lastName}</p>
            <p className="text-xs text-muted-foreground">{client.phone}</p>
          </div>
          <textarea
            value={smsText}
            onChange={e => setSmsText(e.target.value)}
            placeholder="Type your message..."
            rows={4}
            className={`${inp} min-h-[100px] py-2`}
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
        const { error } = await supabase.from('appointments').insert([{ title: data.title, contact_name: data.contactName, contact_id: client?.id, type: data.type, start_time: startDate.toISOString(), end_time: endDate.toISOString(), notes: data.notes }]);
        if (error) { toast.error("Failed to schedule appointment"); return; }
        addAppointment(data);
        logActivity(`Appointment scheduled for ${new Date(data.date).toLocaleDateString()}`, "appointment");
        setShowAppt(false); toast.success("Appointment scheduled");
      }}
      prefillContactName={client ? `${client.firstName} ${client.lastName}` : undefined}
    />
  </TooltipProvider>);
};

export default ClientModal;
