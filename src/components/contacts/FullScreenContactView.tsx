import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { X, Phone, Mail, Calendar, Pencil, Trash2, ArrowLeft, Clock, Pin, FileText, MessageSquare, ChevronDown, Play, Save, Clipboard, AlertTriangle, Plus, Mic } from "lucide-react";
import { ContactLocalTime } from "@/components/shared/ContactLocalTime";
import { LeadStatus, ContactNote, ContactActivity, PipelineStage } from "@/lib/types";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { activitiesSupabaseApi } from "@/lib/supabase-activities";
import { pipelineSupabaseApi, customFieldsSupabaseApi, leadSourcesSupabaseApi } from "@/lib/supabase-settings";
import { LeadSource, CustomField } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import ConvertLeadModal from "@/components/contacts/ConvertLeadModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import AddToCampaignModal from "@/components/contacts/AddToCampaignModal";
import { formatPhoneNumber, normalizePhoneNumber, toE164Plus } from "@/utils/phoneUtils";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { DateInput } from "@/components/shared/DateInput";
import { calculateAge } from "@/utils/dateUtils";
import { useBranding } from "@/contexts/BrandingContext";
import { formatStateToAbbreviation } from "@/utils/stateUtils";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { isCallsRowInboundDirection } from "@/lib/webrtcInboundCaller";
import { emailSupabaseApi, type UserEmailConnection } from "@/lib/supabase-email";
import { MessageComposePanel } from "@/components/messaging/MessageComposePanel";
import {
  CONTACT_FIELD_LAYOUT_KEY,
  getDefaultFieldOrder,
  resolveFieldOrder,
  type ContactType,
} from "@/lib/contactFieldLayout";
import { MessageTemplatesPickerModal } from "@/components/messaging/MessageTemplatesPickerModal";
import type { MessageTemplateMergeInput } from "@/lib/messageTemplateMerge";
import { HistorySkeleton } from "@/components/dialer/DialerSkeletons";

function parseUserContactFieldOrder(contactLayoutBlob: unknown, t: ContactType): string[] | undefined {
  if (!contactLayoutBlob || typeof contactLayoutBlob !== "object" || Array.isArray(contactLayoutBlob)) {
    return undefined;
  }
  const arr = (contactLayoutBlob as Record<string, unknown>)[t];
  if (!Array.isArray(arr) || arr.length === 0 || !arr.every((x) => typeof x === "string")) return undefined;
  return arr as string[];
}

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
// Fallbacks will be replaced by database data
const initialLeadSources = ["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar", "Cold Call", "TV Ad", "Radio Ad", "Other"];
const bestTimes = ["Morning 8am-12pm", "Afternoon 12pm-5pm", "Evening 5pm-8pm", "Anytime"];
const recruitStatuses = ["Prospect", "Contacted", "Interview", "Licensed", "Active"];
const policyTypes = ["Term", "Whole Life", "IUL", "Final Expense"];

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
  "Appointment Set": "#9333EA",
  "APPPINTMENT SET": "#9333EA",
  "Call Back": "#CA8A04",
  "No Answer": "#6B7280",
  "Left Voicemail": "#6B7280",
  "Not Available": "#6B7280",
  DNC: "#DC2626",
};

const normalizeStatusDisplay = (status: string) => {
  if (!status) return "";
  // Fix the common typo APPPINTMENT -> Appointment
  return status.replace(/AP+PINTMENT/i, "Appointment");
};

/** Matches `ConversationHistory` `historyIcon` — green calls, blue SMS, violet email (side strip, not inside bubble). */
function contactTimelineBubbleIcon(kind: "call" | "sms" | "email") {
  const iconCls = "w-3.5 h-3.5 transition-all duration-200 hover:scale-125 hover:opacity-100 cursor-default";
  if (kind === "call") {
    return <Phone className={cn(iconCls, "text-emerald-500 opacity-70")} />;
  }
  if (kind === "email") {
    return <Mail className={cn(iconCls, "text-violet-500 opacity-70")} />;
  }
  return <MessageSquare className={cn(iconCls, "text-blue-500 opacity-70")} />;
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
  if (!value && value !== 0) return <span className="text-muted-foreground italic text-xs">—</span>;
  const display = String(value);
  if (display === 'null' || display === 'undefined' || display.trim() === '') return <span className="text-muted-foreground italic text-xs">—</span>;
  return (
    <div className="flex items-center justify-between group w-full min-w-0">
      <span className="text-foreground font-semibold text-xs leading-snug break-all mr-1" title={display}>{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(display); toast.success("Copied to clipboard"); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
      >
        <Clipboard className="w-3 h-3" />
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

const FullScreenContactView: React.FC<FullScreenContactViewProps> = ({
  contact,
  type,
  onClose,
  onUpdate,
  onDelete,
  onConvert,
}) => {
  const [expandedRecordings, setExpandedRecordings] = useState<Record<string, boolean>>({});
  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const [expandedEmails, setExpandedEmails] = useState<Record<string, boolean>>({});
  const toggleEmail = (id: string) => {
    setExpandedEmails((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const { collapsed } = useSidebarContext();
  const { organizationId } = useOrganization();
  const { addAppointment } = useCalendar();
  const { profile } = useAuth();
  const { formatDate, formatDateTime, branding } = useBranding();
  const [showAppt, setShowAppt] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
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
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);
  
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>(contact?.status || "");
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [leadSources, setLeadSources] = useState<string[]>(initialLeadSources);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => getDefaultFieldOrder(type));

  const [agents, setAgents] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [coreLoading, setCoreLoading] = useState(true);
  const [availableNumbers, setAvailableNumbers] = useState<{ number: string; label: string }[]>([]);
  const [fromNumber, setFromNumber] = useState<string>("");
  const AGENT_NAME = profile ? `${profile.first_name} ${profile.last_name}` : "Agent";
  const AGENT_ID = profile?.id || "u1";
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());

  // Conversations
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoItems, setConvoItems] = useState<any[]>([]);
  const [convoFilter, setConvoFilter] = useState<"All" | "Calls" | "SMS" | "Email">("All");
  const [composeTab, setComposeTab] = useState<"SMS" | "Email">("SMS");
  const [composeText, setComposeText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [emailConnections, setEmailConnections] = useState<UserEmailConnection[]>([]);
  const [selectedEmailConnectionId, setSelectedEmailConnectionId] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const latestContactIdRef = useRef<string | null>(null);
  latestContactIdRef.current = contact?.id ?? null;

  const messageTemplateMergeInput = useMemo((): MessageTemplateMergeInput => {
    const cUnknown = contact as Record<string, unknown> | undefined;
    return {
      contact: cUnknown ?? null,
      agentFirstName: profile?.first_name,
      agentLastName: profile?.last_name,
      agentPhone: profile?.phone,
      agentEmail: profile?.email,
      agencyName: branding.companyName,
    };
  }, [contact, profile, branding.companyName]);

  const handleOpenComposeTemplates = useCallback(() => setShowTemplatesModal(true), []);

  const handleComposeChannelChange = useCallback((ch: "sms" | "email") => {
    setComposeTab(ch === "sms" ? "SMS" : "Email");
    setComposeText("");
    setEmailSubject("");
  }, []);

  // Sync form + clear per-contact UI before paint when switching contact or type (avoids wrong lead's notes/fields flashing).
  useLayoutEffect(() => {
    if (!contact?.id) return;
    setEditForm({ ...contact });
    setLocalStatus(contact.status || contact.policyType || "New");
    setLocalNotes([]);
    setActivities([]);
    setCampaigns([]);
    setConvoItems([]);
    setConvoLoading(true);
    setPipelineStages([]);
    setFieldOrder(getDefaultFieldOrder(type));
    setRosterLoaded(false);
    setCoreLoading(true);
  }, [contact?.id, type]);

  // Same contact refreshed from parent (e.g. after save + list refetch). Compare snapshot so Dialer/Calendar inline `contact` objects do not re-sync every parent render.
  const prevContactSnapshotRef = useRef<string>("");
  useEffect(() => {
    if (!contact?.id) return;
    if (editMode || hasUnsavedChanges) return;
    let snap = "";
    try {
      snap = JSON.stringify(contact);
    } catch {
      snap = contact.id;
    }
    if (prevContactSnapshotRef.current === snap) return;
    prevContactSnapshotRef.current = snap;
    setEditForm({ ...contact });
    setLocalStatus(contact.status || contact.policyType || "New");
  }, [contact, editMode, hasUnsavedChanges]);

  useEffect(() => {
    if (!contact?.id) return;
    const myId = contact.id;
    const myType = type;
    const assignedAgentIdForContact = (contact.assignedAgentId as string | undefined)?.trim() ?? "";
    let cancelled = false;
    const isCurrent = () => !cancelled && latestContactIdRef.current === myId;

    async function loadData() {
      const assignedRowP =
        assignedAgentIdForContact && assignedAgentIdForContact !== profile?.id
          ? supabase.from("profiles").select("id, first_name, last_name").eq("id", assignedAgentIdForContact).maybeSingle()
          : Promise.resolve({ data: null });

      const pipelineP =
        myType === "lead" || myType === "recruit"
          ? myType === "recruit"
            ? pipelineSupabaseApi.getRecruitStages()
            : pipelineSupabaseApi.getLeadStages()
          : Promise.resolve([] as PipelineStage[]);

      const settingsP = (async () => {
        try {
          const prefsProm =
            profile?.id != null
              ? supabase.from("user_preferences").select("settings").eq("user_id", profile.id).maybeSingle()
              : Promise.resolve({ data: null });

          const [sources, fields, prefsResult] = await Promise.all([
            leadSourcesSupabaseApi.getAll(),
            customFieldsSupabaseApi.getAll(organizationId),
            prefsProm,
          ]);

          let settings: Record<string, unknown> | null = null;
          if (organizationId) {
            const { data } = await (supabase as any)
              .from("contact_management_settings")
              .select("*")
              .eq("organization_id", organizationId)
              .maybeSingle();
            settings = data;
          }

          const prefsSettings = prefsResult?.data?.settings as Record<string, unknown> | undefined;
          const contactLayoutBlob = prefsSettings?.[CONTACT_FIELD_LAYOUT_KEY];

          return { sources, fields, settings, contactLayoutBlob };
        } catch (err) {
          console.error("Error fetching dynamic settings:", err);
          return {
            sources: [] as LeadSource[],
            fields: [] as CustomField[],
            settings: null,
            contactLayoutBlob: undefined,
          };
        }
      })();

      const campaignP =
        myType === "lead"
          ? supabase
              .from("campaign_leads")
              .select("campaign_id, campaigns(id, name, type, status)")
              .eq("lead_id", myId)
          : Promise.resolve({ data: null });

      const phoneP = organizationId
        ? supabase
            .from("phone_numbers")
            .select("phone_number, friendly_name, is_default")
            .or(`organization_id.eq.${organizationId},organization_id.is.null`)
            .in("status", ["active", "Active"])
        : Promise.resolve({ data: null });

      const profilesP = supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active");

      const lastCallP = supabase
        .from("calls")
        .select("caller_id_used")
        .eq("contact_id", myId)
        .not("caller_id_used", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const notesActsP = Promise.all([notesSupabaseApi.getByContact(myId), activitiesSupabaseApi.getByContact(myId)]);

      const [
        assignedRowRes,
        [fetchedNotes, fetchedActivities],
        fetchedStages,
        settingsPack,
        campaignRes,
        phoneRes,
        profilesRes,
        lastCallRes,
      ] = await Promise.all([assignedRowP, notesActsP, pipelineP, settingsP, campaignP, phoneP, profilesP, lastCallP]);

      if (!isCurrent()) return;

      setLocalNotes(fetchedNotes);
      setActivities(fetchedActivities);

      if (myType === "lead" || myType === "recruit") {
        setPipelineStages(fetchedStages);
      }

      const { sources, fields, settings, contactLayoutBlob } = settingsPack;
      if (sources.length > 0) setLeadSources(sources.map((s) => s.name));
      const relevantFields = fields.filter(
        (f) => f.active && f.appliesTo.includes(myType === "lead" ? "Leads" : myType === "client" ? "Clients" : "Recruits")
      );
      setCustomFields(relevantFields);

      let orgOrderRaw: unknown;
      if (settings) {
        orgOrderRaw =
          myType === "lead"
            ? (settings as any).field_order_lead
            : myType === "client"
              ? (settings as any).field_order_client
              : (settings as any).field_order_recruit;
      } else {
        orgOrderRaw = undefined;
      }
      const orgOrder =
        Array.isArray(orgOrderRaw) && orgOrderRaw.length > 0 && orgOrderRaw.every((x: unknown) => typeof x === "string")
          ? (orgOrderRaw as string[])
          : undefined;

      const userOrder = parseUserContactFieldOrder(contactLayoutBlob, myType);
      setFieldOrder(resolveFieldOrder(myType, userOrder, orgOrder));

      if (myType === "lead" && campaignRes.data) {
        setCampaigns(campaignRes.data.map((cl: any) => cl.campaigns).filter(Boolean));
      } else if (myType !== "lead") {
        setCampaigns([]);
      }

      const phoneData = phoneRes.data;
      if (phoneData?.length) {
        setAvailableNumbers(
          phoneData.map((p) => ({
            number: p.phone_number,
            label: p.friendly_name ? `${p.friendly_name} - ${formatPhoneNumber(p.phone_number)}` : formatPhoneNumber(p.phone_number),
          }))
        );
        const lastCall = lastCallRes.data;
        if (lastCall?.caller_id_used) setFromNumber(lastCall.caller_id_used);
        else setFromNumber(phoneData.find((p) => p.is_default)?.phone_number || phoneData[0]?.phone_number || "");
      }

      let agentRows = (profilesRes.data || []).map((p: any) => ({
        id: p.id,
        firstName: p.first_name || "",
        lastName: p.last_name || "",
      }));
      const ar = assignedRowRes.data as { id: string; first_name: string | null; last_name: string | null } | null;
      if (ar?.id && !agentRows.some((x) => x.id === ar.id)) {
        agentRows = [
          { id: ar.id, firstName: ar.first_name || "", lastName: ar.last_name || "" },
          ...agentRows,
        ];
      }
      setAgents(agentRows);
      setRosterLoaded(true);
      setCoreLoading(false);

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
      const userConnections = await emailSupabaseApi.getMyConnections();
      const connectedConnections = userConnections.filter((connection) => connection.status === "connected");
      setEmailConnections(connectedConnections);
      setSelectedEmailConnectionId(connectedConnections[0]?.id || "");

      if (!isCurrent()) return;

      // Conversation timeline (calls + SMS) can be heavy — load after the rest so the left column and activity are not blocked.
      const [callsRes, msgsRes, emailsRes] = await Promise.all([
        supabase
          .from("calls")
          .select(
            "id, direction, duration, disposition_name, recording_url, twilio_call_sid, started_at, created_at, ended_at, caller_id_used, agent_id, contact_name, contact_phone, status, outcome, is_missed, amd_result, notes, hangup_details, quality_percentage, mos, shaken_stir, provider_session_id, provider_error_code, sip_response_code, pdd_seconds, recording_duration, campaign_id, flagged_for_coaching"
          )
          .eq("contact_id", myId)
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("messages")
          .select("id, direction, body, sent_at, from_number")
          .or(`lead_id.eq.${myId},contact_id.eq.${myId}`)
          .order("sent_at", { ascending: false })
          .limit(300),
        emailSupabaseApi.getContactEmails(myId),
      ]);

      if (!isCurrent()) return;

      const calls = (callsRes.data || [])
        .map((c) => ({
          ...c,
          _type: "call",
          _ts: new Date((c as any).started_at || (c as any).created_at || 0).getTime(),
        }))
        .reverse();
      const msgs = (msgsRes.data || [])
        .map((m) => ({
          ...m,
          _type: "sms",
          _ts: new Date((m as any).sent_at).getTime(),
        }))
        .reverse();
      const emails = (emailsRes || [])
        .map((e: any) => ({
          ...e,
          body: e.body_text || e.body_html || "(No body)",
          _type: "email",
          _ts: new Date(e.received_at || e.sent_at || e.created_at || 0).getTime(),
        }))
        .reverse();
      setConvoItems([...calls, ...msgs, ...emails].sort((a, b) => a._ts - b._ts));
      setConvoLoading(false);
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [contact?.id, contact?.assignedAgentId, type, organizationId, profile?.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) setStatusDropdownOpen(false); };
    if (statusDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusDropdownOpen]);

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [convoItems, convoFilter]);

  if (!contact) return null;

  const filteredConvos = useMemo(
    () => (convoFilter === "All" ? convoItems : convoItems.filter((i) => i._type === convoFilter.toLowerCase())),
    [convoItems, convoFilter],
  );
  /** Newest-first for dialer-aligned `flex-col-reverse` timeline (ConversationHistory uses `reversedHistory`). */
  const reversedFilteredConvos = useMemo(() => [...filteredConvos].reverse(), [filteredConvos]);
  const getAgentDisplayName = (agentId: string) => {
    if (!agentId?.trim()) return "";
    const id = agentId.trim();
    if (id === profile?.id) {
      const n = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
      if (n) return n;
    }
    const a = agents.find((ag) => ag.id === id);
    if (a) {
      const n = `${a.firstName} ${a.lastName}`.trim();
      if (n) return n;
    }
    const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (looksUuid) return rosterLoaded ? "Unavailable" : "Loading…";
    return id;
  };
  const getStatusColor = (status: string) => {
    if (!status) return "#6B7280";
    const stage = pipelineStages.find(s => s.name === status);
    if (stage?.color) return stage.color;
    const normalized = status.replace(/AP+PINTMENT/i, "Appointment");
    return fallbackStatusStyles[status] || fallbackStatusStyles[normalized] || "#6B7280";
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
    const entry: ContactActivity = { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, contactId: contact.id, contactType: type, type: activityType, description, agentId: AGENT_ID, agentName: AGENT_NAME, createdAt: new Date().toISOString() };
    setActivities(prev => [entry, ...prev]);
    setLastUpdated(new Date().toISOString());
  };

  const handleFieldChange = (key: string, value: any) => {
    setEditForm((f: any) => {
      const next = { ...f, [key]: value };
      if (key === "dateOfBirth" && value) {
        const age = calculateAge(value);
        if (age !== undefined) next.age = age;
      }
      return next;
    });
    setHasChanges(true);
    setHasUnsavedChanges(true);
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (!editForm.firstName?.trim()) errs.firstName = "First name is required";
    if (!editForm.lastName?.trim()) errs.lastName = "Last name is required";
    if (!editForm.phone?.trim()) errs.phone = "Phone number is required";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    await onUpdate(contact.id, editForm);
    setEditMode(false); setHasChanges(false); setHasUnsavedChanges(false);
    await activitiesSupabaseApi.add({ contactId: contact.id, contactType: type, type: "note", description: `${type.charAt(0).toUpperCase() + type.slice(1)} details updated by ${AGENT_NAME}`, agentId: AGENT_ID }, organizationId);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} updated successfully`);
  };

  const handleCancel = () => { setEditForm({ ...contact }); setEditMode(false); setHasChanges(false); setHasUnsavedChanges(false); setErrors({}); };

  const tryClose = () => {
    if (hasUnsavedChanges) setConfirmDiscard(true);
    else onClose();
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) { setNoteError("Note cannot be empty"); return; }
    setNoteError("");
    try {
      const addedNote = await notesSupabaseApi.add(contact.id, type, newNote.trim(), AGENT_ID, organizationId, pinNewNote);
      setLocalNotes(prev => [addedNote, ...prev].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
      setNewNote(""); setPinNewNote(false);
      logActivity(`Note added by ${AGENT_NAME}`, "note");
      toast.success("Note added");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleTogglePin = async (note: ContactNote) => {
    try {
      const updatedNote = await notesSupabaseApi.togglePin(note.id, note.pinned);
      setLocalNotes(prev => prev.map(n => n.id === note.id ? updatedNote : n).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
      toast.success(updatedNote.pinned ? "Note pinned" : "Note unpinned");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await notesSupabaseApi.deleteNote(noteId);
      setLocalNotes(prev => prev.filter(n => n.id !== noteId));
      setDeleteNoteId(null);
      logActivity(`Note deleted by ${AGENT_NAME}`, "delete");
      toast.success("Note deleted");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleSendMessage = async () => {
    if (!composeText.trim()) return;
    setMessageSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error("You must be logged in to send messages"); setMessageSending(false); return; }
      if (composeTab === "Email") {
        if (!contact.email) {
          toast.error("This contact has no email address.");
          setMessageSending(false);
          return;
        }
        if (!selectedEmailConnectionId) {
          toast.error("No connected inbox found. Connect one in Settings > Email Setup.");
          setMessageSending(false);
          return;
        }
        const selectedConnection = emailConnections.find((connection) => connection.id === selectedEmailConnectionId);
        const result = await emailSupabaseApi.sendContactEmail({
          contact_id: contact.id,
          to_email: contact.email,
          subject: emailSubject.trim() || `Message from ${AGENT_NAME}`,
          body_text: composeText.trim(),
          connection_id: selectedEmailConnectionId,
          from_email: selectedConnection?.provider_account_email,
        });
        if (!result.success) {
          toast.error(result.error || "Failed to send email");
          setMessageSending(false);
          return;
        }
        toast.success("Email queued");
        setComposeText("");
        setEmailSubject("");
        setConvoItems(prev => [...prev, { id: `optim-email-${Date.now()}`, body: composeText.trim(), direction: "outbound", _type: "email", _ts: Date.now(), sent_at: new Date().toISOString() }]);
      } else {
        if (!contact.phone) {
          toast.error("This contact has no phone number.");
          setMessageSending(false);
          return;
        }
        if (!fromNumber.trim()) {
          toast.error("Select an agency number to send from.");
          setMessageSending(false);
          return;
        }
        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const res = await fetch(`${base}/functions/v1/twilio-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            to: toE164Plus(contact.phone),
            from: toE164Plus(fromNumber),
            body: composeText.trim(),
            contact_id: contact.id,
            contact_type: type,
            lead_id: contact.id,
          }),
        });
        const result = await res.json();
        if (!result.success) { toast.error(result.error || "Failed to send message"); setMessageSending(false); return; }
        toast.success("Message sent");
        setComposeText("");
        setConvoItems(prev => [...prev, { id: `optim-${Date.now()}`, body: composeText.trim(), direction: "outbound", _type: "sms", _ts: Date.now(), sent_at: new Date().toISOString() }]);
      }
    } catch (err: any) { toast.error(err.message || "Failed to send message"); } finally { setMessageSending(false); }
  };

  const inputCls = "w-full h-8 px-2.5 rounded-md bg-background text-xs text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150";

  const renderField = (label: string, key: string, fieldType: "text" | "email" | "number" | "select" | "textarea" | "date" = "text", options?: string[]) => {
    let val: any;
    if (key.includes('.')) { const [parent, child] = key.split('.'); val = editForm[parent]?.[child] ?? ""; }
    else { val = editForm[key] ?? ""; }
    const handleChange = (newVal: any) => {
      if (key.includes('.')) { const [parent, child] = key.split('.'); handleFieldChange(parent, { ...(editForm[parent] || {}), [child]: newVal }); }
      else { handleFieldChange(key, newVal); }
    };

    return (
      <div className="min-w-0 flex flex-col">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight block mb-0.5">{label}</label>
        {editMode ? (
          <>
            {fieldType === "select" ? (
              <select value={val} onChange={e => handleChange(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : fieldType === "textarea" ? (
              <textarea value={val} onChange={e => handleChange(e.target.value)} rows={2} className={`${inputCls} min-h-[56px] py-1.5 h-auto`} />
            ) : fieldType === "date" ? (
              <DateInput value={val} onChange={handleChange} />
            ) : key === "phone" ? (
              <PhoneInput 
                value={val} 
                onChange={v => handleChange(normalizePhoneNumber(v))} 
                className={inputCls} 
                placeholder="(555)123-4567"
              />
            ) : (
              <input type={fieldType} value={val} onChange={e => handleChange(fieldType === "number" ? Number(e.target.value) : e.target.value)} className={inputCls} />
            )}
            {errors[key] && <p className="text-[10px] text-red-500 mt-0.5">{errors[key]}</p>}
          </>
        ) : ( <CopyField value={key === "phone" ? formatPhoneNumber(val) : key === "state" ? formatStateToAbbreviation(val) : fieldType === "date" ? formatDate(val) : val} /> )}
      </div>
    );
  };

  const availableStatuses = pipelineStages.length > 0
    ? pipelineStages.map(s => s.name)
    : type === "recruit"
      ? recruitStatuses
      : allStatuses as string[];

  return (
    <div className={cn(
      "fixed top-16 right-0 bottom-0 bg-background z-40 flex flex-col animate-in slide-in-from-right-2 duration-300 h-[calc(100vh-4rem)] overflow-hidden",
      collapsed ? "md:left-16" : "md:left-60"
    )}>
      {/* HEADER */}
      <div className="h-16 border-b border-border bg-card flex items-center shrink-0 z-20 shadow-sm relative px-6">
        {/* LEFT SECTION - aligned with Left Column */}
        <div className="w-[340px] xl:w-[380px] 2xl:w-[420px] flex items-center gap-4 shrink-0 px-2">
          <button onClick={tryClose} className="p-2 hover:bg-accent rounded-full text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2">
            {/* CONTACT TYPE BADGE */}
            <span className={cn(
              "h-8 px-2.5 flex items-center justify-center text-[10px] uppercase tracking-wider font-bold rounded-lg shadow-sm border whitespace-nowrap",
              type === 'lead' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
              type === 'client' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
              'bg-orange-500/10 text-orange-500 border-orange-500/20'
            )}>
              {type}
            </span>

            {/* LOCAL TIME */}
            {contact.state && (
              <div className="h-8 px-2.5 flex items-center gap-1.5 bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg border border-green-500/20 shadow-sm whitespace-nowrap">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs font-bold uppercase tracking-widest"><ContactLocalTime state={contact.state} /></span>
              </div>
            )}

            {/* STATUS DROPDOWN */}
            {type !== "client" ? (
              <div className="relative shrink-0" ref={statusDropdownRef}>
                <button 
                  onClick={() => setStatusDropdownOpen(!statusDropdownOpen)} 
                  className="h-8 px-2.5 rounded-lg font-bold text-[10px] uppercase tracking-wider inline-flex items-center gap-1.5 transition-all shadow-sm border whitespace-nowrap min-w-fit" 
                  style={getStatusColorStyle(getStatusColor(localStatus))}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getStatusColor(localStatus) }} />
                  {normalizeStatusDisplay(localStatus)} <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
                {statusDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 z-[120] bg-popover border border-border rounded-xl shadow-xl py-2 min-w-[180px] animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase">Change Status</div>
                    {availableStatuses.map((s: string) => (
                      <button key={s} onClick={() => handleStatusChange(s)} className={cn(
                        "w-full text-left px-4 py-2 text-sm text-foreground hover:bg-accent flex items-center gap-3 transition-colors",
                        localStatus === s ? "bg-accent/50 font-semibold" : ""
                      )}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getStatusColor(s) }} /> {normalizeStatusDisplay(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="h-8 px-2.5 flex items-center justify-center text-[10px] font-bold bg-green-500 text-white shadow-sm uppercase tracking-wider border-green-600/20 border rounded-lg whitespace-nowrap">{contact.policyType || 'Client'}</span>
            )}
          </div>
        </div>

        {/* MIDDLE SECTION - Phone Selector */}
        <div className="flex-1 flex justify-end px-4 overflow-hidden">
          <div className="flex items-center gap-2 bg-accent/30 px-2 py-1 rounded-lg border border-border">
             <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">From:</span>
             <select 
               value={fromNumber}
               onChange={(e) => setFromNumber(e.target.value)}
               className="bg-transparent border-none text-xs font-semibold focus:ring-0 cursor-pointer text-foreground max-w-[130px] truncate outline-none"
             >
               {availableNumbers.length === 0 ? (
                 <option value="">No numbers available</option>
               ) : (
                 availableNumbers.map(n => (
                   <option key={n.number} value={n.number}>{n.label}</option>
                 ))
               )}
             </select>
          </div>
        </div>

        {/* RIGHT SECTION - aligned with Right Column */}
        <div className="w-[340px] flex items-center justify-end gap-3 shrink-0 pl-6">
          <TooltipProvider disableHoverableContent={false}>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button 
                  className="h-10 px-4 flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all font-semibold"
                  onClick={() => {
                    logActivity(`Call initiated by ${AGENT_NAME}`, "call");
                    window.dispatchEvent(new CustomEvent("quick-call", {
                      detail: {
                        phone: contact.phone,
                        contactId: contact.id,
                        name: `${contact.firstName} ${contact.lastName}`,
                        fromNumber: fromNumber,
                        type: type
                      }
                    }));
                  }}
                >
                  <Phone className="w-4 h-4 fill-current" /> Call
                </Button>
              </TooltipTrigger>
              <TooltipContent className="z-[200]" side="bottom" sideOffset={8}>Start call via dialer</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button 
                  className="h-10 px-4 flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg transition-all font-semibold"
                  onClick={(e) => { e.stopPropagation(); setShowAppt(true); }}
                >
                  <Calendar className="w-4 h-4" /> Schedule
                </Button>
              </TooltipTrigger>
              <TooltipContent className="z-[200]" side="bottom" sideOffset={8}>Schedule an appointment</TooltipContent>
            </Tooltip>

            {type === "lead" && onConvert && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button 
                    className="h-10 px-4 flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all font-semibold"
                    onClick={() => setShowConvert(true)}
                  >
                    <ArrowLeft className="w-4 h-4 rotate-180" /> Convert
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="z-[200]" side="bottom" sideOffset={8}>Convert lead to client</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* 3 COLUMN LAYOUT - "Island" Style matching Dialer */}
      <div className="flex flex-1 overflow-hidden min-w-0 w-full p-3 gap-3 bg-accent/5">

        {/* LEFT DOCK - Contacts Overview */}
        <div className="w-[340px] xl:w-[380px] 2xl:w-[420px] bg-card border border-border rounded-xl flex flex-col min-h-0 overflow-hidden shrink-0 shadow-sm">
          <div className="px-4 h-14 border-b border-border flex items-center justify-between shrink-0 bg-muted/10">
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
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {editMode && hasUnsavedChanges && (
              <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> <span>You have unsaved changes.</span>
              </div>
            )}
            
              {coreLoading ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />
                  ))}
                </div>
              ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    {fieldOrder.map(fieldId => {
                      if (fieldId.startsWith('custom:')) {
                        const fieldName = fieldId.replace('custom:', '');
                        const field = customFields.find(f => f.name === fieldName);
                        if (!field) return null;
                        return (
                          <div key={fieldId}>
                            {renderField(
                              field.name,
                              `customFields.${field.name}`,
                              field.type === 'Dropdown' ? 'select' : field.type.toLowerCase() as any,
                              field.dropdownOptions
                            )}
                          </div>
                        );
                      }

                      // Standard Fields mapping
                      switch (fieldId) {
                        case 'firstName': return renderField("First Name", "firstName");
                        case 'lastName': return renderField("Last Name", "lastName");
                        case 'phone': return renderField("Phone", "phone");
                        case 'email': return renderField("Email", "email", "email");
                        case 'state': return renderField("State", "state", "select", US_STATES);
                        case 'leadSource': return type === "lead" ? renderField("Source", "leadSource", "select", leadSources) : null;
                        case 'leadScore': return type === "lead" ? renderField("Score", "leadScore", "number") : null;
                        case 'age': return type === "lead" ? renderField("Age", "age", "number") : null;
                        case 'dateOfBirth': return type === "lead" ? renderField("DOB", "dateOfBirth", "date") : null;
                        case 'spouseInfo': return type === "lead" ? renderField("Spouse Info", "spouseInfo") : null;
                        case 'policyType': return type === "client" ? renderField("Policy Type", "policyType", "select", policyTypes) : null;
                        case 'carrier': return type === "client" ? renderField("Carrier", "carrier") : null;
                        case 'policyNumber': return type === "client" ? renderField("Policy #", "policyNumber") : null;
                        case 'premiumAmount': return type === "client" ? renderField("Premium", "premiumAmount") : null;
                        case 'faceAmount': return type === "client" ? renderField("Face Amount", "faceAmount") : null;
                        case 'issueDate': return type === "client" ? renderField("Issue Date", "issueDate", "date") : null;
                        case 'status': return type === "recruit" ? renderField("Status", "status", "select", recruitStatuses) : null;
                        case 'assignedAgentId':
                          return (
                            <div key="assignedAgentId" className="bg-muted/40 rounded-md px-2.5 py-2 col-span-2">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight block mb-0.5">Assigned Agent</label>
                              {editMode ? (
                                <select value={editForm.assignedAgentId || ""} onChange={e => handleFieldChange("assignedAgentId", e.target.value)} className={inputCls}>
                                  <option value="">—</option>
                                  {agents.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
                                </select>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${contact.assignedAgentId ? 'bg-green-500' : 'bg-gray-400'}`} />
                                  <CopyField value={getAgentDisplayName(contact.assignedAgentId)} />
                                </div>
                              )}
                            </div>
                          );
                        case 'notes': return <div key="notes" className="col-span-2">{renderField("System Notes", "notes", "textarea")}</div>;
                        default: return null;
                      }
                    })}

                    {/* JSONB Custom Fields - Only show if not already in fieldOrder */}
                    {Object.keys(editForm?.customFields || {}).map(key => {
                      if (fieldOrder.some(f => f === `custom:${key}`)) return null;
                      return (
                        <div key={`jsonb-${key}`}>
                          {renderField(key, `customFields.${key}`)}
                        </div>
                      );
                    })}
                </div>

                {customFields.some((f) => !fieldOrder.includes(`custom:${f.name}`)) && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3 pt-1">
                    {customFields
                      .filter((f) => !fieldOrder.includes(`custom:${f.name}`))
                      .map((field) => (
                        <div key={field.id}>
                          {renderField(
                            field.name,
                            `customFields.${field.name}`,
                            field.type === "Dropdown" ? "select" : (field.type.toLowerCase() as any),
                            field.dropdownOptions
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
              )}
              
              <div className="mt-auto pt-3 border-t border-border">
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
                  <Trash2 className="w-3 h-3" /> Delete {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              </div>
          </div>
        </div>

        {/* CENTER COLUMN — structure matches dialer ConversationHistory.tsx */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-card border rounded-xl">
              <div className="shrink-0 border-b border-border">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-semibold text-sm text-foreground">Conversation History</span>
                  </div>
                  <div className="flex bg-muted rounded-lg p-0.5 shrink-0">
                    {["All", "Calls", "SMS", "Email"].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setConvoFilter(f as "All" | "Calls" | "SMS" | "Email")}
                        className={cn(
                          "px-3 py-1 rounded-md text-[10px] font-bold transition-all uppercase tracking-tight",
                          convoFilter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col-reverse gap-3 min-h-0">
                <div ref={historyEndRef} />

                {convoLoading && <HistorySkeleton />}

                {!convoLoading && filteredConvos.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-6">No activity yet</p>
                )}

                {!convoLoading &&
                  reversedFilteredConvos.map((item) => {
                    const isOutbound =
                      item._type === "call"
                        ? !isCallsRowInboundDirection(item.direction)
                        : item.direction !== "inbound" && item.direction !== "incoming";

                    if (item._type === "email") {
                      const isExpanded = expandedEmails[item.id] ?? false;
                      const emailBody = typeof item.body === "string" ? item.body : "";
                      const bodyLines = emailBody.split("\n");
                      const subjectLine =
                        typeof item.subject === "string" && item.subject.trim()
                          ? item.subject.trim()
                          : "(No subject)";
                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} w-full group`}
                        >
                          <div className={`flex items-end gap-2 max-w-[85%] ${isOutbound ? "flex-row-reverse" : "flex-row"}`}>
                            <div className="shrink-0 mb-1">
                              {contactTimelineBubbleIcon("email")}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div
                                className={cn(
                                  "min-w-0 rounded-2xl text-sm shadow-sm overflow-hidden transition-all border",
                                  isOutbound
                                    ? "rounded-tr-sm border-violet-400/40 bg-[#007AFF] text-white"
                                    : "rounded-tl-sm border-border/60 bg-[#E9E9EB] dark:bg-[#262629] text-foreground",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleEmail(item.id)}
                                  className={cn(
                                    "w-full px-3.5 py-2.5 flex items-center gap-2 text-left transition-colors",
                                    isOutbound ? "hover:bg-white/10" : "hover:bg-black/[0.04] dark:hover:bg-white/10",
                                  )}
                                  aria-expanded={isExpanded}
                                  aria-label={
                                    isExpanded
                                      ? "Hide full email"
                                      : `Show full email: ${subjectLine}`
                                  }
                                >
                                  <span
                                    className={cn(
                                      "flex-1 text-[13px] font-medium min-w-0 text-left line-clamp-2 break-words",
                                      isOutbound ? "text-white" : "text-foreground",
                                    )}
                                    title={subjectLine}
                                  >
                                    {subjectLine}
                                  </span>
                                  <ChevronDown
                                    className={cn(
                                      "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                                      isExpanded && "rotate-180",
                                      isOutbound ? "text-white/85" : "text-muted-foreground",
                                    )}
                                    aria-hidden
                                  />
                                </button>
                                {isExpanded ? (
                                  <div
                                    className={cn(
                                      "px-3.5 pb-3 pt-2 border-t max-h-[min(60vh,28rem)] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200",
                                      isOutbound ? "border-white/25" : "border-border/50",
                                    )}
                                  >
                                    {bodyLines.map((line, i) =>
                                      line.startsWith(">") ? (
                                        <p
                                          key={i}
                                          className={cn(
                                            "text-[11px] leading-relaxed",
                                            isOutbound ? "text-white/70" : "text-muted-foreground",
                                          )}
                                        >
                                          {line}
                                        </p>
                                      ) : (
                                        <p
                                          key={i}
                                          className={cn(
                                            "text-sm leading-relaxed",
                                            isOutbound ? "text-white" : "text-foreground",
                                          )}
                                        >
                                          {line}
                                        </p>
                                      ),
                                    )}
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={cn(
                                  "text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-1",
                                  isOutbound ? "justify-end" : "justify-start",
                                )}
                              >
                                {formatDateTime(new Date(item._ts))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (item._type === "call") {
                      const hasDialerRecording = Boolean(item.recording_url && item.recording_url !== "__recording_pending__");
                      const durationSec = item.duration ?? 0;
                      return (
                        <div key={item.id} className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} w-full group`}>
                          <div className={`flex items-end gap-2 max-w-[85%] ${isOutbound ? "flex-row-reverse" : "flex-row"}`}>
                            <div className="shrink-0 mb-1">{contactTimelineBubbleIcon("call")}</div>
                            <div className="flex flex-col min-w-0">
                              <div
                                className={`px-3.5 py-2 rounded-2xl text-sm shadow-sm transition-all relative ${
                                  isOutbound ? "bg-[#007AFF] text-white rounded-tr-sm" : "bg-[#E9E9EB] dark:bg-[#262629] text-foreground rounded-tl-sm"
                                }`}
                              >
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="leading-tight font-semibold shrink-0">
                                      {isCallsRowInboundDirection(item.direction) ? "Inbound Call" : "Outbound Call"}
                                    </span>
                                    {item.disposition_name ? (
                                      <span
                                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                          isOutbound ? "bg-white/20 text-white" : "bg-black/10 text-foreground/70"
                                        } shadow-sm`}
                                      >
                                        {item.disposition_name}
                                      </span>
                                    ) : null}
                                    <span
                                      className={`text-[11px] font-medium opacity-80 ${
                                        isOutbound ? "text-white" : "text-muted-foreground"
                                      }`}
                                    >
                                      {durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}` : "0:00"}
                                    </span>
                                    {hasDialerRecording ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleRecording(item.id);
                                        }}
                                        className={`p-1 rounded-full transition-all ml-auto ${
                                          isOutbound ? "hover:bg-white/30 text-white" : "hover:bg-primary/10 text-primary"
                                        }`}
                                        title={expandedRecordings[item.id] ? "Hide Recording" : "Play Recording"}
                                      >
                                        <Play className={`w-3.5 h-3.5 ${expandedRecordings[item.id] ? "fill-current" : ""}`} />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                                {hasDialerRecording && expandedRecordings[item.id] ? (
                                  <div
                                    className={`mt-3 pt-3 border-t ${
                                      isOutbound ? "border-white/30" : "border-border/30"
                                    } animate-in fade-in slide-in-from-top-1 duration-200`}
                                  >
                                    <div
                                      className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest mb-3 ${
                                        isOutbound ? "text-white" : "text-foreground"
                                      }`}
                                    >
                                      <div
                                        className={`w-6 h-6 rounded-full flex items-center justify-center ${
                                          isOutbound ? "bg-white/20" : "bg-primary/10"
                                        }`}
                                      >
                                        <Mic className="w-3 h-3 text-current" aria-hidden />
                                      </div>
                                      <span>Call Recording</span>
                                    </div>
                                    <div
                                      className={`rounded-xl p-3 ${
                                        isOutbound ? "bg-white/10" : "bg-accent/50"
                                      } border ${isOutbound ? "border-white/20" : "border-border/50"}`}
                                    >
                                      <RecordingPlayer callId={item.id} compact />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={`text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-1 ${
                                  isOutbound ? "justify-end" : "justify-start"
                                }`}
                              >
                                {formatDateTime(new Date(item._ts))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (item._type !== "sms") return null;

                    return (
                      <div key={item.id} className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} w-full group`}>
                        <div className={`flex items-end gap-2 max-w-[85%] ${isOutbound ? "flex-row-reverse" : "flex-row"}`}>
                          <div className="shrink-0 mb-1">{contactTimelineBubbleIcon("sms")}</div>
                          <div className="flex flex-col">
                            <div
                              className={`px-3.5 py-2 rounded-2xl text-sm shadow-sm transition-all relative ${
                                isOutbound ? "bg-[#007AFF] text-white rounded-tr-sm" : "bg-[#E9E9EB] dark:bg-[#262629] text-foreground rounded-tl-sm"
                              }`}
                            >
                              <div className="flex flex-col gap-1.5">
                                <p className={`leading-relaxed whitespace-pre-wrap break-words ${isOutbound ? "text-white" : "text-foreground"}`}>{item.body}</p>
                              </div>
                            </div>
                            <div
                              className={`text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-1 ${
                                isOutbound ? "justify-end" : "justify-start"
                              }`}
                            >
                              {formatDateTime(new Date(item._ts))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <MessageComposePanel
              className="mt-3 shrink-0"
              channel={composeTab === "SMS" ? "sms" : "email"}
              onChannelChange={handleComposeChannelChange}
              messageText={composeText}
              onMessageChange={setComposeText}
              subjectText={emailSubject}
              onSubjectChange={setEmailSubject}
              onOpenTemplates={handleOpenComposeTemplates}
              onSendMessage={handleSendMessage}
              sendDisabled={
                !composeText.trim() ||
                messageSending ||
                (composeTab === "SMS" && (!contact.phone || !fromNumber.trim())) ||
                (composeTab === "Email" && (!contact.email || !selectedEmailConnectionId))
              }
              sendLoading={messageSending}
            />
          </div>
        </div>

        {/* RIGHT COLUMN - Activity/Notes/Campaigns */}
        <div className="w-[320px] xl:w-[350px] 2xl:w-[380px] bg-card border border-border rounded-xl flex flex-col min-h-0 overflow-hidden shrink-0 shadow-sm">
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
                     <div key={a.id} className="border-l-2 border-primary/30 pl-3 py-1.5 hover:bg-muted/50 rounded-r-md transition-colors">
                       <p className="text-xs text-foreground leading-snug">{a.description}</p>
                       <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(a.createdAt)} • {a.agentName}</p>
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
                
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                   {localNotes.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FileText className="w-8 h-8 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-foreground font-medium">No Notes Yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Important details and context will be stored here.</p>
                     </div>
                   ) : (
                      <div className="space-y-4 pt-1">
                        {localNotes.map(n => (
                          <div key={n.id} className={`rounded-xl border border-border p-3.5 bg-card shadow-sm relative transition-all ${n.pinned ? "ring-2 ring-yellow-500/30 bg-yellow-500/[0.03] border-yellow-500/20" : ""}`}>
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
               <div className="px-5 py-5 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dialer Campaigns</p>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-[10px] font-bold uppercase tracking-wider gap-1.5"
                      onClick={() => setAddToCampaignOpen(true)}
                    >
                      <Plus className="w-3 h-3" /> Add to Campaign
                    </Button>
                  </div>

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

      <MessageTemplatesPickerModal
        open={showTemplatesModal}
        onOpenChange={setShowTemplatesModal}
        channel={composeTab === "Email" ? "email" : "sms"}
        mergeInput={messageTemplateMergeInput}
        onApply={({ body, subject }) => {
          setComposeText(body);
          if (subject !== null) setEmailSubject(subject);
        }}
      />

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

      <ConvertLeadModal 
        open={showConvert}
        onClose={() => setShowConvert(false)}
        lead={type === 'lead' ? contact : null}
        onSuccess={(clientId) => {
          onConvert && onConvert(contact);
        }}
      />

      {type === "lead" && (
        <AddToCampaignModal
          open={addToCampaignOpen}
          onClose={() => setAddToCampaignOpen(false)}
          selectedContacts={[contact]}
          onSuccess={async () => {
            // Re-fetch campaigns local to this component
            const { data: campaignLinks } = await supabase
              .from("campaign_leads")
              .select("campaign_id, campaigns(id, name, type, status)")
              .eq("lead_id", contact.id);
            
            if (campaignLinks) {
              setCampaigns(campaignLinks.map((cl: any) => cl.campaigns).filter(Boolean));
            }
          }}
        />
      )}
    </div>
  );
};

export default FullScreenContactView;
