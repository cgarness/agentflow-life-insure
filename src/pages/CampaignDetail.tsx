import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Upload, Search, X, Loader2, MoreHorizontal,
  Lock, Trash2, AlertTriangle, Users, Phone, BarChart3, Mail,
  MessageSquare, Tag, UserPlus, GripVertical, CalendarIcon, FileText,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useBranding } from "@/contexts/BrandingContext";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string;
  assigned_agent_ids: string[];
  tags: string[];
  total_leads: number;
  leads_contacted: number;
  leads_converted: number;
  created_by: string | null;
  created_at: string;
}

interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  state: string;
  age: number | null;
  status: string;
  call_attempts: number;
  last_called_at: string | null;
  disposition: string | null;
  locked_by: string | null;
  locked_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  source: string | null;
  sort_order: number;
}

interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

interface LeadRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  state: string;
  age: number | null;
  status: string;
}

interface ImportHistoryRecord {
  id: string;
  file_name: string;
  total_records: number;
  imported: number;
  duplicates: number;
  errors: number;
  agent_id: string | null;
  created_at: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  "Open Pool": "bg-orange-500/10 text-orange-500",
  Personal: "bg-primary/10 text-primary",
  Team: "bg-purple-500/10 text-purple-500",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-success/10 text-success",
  Paused: "bg-warning/10 text-warning",
  Completed: "bg-primary/10 text-primary",
  Archived: "bg-muted text-muted-foreground/60",
};

const LEAD_STATUS_COLORS: Record<string, string> = {
  Queued: "bg-muted text-muted-foreground",
  Locked: "bg-warning/10 text-warning",
  Claimed: "bg-primary/10 text-primary",
  Called: "bg-info/10 text-info",
  Skipped: "bg-muted text-muted-foreground",
  Completed: "bg-success/10 text-success",
  Failed: "bg-destructive/10 text-destructive",
};


function getAgentDisplayName(a: AgentProfile): string {
  const full = `${a.first_name} ${a.last_name}`.trim();
  return full || a.email || "Unknown";
}

// ---- CSV helpers ----
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else current += ch;
    }
    result.push(current.trim());
    return result;
  };
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

const FIELD_MAP: Record<string, string[]> = {
  first_name: ["first name", "firstname", "first", "fname"],
  last_name: ["last name", "lastname", "last", "lname", "surname"],
  phone: ["phone", "phone number", "cell", "mobile", "telephone"],
  email: ["email", "email address", "e-mail"],
  state: ["state", "st", "province", "region"],
};

function autoMapHeaders(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  headers.forEach((h, i) => {
    const lower = h.toLowerCase().trim();
    for (const [field, variants] of Object.entries(FIELD_MAP)) {
      if (variants.some(v => lower === v || lower.includes(v))) { map[i] = field; break; }
    }
    if (!map[i]) map[i] = "skip";
  });
  return map;
}

// ---- Tag Input Component ----
const TagInput: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
}> = ({ tags, onChange, max = 10 }) => {
  const [input, setInput] = useState("");
  const addTag = (val: string) => {
    const tag = val.trim();
    if (!tag || tags.includes(tag) || tags.length >= max) return;
    onChange([...tags, tag]);
    setInput("");
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-foreground">
            {tag}
            <button onClick={() => onChange(tags.filter(t => t !== tag))} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {tags.length < max && (
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} onBlur={() => { if (input.trim()) addTag(input); }}
          placeholder="Type a tag and press Enter..." className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
      )}
      <p className="text-xs text-muted-foreground mt-1">{tags.length}/{max} tags</p>
    </div>
  );
};

// ---- Delete Confirm Dialog ----
const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ open, title, message, confirmLabel = "Delete", onConfirm, onClose }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
          <div>
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

// ---- Add Leads Modal ----
const AddLeadsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  campaignId: string;
  existingLeadIds: Set<string>;
  onAdded: () => void;
}> = ({ open, onClose, campaignId, existingLeadIds, onAdded }) => {
  const { organizationId } = useOrganization();
  const [search, setSearch] = useState("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) { setSearch(""); setLeads([]); setSelected(new Set()); return; }
    fetchLeads();
  }, [open]);

  const fetchLeads = async (q = "") => {
    setLoading(true);
    let query = supabase.from("leads").select("id, first_name, last_name, phone, email, state, age, status").limit(100);
    if (q) { query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`); }
    const { data } = await query;
    setLeads((data as LeadRow[]) || []);
    setLoading(false);
  };

  const handleSearch = () => fetchLeads(search);
  const toggleLead = (id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const handleAdd = async () => {
    const toAdd = leads.filter(l => selected.has(l.id) && !existingLeadIds.has(l.id));
    if (toAdd.length === 0) return;
    setAdding(true);
    const rows = toAdd.map(l => ({ campaign_id: campaignId, lead_id: l.id, first_name: l.first_name, last_name: l.last_name, phone: l.phone, email: l.email, state: l.state, age: l.age, status: "Queued", organization_id: organizationId }));
    const { error } = await supabase.from("campaign_leads").insert(rows as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error) { toast.error("Failed to add leads: " + error.message, { duration: 3000, position: "bottom-right" }); }
    else {
      await supabase.from("campaigns").update({ total_leads: (await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)).count || 0 } as any).eq("id", campaignId); // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.success(`${toAdd.length} leads added to campaign`, { duration: 3000, position: "bottom-right" });
      onAdded(); onClose();
    }
    setAdding(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Add Leads to Campaign</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="Search by name or phone..." className="w-full h-9 pl-9 pr-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>
          <button onClick={handleSearch} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors">Search</button>
        </div>
        <div className="flex-1 overflow-y-auto border rounded-lg">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : leads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">No leads found</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-accent/50 text-muted-foreground">
                <th className="w-10 py-2 px-3"></th>
                <th className="text-left py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Phone</th>
                <th className="text-left py-2 font-medium">State</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {leads.map(l => {
                  const already = existingLeadIds.has(l.id);
                  return (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                      <td className="py-2 px-3"><input type="checkbox" disabled={already} checked={selected.has(l.id)} onChange={() => toggleLead(l.id)} className="rounded accent-[hsl(var(--primary))]" /></td>
                      <td className="py-2 text-foreground">{l.first_name} {l.last_name}</td>
                      <td className="py-2 text-foreground">{l.phone}</td>
                      <td className="py-2 text-foreground">{l.state}</td>
                      <td className="py-2">{already ? <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Already added</span> : <span className="text-xs text-muted-foreground">{l.status}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <button onClick={handleAdd} disabled={adding || selected.size === 0} className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {adding && <Loader2 className="w-4 h-4 animate-spin" />}
          Add Selected ({selected.size})
        </button>
      </div>
    </div>
  );
};

// ---- CSV Import Modal ----
const ImportCSVModal: React.FC<{
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onImported: () => void;
}> = ({ open, onClose, campaignId, onImported }) => {
  const { organizationId } = useOrganization();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setStep(1); setFile(null); setHeaders([]); setRows([]); setMappings({}); } }, [open]);

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".csv")) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const { headers: h, rows: r } = parseCSV(e.target?.result as string);
      setHeaders(h); setRows(r); setMappings(autoMapHeaders(h)); setStep(2);
    };
    reader.readAsText(f);
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const fieldToCol: Record<string, number> = {};
      Object.entries(mappings).forEach(([idx, field]) => { if (field !== "skip") fieldToCol[field] = Number(idx); });
      const getVal = (row: string[], field: string) => { const idx = fieldToCol[field]; return idx !== undefined ? row[idx]?.trim() || "" : ""; };
      
      const leadsToProcess = rows.map(row => ({
        first_name: getVal(row, "first_name"),
        last_name: getVal(row, "last_name"),
        phone: getVal(row, "phone"),
        email: getVal(row, "email"),
        state: getVal(row, "state"),
      })).filter(r => r.phone || r.first_name);

      if (leadsToProcess.length === 0) {
        setImporting(false);
        return;
      }

      // 1. Process leads in batches to ensure they exist in the master 'leads' table
      const processedLeads = [];
      
      for (const lead of leadsToProcess) {
        // Try to find existing lead by phone or email
        let existingId = null;
        if (lead.phone || lead.email) {
          const queryParts = [];
          if (lead.phone) queryParts.push(`phone.eq.${lead.phone}`);
          if (lead.email) queryParts.push(`email.eq.${lead.email}`);
          
          const { data: existingLeads } = await supabase
            .from("leads")
            .select("id")
            .or(queryParts.join(','))
            .maybeSingle();
            
          if (existingLeads) existingId = existingLeads.id;
        }

        if (!existingId) {
          // Create new master lead
          const { data: newLead, error: createError } = await supabase
            .from("leads")
            .insert({
              first_name: lead.first_name,
              last_name: lead.last_name,
              phone: lead.phone,
              email: lead.email,
              state: lead.state,
              status: "New",
              organization_id: organizationId
            } as any)
            .select("id")
            .single();
          
          if (createError) {
            console.error("Failed to create master lead record:", createError);
            continue; // Skip this one if we can't create a master record
          }
          existingId = newLead.id;
        }
        
        processedLeads.push({
          ...lead,
          lead_id: existingId,
          campaign_id: campaignId,
          status: "Queued",
          organization_id: organizationId
        });
      }

      // 2. Insert into campaign_leads
      if (processedLeads.length > 0) {
        const { error } = await supabase.from("campaign_leads").insert(processedLeads as any);
        if (error) {
          toast.error("Import failed: " + error.message, { duration: 3000, position: "bottom-right" });
        } else {
          // Update campaign stats
          await supabase.from("campaigns").update({ 
            total_leads: (await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)).count || 0 
          } as any).eq("id", campaignId);
          
          toast.success(`${processedLeads.length} leads imported to campaign`, { duration: 3000, position: "bottom-right" });
          onImported(); 
          onClose();
        }
      }
    } catch (err: any) {
      toast.error("An error occurred during import: " + err.message);
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Import CSV to Campaign</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {step === 1 && (
          <div className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors border-border" onClick={() => fileRef.current?.click()}>
            <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="text-foreground text-sm font-medium">Drop your CSV file here or click to browse</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        )}
        {step === 2 && (
          <>
            <p className="text-sm text-muted-foreground">{file?.name} — {rows.length} rows detected. Map your columns:</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-foreground w-1/3 truncate">{h}</span>
                  <span className="text-muted-foreground">→</span>
                  <select value={mappings[i] || "skip"} onChange={e => setMappings(prev => ({ ...prev, [i]: e.target.value }))} className="flex-1 h-8 px-2 rounded-lg bg-muted text-sm text-foreground border border-border">
                    <option value="skip">Skip</option>
                    <option value="first_name">First Name</option>
                    <option value="last_name">Last Name</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="state">State</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Back</button>
              <button onClick={doImport} disabled={importing} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                Import {rows.length} Leads
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ---- Sortable Lead Row ----
const SortableLeadRow: React.FC<{
  lead: CampaignLead;
  index: number;
  isAdmin: boolean;
  isOpenPool: boolean;
  isDragEnabled: boolean;
  user: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  agents: AgentProfile[];
  selectedLeadIds: Set<string>;
  actionMenuId: string | null;
  onToggleSelect: (id: string) => void;
  onQuickCall: (lead: CampaignLead) => void;
  onActionMenu: (id: string) => void;
  onRemoveLead: (id: string) => void;
  onForceRelease: (id: string) => void;
}> = ({ lead: l, isAdmin, isOpenPool, isDragEnabled, user, agents, selectedLeadIds, actionMenuId, onToggleSelect, onQuickCall, onActionMenu, onRemoveLead, onForceRelease }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: l.id, disabled: !isDragEnabled });
  const { formatDate } = useBranding();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: isDragging ? "relative" as const : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  const hidePhone = isOpenPool && !isAdmin && l.status !== "Claimed" && l.claimed_by !== user?.id;
  const ownerAgent = l.locked_by ? agents.find(a => a.id === l.locked_by) : l.claimed_by ? agents.find(a => a.id === l.claimed_by) : null;

  return (
    <tr ref={setNodeRef} style={style} className={`border-b last:border-0 hover:bg-accent/30 transition-colors ${isDragging ? "bg-accent" : ""}`}>
      {isDragEnabled && (
        <td className="py-3 px-1">
          <button {...attributes} {...listeners} className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing p-1">
            <GripVertical className="w-4 h-4" />
          </button>
        </td>
      )}
      <td className="py-3 px-3">
        <input type="checkbox" checked={selectedLeadIds.has(l.id)} onChange={() => onToggleSelect(l.id)} className="rounded accent-[hsl(var(--primary))]" />
      </td>
      <td className="py-3 px-1">
        <TooltipProvider>
          <UITooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onQuickCall(l)}
                disabled={!l.phone || hidePhone}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  l.phone && !hidePhone
                    ? "bg-success/10 text-success hover:bg-success/20"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{!l.phone ? "No phone number on file" : hidePhone ? "Phone hidden in Open Pool" : "Quick call"}</p>
            </TooltipContent>
          </UITooltip>
        </TooltipProvider>
      </td>
      <td className="py-3 px-3 font-medium text-foreground">{l.first_name} {l.last_name}</td>
      <td className="py-3 px-3 text-foreground">
        {hidePhone ? <span className="flex items-center gap-1 text-muted-foreground"><Lock className="w-3 h-3" /> Hidden</span> : l.phone}
      </td>
      <td className="py-3 px-3 text-foreground">{l.email}</td>
      <td className="py-3 px-3 text-foreground">{l.state}</td>
      <td className="py-3 px-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEAD_STATUS_COLORS[l.status] || "bg-muted text-muted-foreground"}`}>{l.status}</span>
      </td>
      {isOpenPool && isAdmin && (
        <td className="py-3 px-3 text-sm text-muted-foreground">
          {ownerAgent ? getAgentDisplayName(ownerAgent) : "—"}
        </td>
      )}
      <td className="py-3 px-3 text-center text-foreground">{l.call_attempts}</td>
      <td className="py-3 px-3 text-muted-foreground">{l.last_called_at ? formatDate(l.last_called_at) : "Never"}</td>
      <td className="py-3 px-3">
        {l.disposition ? <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{l.disposition}</span> : "—"}
      </td>
      <td className="py-3 px-3 relative">
        <button onClick={() => onActionMenu(l.id)} className="text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {actionMenuId === l.id && (
          <div className="absolute right-0 top-full z-10 bg-card border rounded-lg shadow-lg py-1 w-48">
            {isOpenPool && isAdmin && l.status === "Locked" && (
              <button onClick={() => onForceRelease(l.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-warning hover:bg-accent transition-colors">
                <AlertTriangle className="w-4 h-4" /> Force Release
              </button>
            )}
            <button onClick={() => onRemoveLead(l.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors">
              <Trash2 className="w-4 h-4" /> Remove from Campaign
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};

// ---- MAIN COMPONENT ----
const CampaignDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { formatDate, formatDateTime } = useBranding();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [tab, setTab] = useState("Leads");
  const [leadFilter, setLeadFilter] = useState("All");
  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [statsDateFrom, setStatsDateFrom] = useState<Date | undefined>(undefined);
  const [statsDateTo, setStatsDateTo] = useState<Date | undefined>(undefined);
  const [importCSVOpen, setImportCSVOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [removeLeadId, setRemoveLeadId] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Bulk selection
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false);

  // Settings form
  const [settingsForm, setSettingsForm] = useState<Partial<Campaign>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  // Import history
  const [importHistory, setImportHistory] = useState<ImportHistoryRecord[]>([]);
  const [importHistoryLoading, setImportHistoryLoading] = useState(false);
  const [importHistoryError, setImportHistoryError] = useState(false);
  const [importHistoryProfiles, setImportHistoryProfiles] = useState<Record<string, string>>({});

  const isAdmin = profile?.role?.toLowerCase() === "admin";

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
    if (data) {
      const c = { ...data, assigned_agent_ids: data.assigned_agent_ids || [], tags: data.tags || [] } as Campaign;
      setCampaign(c);
      setSettingsForm(c);
    }
    setLoading(false);
  }, [id]);

  const fetchLeads = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLeadsLoading(true);
    const { data } = await supabase.from("campaign_leads").select("*, lead:leads(*)").eq("campaign_id", id).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    const mapped = (data || []).map((row: any) => {
      const { lead, ...cl } = row;
      return {
        ...lead,
        ...cl,
        state: cl.state || lead?.state || "",
        id: cl.id,
        lead_id: lead?.id || cl.lead_id
      };
    });
    setLeads(mapped as CampaignLead[]);
    if (!silent) setLeadsLoading(false);
  }, [id]);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    const { data } = await supabase.from("profiles").select("id, first_name, last_name, email, role, avatar_url").eq("status", "Active");
    if (data) { setAgents(data as AgentProfile[]); }
    setAgentsLoading(false);
  }, []);

  const fetchImportHistory = useCallback(async () => {
    if (!user?.id) return;
    setImportHistoryLoading(true);
    setImportHistoryError(false);

    // TODO: Add campaign_id column to import_history table and filter by campaign here
    const { data, error } = await supabase
      .from("import_history")
      .select("id, file_name, total_records, imported, duplicates, errors, agent_id, created_at")
      .eq("agent_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setImportHistoryError(true);
      setImportHistoryLoading(false);
      return;
    }

    const records = (data as ImportHistoryRecord[]) || [];
    setImportHistory(records);

    // Batch-fetch profiles for "Imported by" display
    const agentIds = [...new Set(records.map(r => r.agent_id).filter(Boolean) as string[])];
    if (agentIds.length > 0) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", agentIds);
      if (profileData) {
        const map: Record<string, string> = {};
        (profileData as { id: string; first_name: string; last_name: string; email: string }[]).forEach(p => {
          const name = `${p.first_name} ${p.last_name}`.trim();
          map[p.id] = name || p.email || "Unknown";
        });
        setImportHistoryProfiles(map);
      }
    }

    setImportHistoryLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchCampaign(); fetchLeads(); fetchAgents(); }, [fetchCampaign, fetchLeads, fetchAgents]);
  useEffect(() => { if (tab === "Import History") fetchImportHistory(); }, [tab, fetchImportHistory]);

  const existingLeadIds = useMemo(() => new Set(leads.map(l => l.lead_id).filter(Boolean) as string[]), [leads]);

  const filteredLeads = useMemo(() => {
    const role = profile?.role?.toLowerCase();
    const currentUserId = user?.id;
    const isAdmin = role === "admin";

    // Admins see all leads. Others might only see claimed leads.
    let visibleLeads = leads;

    if (role === "agent") {
      // Agent: only their own claimed leads
      visibleLeads = visibleLeads.filter(l => l.claimed_by === currentUserId);
    } else if (role === "team leader" || role === "team_leader") {
      // Team Leader: own leads + leads claimed by direct reports + unclaimed leads
      const teamMemberIds = new Set(
        agents.filter(a => (a as any).upline_id === currentUserId).map(a => a.id)
      );
      visibleLeads = visibleLeads.filter(
        l => l.claimed_by === currentUserId || (l.claimed_by && teamMemberIds.has(l.claimed_by)) || l.claimed_by == null
      );
    }
    // Admin: all leads, no additional filtering

    if (leadFilter !== "All") {
      return visibleLeads.filter(l => l.status === leadFilter);
    }
    return visibleLeads;
  }, [leads, leadFilter, profile, user, agents]);

  // Status actions
  const updateStatus = async (newStatus: string) => {
    if (!id) return;
    const { error } = await supabase.from("campaigns").update({ status: newStatus } as any).eq("id", id); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error) { toast.error("Failed to update status", { duration: 3000, position: "bottom-right" }); return; }
    toast.success(`Campaign ${newStatus.toLowerCase()}`, { duration: 3000, position: "bottom-right" });
    fetchCampaign();
  };

  const handleDelete = async () => {
    if (!id) return;
    await supabase.from("campaign_leads").delete().eq("campaign_id", id);
    await supabase.from("campaigns").delete().eq("id", id);
    toast.success("Campaign deleted.", { duration: 3000, position: "bottom-right" });
    navigate("/campaigns");
  };

  const handleRemoveLead = async () => {
    if (!removeLeadId) return;
    const { error } = await supabase.from("campaign_leads").delete().eq("id", removeLeadId);
    if (error) { toast.error("Failed to remove lead", { duration: 3000, position: "bottom-right" }); return; }
    toast.success("Lead removed from campaign", { duration: 3000, position: "bottom-right" });
    setRemoveLeadId(null);
    fetchLeads();
    if (id) {
      const { count } = await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      await supabase.from("campaigns").update({ total_leads: count || 0 } as any).eq("id", id); // eslint-disable-line @typescript-eslint/no-explicit-any
      fetchCampaign();
    }
  };

  // Bulk remove
  const handleBulkRemove = async () => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from("campaign_leads").delete().in("id", ids);
    if (error) { toast.error("Failed to remove leads", { duration: 3000, position: "bottom-right" }); return; }
    toast.success(`${ids.length} leads removed from campaign`, { duration: 3000, position: "bottom-right" });
    setSelectedLeadIds(new Set());
    setBulkRemoveConfirm(false);
    fetchLeads();
    if (id) {
      const { count } = await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      await supabase.from("campaigns").update({ total_leads: count || 0 } as any).eq("id", id); // eslint-disable-line @typescript-eslint/no-explicit-any
      fetchCampaign();
    }
  };

  // Bulk assign agent
  const handleBulkAssign = async (agentId: string) => {
    const ids = Array.from(selectedLeadIds);
    if (ids.length === 0) return;
    const { error } = await supabase.from("campaign_leads").update({ claimed_by: agentId } as any).in("id", ids); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error) { toast.error("Failed to assign agent", { duration: 3000, position: "bottom-right" }); return; }
    const agent = agents.find(a => a.id === agentId);
    toast.success(`${ids.length} leads assigned to ${agent ? getAgentDisplayName(agent) : "agent"}`, { duration: 3000, position: "bottom-right" });
    setSelectedLeadIds(new Set());
    setBulkAssignOpen(false);
    fetchLeads(true);
  };

  // Quick call
  const handleQuickCall = (lead: CampaignLead) => {
    if (!lead.phone) return;
    window.dispatchEvent(new CustomEvent("quick-call", {
      detail: { name: `${lead.first_name} ${lead.last_name}`.trim(), phone: lead.phone, contactId: lead.lead_id || lead.id }
    }));
  };

  // Toggle selection
  const toggleLeadSelection = (id: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedLeadIds.size === filteredLeads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
    }
  };
  // Drag and drop reorder (admin only)
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !isAdmin || leadFilter !== "All") return;
    const oldIndex = leads.findIndex(l => l.id === active.id);
    const newIndex = leads.findIndex(l => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(leads, oldIndex, newIndex);
    setLeads(reordered);
    // Persist sort_order
    const updates = reordered.map((l, i) => ({ id: l.id, sort_order: i }));
    // Batch update in chunks
    for (let i = 0; i < updates.length; i += 50) {
      const chunk = updates.slice(i, i + 50);
      await Promise.all(
        chunk.map(u =>
          supabase.from("campaign_leads").update({ sort_order: u.sort_order } as any).eq("id", u.id) // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      );
    }
    toast.success("Queue order updated", { duration: 3000, position: "bottom-right" });
  };


  const handleSettingsChange = (key: string, value: any) => { setSettingsForm(prev => ({ ...prev, [key]: value })); setSettingsDirty(true); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const toggleSettingsAgent = (agentId: string) => {
    const current = (settingsForm.assigned_agent_ids || []) as string[];
    if (settingsForm.type === "Personal") { handleSettingsChange("assigned_agent_ids", [agentId]); }
    else { handleSettingsChange("assigned_agent_ids", current.includes(agentId) ? current.filter(a => a !== agentId) : [...current, agentId]); }
  };

  const saveSettings = async () => {
    if (!id) return;
    setSettingsSaving(true);
    const { error } = await supabase.from("campaigns").update({
      name: settingsForm.name,
      description: settingsForm.description,
      assigned_agent_ids: settingsForm.assigned_agent_ids,
      tags: settingsForm.tags,
    } as any).eq("id", id); // eslint-disable-line @typescript-eslint/no-explicit-any
    setSettingsSaving(false);
    if (error) { toast.error("Failed to save: " + error.message, { duration: 3000, position: "bottom-right" }); return; }
    toast.success("Campaign settings saved", { duration: 3000, position: "bottom-right" });
    setSettingsDirty(false);
    fetchCampaign();
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    return counts;
  }, [leads]);

  const callsCount = useMemo(() => leads.filter(l => l.call_attempts > 0).length, [leads]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Campaign not found</p>
        <button onClick={() => navigate("/campaigns")} className="mt-4 text-sm text-primary hover:underline">Back to Campaigns</button>
      </div>
    );
  }

  const contactRate = campaign.total_leads > 0 ? Math.round((campaign.leads_contacted / campaign.total_leads) * 100) : 0;
  const isOpenPool = campaign.type === "Open Pool";

  return (
    <div className="space-y-4">
      {/* Header */}
      <button onClick={() => navigate("/campaigns")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Campaigns
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[campaign.type] || ""}`}>{campaign.type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[campaign.status] || ""}`}>{campaign.status}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {campaign.status === "Draft" && (
            <>
              <button onClick={() => updateStatus("Active")} className="px-3 py-2 rounded-lg bg-success/10 text-success text-sm font-medium hover:bg-success/20 transition-colors">Activate</button>
              <button onClick={() => setDeleteConfirm(true)} className="px-3 py-2 rounded-lg border border-destructive text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">Delete</button>
            </>
          )}
          {campaign.status === "Active" && (
            <>
              <button onClick={() => updateStatus("Paused")} className="px-3 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 transition-colors">Pause</button>
              <button onClick={() => updateStatus("Completed")} className="px-3 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors">Complete</button>
            </>
          )}
          {campaign.status === "Paused" && (
            <>
              <button onClick={() => updateStatus("Active")} className="px-3 py-2 rounded-lg bg-success/10 text-success text-sm font-medium hover:bg-success/20 transition-colors">Resume</button>
              <button onClick={() => updateStatus("Completed")} className="px-3 py-2 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-primary/10 transition-colors">Complete</button>
            </>
          )}
          {campaign.status === "Completed" && (
            <button onClick={() => updateStatus("Archived")} className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-accent transition-colors">Archive</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {["Leads", "Stats", "Settings", "Import History"].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {/* LEADS TAB */}
      {tab === "Leads" && (
        <div className="space-y-4">
          {/* Top bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setAddLeadsOpen(true)} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> Add Leads
            </button>
            <button onClick={() => setImportCSVOpen(true)} className="px-3 py-2 rounded-lg border border-border text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent transition-colors">
              <Upload className="w-4 h-4" /> Import CSV
            </button>
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{leads.length} leads</span>
            <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)} className="h-8 px-2 rounded-lg bg-muted text-sm text-foreground border border-border">
              <option value="All">All</option>
              {["Queued", "Locked", "Claimed", "Called", "Skipped", "Completed", "Failed"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Bulk action bar */}
          {selectedLeadIds.size > 0 && (
            <div className="flex items-center gap-3 flex-wrap bg-accent/50 border border-border rounded-lg px-4 py-2.5">
              <span className="text-sm font-medium text-foreground">{selectedLeadIds.size} selected</span>
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <button disabled className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm font-medium flex items-center gap-2 opacity-50 cursor-not-allowed">
                      <MessageSquare className="w-4 h-4" /> SMS Blast
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Coming soon — configure SMS in Settings first</p></TooltipContent>
                </UITooltip>
              </TooltipProvider>
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <button disabled className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm font-medium flex items-center gap-2 opacity-50 cursor-not-allowed">
                      <Mail className="w-4 h-4" /> Email Blast
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Coming soon — configure Email in Settings first</p></TooltipContent>
                </UITooltip>
              </TooltipProvider>
              <div className="relative">
                <button onClick={() => setBulkAssignOpen(!bulkAssignOpen)} className="px-3 py-1.5 rounded-lg border border-border text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent transition-colors">
                  <UserPlus className="w-4 h-4" /> Assign Agent
                </button>
                {bulkAssignOpen && (
                  <div className="absolute z-10 mt-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto w-48">
                    {agents.map(a => (
                      <button key={a.id} onClick={() => handleBulkAssign(a.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors text-foreground">
                        {getAgentDisplayName(a)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setBulkRemoveConfirm(true)} className="px-3 py-1.5 rounded-lg border border-destructive text-destructive text-sm font-medium flex items-center gap-2 hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-4 h-4" /> Remove Selected
              </button>
              <button onClick={() => setSelectedLeadIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Deselect All</button>
            </div>
          )}

          {/* Table */}
          {leadsLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filteredLeads.length === 0 ? (
            <div className="bg-card rounded-xl border p-8 text-center">
              <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">
                {profile?.role?.toLowerCase() === "agent"
                  ? "You haven't claimed any leads in this campaign yet. Join the Dialer to get started."
                  : (profile?.role?.toLowerCase() === "team leader" || profile?.role?.toLowerCase() === "team_leader")
                  ? "No leads have been claimed in this campaign by you or your team yet."
                  : "This campaign has no leads yet."}
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <div className="bg-card rounded-xl border overflow-hidden overflow-x-auto">
                {isAdmin && leadFilter === "All" && (
                  <div className="px-4 py-2 bg-accent/30 border-b border-border flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Drag rows to reorder the call queue priority</p>
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-accent/50 text-muted-foreground">
                    {isAdmin && leadFilter === "All" && <th className="w-10 py-3 px-1"></th>}
                    <th className="w-10 py-3 px-3">
                      <input type="checkbox" checked={selectedLeadIds.size === filteredLeads.length && filteredLeads.length > 0} onChange={toggleSelectAll} className="rounded accent-[hsl(var(--primary))]" />
                    </th>
                    <th className="w-10 py-3 px-1"></th>
                    <th className="text-left py-3 px-3 font-medium">Name</th>
                    <th className="text-left py-3 px-3 font-medium">Phone</th>
                    <th className="text-left py-3 px-3 font-medium">Email</th>
                    <th className="text-left py-3 px-3 font-medium">State</th>
                    <th className="text-left py-3 px-3 font-medium">Status</th>
                    {isOpenPool && isAdmin && <th className="text-left py-3 px-3 font-medium">Locked/Claimed By</th>}
                    <th className="text-center py-3 px-3 font-medium">Attempts</th>
                    <th className="text-left py-3 px-3 font-medium">Last Called</th>
                    <th className="text-left py-3 px-3 font-medium">Disposition</th>
                    <th className="w-12 py-3"></th>
                  </tr></thead>
                  <SortableContext items={filteredLeads.map(l => l.id)} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {filteredLeads.map((l, idx) => (
                        <SortableLeadRow
                          key={l.id}
                          lead={l}
                          index={idx}
                          isAdmin={isAdmin}
                          isOpenPool={isOpenPool}
                          isDragEnabled={isAdmin && leadFilter === "All"}
                          user={user}
                          agents={agents}
                          selectedLeadIds={selectedLeadIds}
                          actionMenuId={actionMenuId}
                          onToggleSelect={toggleLeadSelection}
                          onQuickCall={handleQuickCall}
                          onActionMenu={(id) => setActionMenuId(actionMenuId === id ? null : id)}
                          onRemoveLead={(id) => { setRemoveLeadId(id); setActionMenuId(null); }}
                          onForceRelease={async (id) => {
                            await supabase.from("campaign_leads").update({ status: "Queued", locked_by: null, locked_at: null } as any).eq("id", id); // eslint-disable-line @typescript-eslint/no-explicit-any
                            toast.success("Lead force-released to pool", { duration: 3000, position: "bottom-right" });
                            setActionMenuId(null);
                            fetchLeads(true);
                          }}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </table>
              </div>
            </DndContext>
          )}
        </div>
      )}

      {/* STATS TAB */}
      {tab === "Stats" && (
        <div className="space-y-4">
          {/* Date Range Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Date Range:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("w-[150px] justify-start text-left font-normal", !statsDateFrom && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {statsDateFrom ? format(statsDateFrom, "MMM d, yyyy") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={statsDateFrom} onSelect={setStatsDateFrom} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground">—</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("w-[150px] justify-start text-left font-normal", !statsDateTo && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {statsDateTo ? format(statsDateTo, "MMM d, yyyy") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={statsDateTo} onSelect={setStatsDateTo} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            {(statsDateFrom || statsDateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setStatsDateFrom(undefined); setStatsDateTo(undefined); }}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Leads", value: campaign.total_leads },
              { label: "Contacted", value: campaign.leads_contacted },
              { label: "Converted", value: campaign.leads_converted },
              { label: "Contact Rate", value: `${contactRate}%` },
            ].map(s => (
              <div key={s.label} className="bg-card rounded-xl border p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Channel Activity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card rounded-xl border p-4 text-center">
              <Phone className="w-5 h-5 text-primary mx-auto mb-2" />
              <p className="text-xs text-muted-foreground mb-1">Calls</p>
              <p className="text-2xl font-bold text-foreground">{callsCount}</p>
            </div>
            <div className="bg-card rounded-xl border p-4 text-center opacity-60">
              <MessageSquare className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground mb-1">SMS Sent</p>
              <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
            </div>
            <div className="bg-card rounded-xl border p-4 text-center opacity-60">
              <Mail className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground mb-1">Emails Sent</p>
              <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
            </div>
          </div>

          {/* Analytics Charts */}
          {leads.length > 0 && (() => {
            // Filter leads by date range
            const filteredLeads = leads.filter(l => {
              if (!l.last_called_at) return !statsDateFrom && !statsDateTo;
              const d = new Date(l.last_called_at);
              if (statsDateFrom && d < statsDateFrom) return false;
              if (statsDateTo) {
                const endOfDay = new Date(statsDateTo);
                endOfDay.setHours(23, 59, 59, 999);
                if (d > endOfDay) return false;
              }
              return true;
            });

            // Leads contacted over time (line chart)
            const contactedByDate: Record<string, number> = {};
            filteredLeads.forEach(l => {
              if (l.last_called_at) {
                const day = format(new Date(l.last_called_at), "MMM d");
                contactedByDate[day] = (contactedByDate[day] || 0) + 1;
              }
            });
            const lineData = Object.entries(contactedByDate)
              .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
              .map(([date, count]) => ({ date, contacted: count }));

            // Disposition breakdown (pie chart)
            const dispCounts: Record<string, number> = {};
            filteredLeads.forEach(l => {
              const d = l.disposition || "No Disposition";
              dispCounts[d] = (dispCounts[d] || 0) + 1;
            });
            const pieData = Object.entries(dispCounts).map(([name, value]) => ({ name, value }));
            const PIE_COLORS = [
              "hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))",
              "hsl(var(--destructive))", "hsl(var(--info))", "hsl(var(--accent))",
              "hsl(var(--muted-foreground))", "hsl(210 60% 50%)", "hsl(280 60% 50%)",
            ];

            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Line Chart — Leads Contacted Over Time */}
                <div className="bg-card rounded-xl border p-6">
                  <h3 className="text-sm font-semibold text-foreground mb-4">Leads Contacted Over Time</h3>
                  {lineData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No contact activity yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={lineData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <RechartsTooltip
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Line type="monotone" dataKey="contacted" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Pie Chart — Disposition Breakdown */}
                <div className="bg-card rounded-xl border p-6">
                  <h3 className="text-sm font-semibold text-foreground mb-4">Disposition Breakdown</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        style={{ fontSize: 10 }}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {leads.length === 0 ? (
            <div className="bg-card rounded-xl border p-8 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No leads in this campaign yet. Add leads from the Leads tab to get started.</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border p-6 space-y-3">
              <h3 className="text-sm font-semibold text-foreground mb-2">Status Breakdown</h3>
              {["Queued", "Locked", "Claimed", "Called", "Skipped", "Completed", "Failed"].map(status => {
                const count = statusCounts[status] || 0;
                const pct = leads.length > 0 ? Math.round((count / leads.length) * 100) : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-xs w-20 text-muted-foreground">{status}</span>
                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${status === "Completed" ? "bg-success" : status === "Failed" ? "bg-destructive" : status === "Called" ? "bg-info" : status === "Locked" || status === "Claimed" ? "bg-warning" : "bg-primary/40"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-foreground w-16 text-right">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SETTINGS TAB */}
      {tab === "Settings" && (
        <div className="bg-card rounded-xl border p-6 space-y-4 max-w-2xl">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name</label>
            <input value={settingsForm.name || ""} onChange={e => handleSettingsChange("name", e.target.value)} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
            <textarea value={settingsForm.description || ""} onChange={e => handleSettingsChange("description", e.target.value.slice(0, 500))} className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none" />
            <p className="text-xs text-muted-foreground text-right">{(settingsForm.description || "").length}/500</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
            <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2 border border-border">{campaign.type} <span className="text-xs text-muted-foreground">(cannot be changed)</span></p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {campaign.type === "Personal" ? "Assigned Agent" : "Assigned Agents"}
            </label>
            <div className="relative">
              <button type="button" onClick={() => setAgentDropdownOpen(!agentDropdownOpen)} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-left border border-border flex items-center justify-between">
                <span className={(settingsForm.assigned_agent_ids as string[] || []).length ? "text-foreground" : "text-muted-foreground"}>
                  {(settingsForm.assigned_agent_ids as string[] || []).length === 0 ? "Select agent(s)..." : agents.filter(a => (settingsForm.assigned_agent_ids as string[] || []).includes(a.id)).map(a => getAgentDisplayName(a)).join(", ")}
                </span>
                <Users className="w-4 h-4 text-muted-foreground" />
              </button>
              {agentDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {agentsLoading ? (
                    <div className="flex items-center justify-center gap-2 px-3 py-4">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading agents...</span>
                    </div>
                  ) : agents.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">No agents available — add agents in User Management first</p>
                  ) : (
                    agents.map(a => (
                      <button key={a.id} type="button" onClick={() => toggleSettingsAgent(a.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${(settingsForm.assigned_agent_ids as string[] || []).includes(a.id) ? "bg-primary border-primary" : "border-border"}`}>
                          {(settingsForm.assigned_agent_ids as string[] || []).includes(a.id) && <span className="text-primary-foreground text-[10px]">✓</span>}
                        </div>
                        <span className="text-foreground">{getAgentDisplayName(a)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Tags</label>
            <TagInput tags={(settingsForm.tags || []) as string[]} onChange={t => handleSettingsChange("tags", t)} max={10} />
          </div>
          <button onClick={saveSettings} disabled={!settingsDirty || settingsSaving} className="h-9 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2">
            {settingsSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>

          {isAdmin && (
            <div className="pt-6 mt-6 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground mb-1">Danger Zone</h4>
              <p className="text-xs text-muted-foreground mb-3">Permanently delete this campaign and all its data. This cannot be undone.</p>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="h-9 px-4 rounded-lg border border-destructive text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Campaign
              </button>
            </div>
          )}
        </div>
      )}

      {/* IMPORT HISTORY TAB */}
      {tab === "Import History" && (
        <div className="bg-card rounded-xl border p-6 space-y-4">
          {importHistoryLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : importHistoryError ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <p className="text-sm">Could not load import history.</p>
              <button
                onClick={fetchImportHistory}
                className="text-sm px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
              >
                Retry
              </button>
            </div>
          ) : importHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-50" />
              <p className="text-sm font-medium">No imports yet for this campaign.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-accent/50 text-muted-foreground">
                    <th className="text-left py-3 px-3 font-medium">Date &amp; Time</th>
                    <th className="text-left py-3 px-3 font-medium">File Name</th>
                    <th className="text-left py-3 px-3 font-medium">Records Imported</th>
                    <th className="text-left py-3 px-3 font-medium">Duplicates Skipped</th>
                    <th className="text-left py-3 px-3 font-medium">Errors</th>
                    <th className="text-left py-3 px-3 font-medium">Imported By</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map(row => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                      <td className="py-3 px-3 text-foreground whitespace-nowrap">
                        {row.created_at
                          ? format(new Date(row.created_at), "MMM d, yyyy 'at' h:mm a")
                          : "—"}
                      </td>
                      <td className="py-3 px-3 text-foreground">{row.file_name || "—"}</td>
                      <td className="py-3 px-3 text-foreground">{row.imported}</td>
                      <td className="py-3 px-3 text-foreground">{row.duplicates}</td>
                      <td className="py-3 px-3 text-foreground">{row.errors}</td>
                      <td className="py-3 px-3 text-foreground">
                        {row.agent_id ? (importHistoryProfiles[row.agent_id] || "—") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AddLeadsModal open={addLeadsOpen} onClose={() => setAddLeadsOpen(false)} campaignId={id!} existingLeadIds={existingLeadIds} onAdded={() => { fetchLeads(); fetchCampaign(); }} />
      <ImportCSVModal open={importCSVOpen} onClose={() => setImportCSVOpen(false)} campaignId={id!} onImported={() => { fetchLeads(); fetchCampaign(); }} />
      <ConfirmDialog
        open={deleteConfirm}
        title="Delete Campaign"
        message={
          campaign.leads_contacted > 0
            ? "This campaign has activity. Deleting it will permanently remove all campaign data and cannot be undone."
            : `This will permanently delete ${campaign.name}. This cannot be undone.`
        }
        confirmLabel="Delete Campaign"
        onConfirm={handleDelete}
        onClose={() => setDeleteConfirm(false)}
      />
      <ConfirmDialog open={!!removeLeadId} title="Remove Lead?" message="Remove this lead from the campaign? The lead itself won't be deleted." confirmLabel="Remove" onConfirm={handleRemoveLead} onClose={() => setRemoveLeadId(null)} />
      <ConfirmDialog open={bulkRemoveConfirm} title="Remove Selected Leads?" message={`Remove ${selectedLeadIds.size} leads from this campaign?`} confirmLabel="Remove" onConfirm={handleBulkRemove} onClose={() => setBulkRemoveConfirm(false)} />
    </div>
  );
};

export default CampaignDetail;
