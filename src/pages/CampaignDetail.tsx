import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, Upload, Search, X, Loader2, MoreHorizontal,
  Lock, Trash2, AlertTriangle, Users, Phone, BarChart3, Clock, Zap,
  Check, RotateCcw, ShieldAlert, Trophy, Crown, Medal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { STATE_TIMEZONES } from "@/utils/contactLocalTime";

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string;
  assigned_agent_ids: string[];
  dial_mode: string;
  total_leads: number;
  leads_contacted: number;
  leads_converted: number;
  calling_hours_start: string;
  calling_hours_end: string;
  max_retries: number;
  retry_interval: number;
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

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getAgentDisplayName(a: AgentProfile): string {
  const full = `${a.first_name} ${a.last_name}`.trim();
  return full || a.email || "Unknown";
}

function getLeadCallableStatus(state: string, callingStart: string, callingEnd: string): "available" | "outside" | "nostate" {
  if (!state) return "nostate";
  const tz = STATE_TIMEZONES[state.toUpperCase()];
  if (!tz) return "nostate";
  const now = new Date();
  const hourStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).format(now);
  const parts = hourStr.split(":");
  const currentMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  const startParts = callingStart.split(":");
  const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
  const endParts = callingEnd.split(":");
  const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
  return currentMinutes >= startMinutes && currentMinutes < endMinutes ? "available" : "outside";
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
    const rows = toAdd.map(l => ({ campaign_id: campaignId, lead_id: l.id, first_name: l.first_name, last_name: l.last_name, phone: l.phone, email: l.email, state: l.state, age: l.age, status: "Queued" }));
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
    const fieldToCol: Record<string, number> = {};
    Object.entries(mappings).forEach(([idx, field]) => { if (field !== "skip") fieldToCol[field] = Number(idx); });
    const getVal = (row: string[], field: string) => { const idx = fieldToCol[field]; return idx !== undefined ? row[idx]?.trim() || "" : ""; };
    const toInsert = rows.map(row => ({ campaign_id: campaignId, first_name: getVal(row, "first_name"), last_name: getVal(row, "last_name"), phone: getVal(row, "phone"), email: getVal(row, "email"), state: getVal(row, "state"), status: "Queued" })).filter(r => r.phone || r.first_name);
    const { error } = await supabase.from("campaign_leads").insert(toInsert as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (error) { toast.error("Import failed: " + error.message, { duration: 3000, position: "bottom-right" }); }
    else {
      await supabase.from("campaigns").update({ total_leads: (await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)).count || 0 } as any).eq("id", campaignId); // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.success(`${toInsert.length} leads imported to campaign`, { duration: 3000, position: "bottom-right" });
      onImported(); onClose();
    }
    setImporting(false);
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

// ---- Countdown Hook ----
function useCountdown(targetDate: string | null, durationSec: number): number {
  const [remaining, setRemaining] = useState(() => {
    if (!targetDate) return 0;
    const elapsed = (Date.now() - new Date(targetDate).getTime()) / 1000;
    return Math.max(0, Math.ceil(durationSec - elapsed));
  });
  useEffect(() => {
    if (!targetDate) { setRemaining(0); return; }
    const update = () => {
      const elapsed = (Date.now() - new Date(targetDate).getTime()) / 1000;
      setRemaining(Math.max(0, Math.ceil(durationSec - elapsed)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate, durationSec]);
  return remaining;
}

// ---- SharkTank Lead Card ----
const SharkTankCard: React.FC<{
  lead: CampaignLead;
  currentUserId: string;
  agents: AgentProfile[];
  onClaim: (leadId: string) => void;
  onConfirm: (leadId: string) => void;
  onRelease: (leadId: string) => void;
  claiming: string | null;
}> = ({ lead, currentUserId, agents, onClaim, onConfirm, onRelease, claiming }) => {
  const countdown = useCountdown(lead.locked_at, 30);
  const isLockedByMe = lead.status === "Locked" && lead.locked_by === currentUserId;
  const isLockedByOther = lead.status === "Locked" && lead.locked_by !== currentUserId;
  const isClaimed = lead.status === "Claimed";
  const isQueued = lead.status === "Queued";

  const lockerName = useMemo(() => {
    if (!lead.locked_by) return "Unknown";
    const a = agents.find(ag => ag.id === lead.locked_by);
    return a ? getAgentDisplayName(a) : "Another agent";
  }, [lead.locked_by, agents]);

  const claimerName = useMemo(() => {
    if (!lead.claimed_by) return "Unknown";
    const a = agents.find(ag => ag.id === lead.claimed_by);
    return a ? getAgentDisplayName(a) : "Another agent";
  }, [lead.claimed_by, agents]);

  return (
    <div className={`bg-card border rounded-xl p-4 space-y-3 transition-all ${
      isQueued ? "border-border hover:border-primary/50 hover:shadow-md animate-pulse-subtle" :
      isLockedByMe ? "border-primary shadow-md" :
      isLockedByOther ? "border-warning/50 opacity-75" :
      isClaimed ? "border-success/50 opacity-60" : "border-border"
    }`}>
      {/* Name row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`font-semibold ${isLockedByOther ? "text-muted-foreground" : "text-foreground"}`}>
            {lead.first_name} {lead.last_name}
          </p>
          {lead.state && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground mt-1 inline-block">{lead.state}</span>
          )}
        </div>
        {/* Status badges */}
        {isLockedByOther && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning font-medium whitespace-nowrap">
            Locked by {lockerName}
          </span>
        )}
        {isLockedByMe && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            You locked this lead
          </span>
        )}
        {isClaimed && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium whitespace-nowrap">
            Claimed by {claimerName}
          </span>
        )}
      </div>

      {/* Phone */}
      <div className="flex items-center gap-2 text-sm">
        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
        {isLockedByMe || isClaimed ? (
          <span className="text-foreground">{lead.phone}</span>
        ) : (
          <span className="text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" /> Phone hidden until claimed
          </span>
        )}
      </div>

      {/* Source */}
      {lead.source && (
        <p className="text-xs text-muted-foreground">Source: {lead.source}</p>
      )}

      {/* Countdown timer for locked leads */}
      {(isLockedByMe || isLockedByOther) && lead.status === "Locked" && (
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${countdown <= 10 ? "bg-destructive" : "bg-warning"}`}
              style={{ width: `${(countdown / 30) * 100}%` }}
            />
          </div>
          <span className={`text-xs font-mono font-medium ${countdown <= 10 ? "text-destructive" : "text-muted-foreground"}`}>
            {countdown}s
          </span>
        </div>
      )}

      {/* Actions */}
      {isQueued && (
        <button
          onClick={() => onClaim(lead.id)}
          disabled={claiming === lead.id}
          className="w-full h-10 rounded-lg bg-success text-success-foreground text-sm font-bold hover:bg-success/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {claiming === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Claim Lead
        </button>
      )}
      {isLockedByMe && (
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(lead.id)}
            className="flex-1 h-10 rounded-lg bg-success text-success-foreground text-sm font-bold hover:bg-success/90 transition-all flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" /> Confirm Claim
          </button>
          <button
            onClick={() => onRelease(lead.id)}
            className="h-10 px-4 rounded-lg border border-border text-muted-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> Release
          </button>
        </div>
      )}
      {isLockedByOther && (
        <button disabled className="w-full h-10 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed opacity-50">
          Locked — waiting...
        </button>
      )}
    </div>
  );
};

// ---- Celebration overlay ----
const CelebrationOverlay: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
      <div className="text-6xl animate-bounce">🎉</div>
    </div>
  );
};

// ---- MAIN COMPONENT ----
const CampaignDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [tab, setTab] = useState("Leads");
  const [leadFilter, setLeadFilter] = useState("All");
  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [importCSVOpen, setImportCSVOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [removeLeadId, setRemoveLeadId] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // Settings form
  const [settingsForm, setSettingsForm] = useState<Partial<Campaign>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  const isOpenPool = campaign?.type === "Open Pool";

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from("campaigns").select("*").eq("id", id).single();
    if (data) {
      const c = { ...data, assigned_agent_ids: data.assigned_agent_ids || [] } as Campaign;
      setCampaign(c);
      setSettingsForm(c);
    }
    setLoading(false);
  }, [id]);

  const fetchLeads = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLeadsLoading(true);
    const { data } = await supabase.from("campaign_leads").select("*").eq("campaign_id", id).order("created_at", { ascending: false });
    setLeads((data as CampaignLead[]) || []);
    setLastRefresh(Date.now());
    if (!silent) setLeadsLoading(false);
  }, [id]);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    const { data } = await supabase.from("profiles").select("id, first_name, last_name, email, role");
    if (data) { setAgents((data as AgentProfile[]).filter(a => a.role.toLowerCase() !== "admin")); }
    setAgentsLoading(false);
  }, []);

  useEffect(() => { fetchCampaign(); fetchLeads(); fetchAgents(); }, [fetchCampaign, fetchLeads, fetchAgents]);

  // ---- Open Pool polling: refresh every 5 seconds + clean up expired locks ----
  useEffect(() => {
    if (!isOpenPool || tab !== "Leads" || !id) return;
    const interval = setInterval(async () => {
      // Clean up expired locks
      await supabase
        .from("campaign_leads")
        .update({ status: "Queued", locked_by: null, locked_at: null } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .eq("campaign_id", id)
        .eq("status", "Locked")
        .lt("locked_at", new Date(Date.now() - 30000).toISOString());
      // Refresh queue
      fetchLeads(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [isOpenPool, tab, id, fetchLeads]);

  const existingLeadIds = useMemo(() => new Set(leads.map(l => l.lead_id).filter(Boolean) as string[]), [leads]);

  const filteredLeads = useMemo(() => {
    let filtered = leads;
    if (leadFilter === "Callable Now" && campaign) {
      filtered = leads.filter(l => getLeadCallableStatus(l.state, campaign.calling_hours_start, campaign.calling_hours_end) === "available");
    } else if (leadFilter !== "All") {
      filtered = leads.filter(l => l.status === leadFilter);
    }
    return filtered;
  }, [leads, leadFilter, campaign]);

  // Open Pool stats
  const poolStats = useMemo(() => {
    const available = leads.filter(l => l.status === "Queued").length;
    const locked = leads.filter(l => l.status === "Locked").length;
    const claimed = leads.filter(l => l.status === "Claimed").length;
    return { available, locked, claimed };
  }, [leads]);

  // ---- Claim flow ----
  const handleClaimLead = async (leadId: string) => {
    if (!user) return;
    setClaiming(leadId);
    // Conditional update: only if still Queued
    const { data, error } = await supabase
      .from("campaign_leads")
      .update({ status: "Locked", locked_by: user.id, locked_at: new Date().toISOString() } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .eq("id", leadId)
      .eq("status", "Queued")
      .select();
    if (error || !data || data.length === 0) {
      toast.error("This lead was just claimed by another agent", { duration: 3000, position: "bottom-right" });
      fetchLeads(true);
    } else {
      fetchLeads(true);
    }
    setClaiming(null);
  };

  const handleConfirmClaim = async (leadId: string) => {
    if (!user || !campaign) return;
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    // Update campaign_leads
    const { error } = await supabase
      .from("campaign_leads")
      .update({ status: "Claimed", claimed_by: user.id, claimed_at: new Date().toISOString() } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .eq("id", leadId);
    if (error) { toast.error("Failed to confirm claim", { duration: 3000, position: "bottom-right" }); return; }

    // Create lead in main leads table
    await supabase.from("leads").insert({
      first_name: lead.first_name,
      last_name: lead.last_name,
      phone: lead.phone,
      email: lead.email,
      state: lead.state,
      age: lead.age,
      assigned_agent_id: user.id,
      lead_source: campaign.name,
      status: "New",
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Increment leads_contacted
    await supabase.from("campaigns").update({
      leads_contacted: (campaign.leads_contacted || 0) + 1,
    } as any).eq("id", campaign.id); // eslint-disable-line @typescript-eslint/no-explicit-any

    toast.success("Lead claimed! Added to your contacts.", { duration: 3000, position: "bottom-right" });

    // Celebration
    setShowCelebration(true);
    setTimeout(() => setShowCelebration(false), 1500);

    fetchLeads(true);
    fetchCampaign();
  };

  const handleReleaseLead = async (leadId: string) => {
    const { error } = await supabase
      .from("campaign_leads")
      .update({ status: "Queued", locked_by: null, locked_at: null } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .eq("id", leadId);
    if (error) { toast.error("Failed to release lead", { duration: 3000, position: "bottom-right" }); return; }
    toast.success("Lead released back to the pool", { duration: 3000, position: "bottom-right" });
    fetchLeads(true);
  };

  const handleForceRelease = async (leadId: string) => {
    const { error } = await supabase
      .from("campaign_leads")
      .update({ status: "Queued", locked_by: null, locked_at: null } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .eq("id", leadId);
    if (error) { toast.error("Failed to force release", { duration: 3000, position: "bottom-right" }); return; }
    toast.success("Lead force-released to pool", { duration: 3000, position: "bottom-right" });
    setActionMenuId(null);
    fetchLeads(true);
  };

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
    toast.success("Campaign deleted", { duration: 3000, position: "bottom-right" });
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

  // Settings
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
      name: settingsForm.name, description: settingsForm.description, dial_mode: settingsForm.dial_mode,
      assigned_agent_ids: settingsForm.assigned_agent_ids, calling_hours_start: settingsForm.calling_hours_start,
      calling_hours_end: settingsForm.calling_hours_end, max_retries: settingsForm.max_retries, retry_interval: settingsForm.retry_interval,
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

  // Separate leads for Open Pool agent view
  const queueLeads = filteredLeads.filter(l => l.status === "Queued" || l.status === "Locked");
  const claimedLeads = filteredLeads.filter(l => l.status === "Claimed");
  const otherLeads = filteredLeads.filter(l => !["Queued", "Locked", "Claimed"].includes(l.status));
  const secondsAgo = Math.floor((Date.now() - lastRefresh) / 1000);

  return (
    <div className="space-y-4">
      <CelebrationOverlay show={showCelebration} />

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
        {["Leads", "Stats", "Settings"].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {/* LEADS TAB */}
      {tab === "Leads" && (
        <div className="space-y-4">
          {/* Top bar — always present */}
          <div className="flex items-center gap-3 flex-wrap">
            {(isAdmin || !isOpenPool) && (
              <>
                <button onClick={() => setAddLeadsOpen(true)} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
                  <Plus className="w-4 h-4" /> Add Leads
                </button>
                <button onClick={() => setImportCSVOpen(true)} className="px-3 py-2 rounded-lg border border-border text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent transition-colors">
                  <Upload className="w-4 h-4" /> Import CSV
                </button>
              </>
            )}
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">{leads.length} leads</span>
            <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)} className="h-8 px-2 rounded-lg bg-muted text-sm text-foreground border border-border">
              <option value="All">All</option>
              <option value="Callable Now">Callable Now</option>
              {["Queued", "Locked", "Claimed", "Called", "Skipped", "Completed", "Failed"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* ======= OPEN POOL: AGENT CARD VIEW ======= */}
          {isOpenPool && !isAdmin && (
            <>
              {/* SharkTank Banner */}
              <div className="bg-gradient-to-r from-orange-500/10 via-destructive/5 to-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Zap className="w-6 h-6 text-orange-500" />
                  <div>
                    <h3 className="text-sm font-bold text-foreground">SharkTank Mode</h3>
                    <p className="text-xs text-muted-foreground">Claim leads before other agents — first to confirm wins!</p>
                  </div>
                </div>
               <div className="flex gap-4 ml-auto text-xs">
                  <span className="text-success font-medium">{poolStats.available} available</span>
                  <span className="text-warning font-medium">{poolStats.locked} locked</span>
                  <span className="text-primary font-medium">{poolStats.claimed} claimed</span>
                </div>
              </div>

              {/* Live Leaderboard Widget */}
              <SharkTankLeaderboard leads={leads} agents={agents} />

              {leadsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
                </div>
              ) : queueLeads.length === 0 && claimedLeads.length === 0 && otherLeads.length === 0 ? (
                <div className="bg-card rounded-xl border p-8 text-center">
                  <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">No leads in this campaign yet.</p>
                </div>
              ) : (
                <>
                  {/* Available Queue */}
                  {queueLeads.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-orange-500" /> Available to Claim ({queueLeads.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {queueLeads.map(l => (
                          <SharkTankCard
                            key={l.id}
                            lead={l}
                            currentUserId={user?.id || ""}
                            agents={agents}
                            onClaim={handleClaimLead}
                            onConfirm={handleConfirmClaim}
                            onRelease={handleReleaseLead}
                            claiming={claiming}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Claimed section */}
                  {claimedLeads.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Check className="w-4 h-4 text-success" /> Claimed ({claimedLeads.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {claimedLeads.map(l => (
                          <SharkTankCard
                            key={l.id}
                            lead={l}
                            currentUserId={user?.id || ""}
                            agents={agents}
                            onClaim={handleClaimLead}
                            onConfirm={handleConfirmClaim}
                            onRelease={handleReleaseLead}
                            claiming={claiming}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other statuses */}
                  {otherLeads.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Other ({otherLeads.length})</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {otherLeads.map(l => (
                          <SharkTankCard
                            key={l.id}
                            lead={l}
                            currentUserId={user?.id || ""}
                            agents={agents}
                            onClaim={handleClaimLead}
                            onConfirm={handleConfirmClaim}
                            onRelease={handleReleaseLead}
                            claiming={claiming}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Last updated */}
              <p className="text-xs text-muted-foreground text-center">
                Last updated {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`} · Auto-refreshes every 5s
              </p>
            </>
          )}

          {/* ======= ADMIN TABLE VIEW (Open Pool) or ALL other campaign types ======= */}
          {(!isOpenPool || isAdmin) && (
            <>
              {leadsLoading ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : filteredLeads.length === 0 ? (
                <div className="bg-card rounded-xl border p-8 text-center">
                  <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">No leads in this campaign yet. Add leads to get started.</p>
                </div>
              ) : (
                <div className="bg-card rounded-xl border overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-accent/50 text-muted-foreground">
                      <th className="text-left py-3 px-3 font-medium">Name</th>
                      <th className="text-left py-3 px-3 font-medium">Phone</th>
                      <th className="text-left py-3 px-3 font-medium">Email</th>
                      <th className="text-left py-3 px-3 font-medium">State</th>
                      <th className="text-left py-3 px-3 font-medium">Status</th>
                      {isOpenPool && isAdmin && <th className="text-left py-3 px-3 font-medium">Locked/Claimed By</th>}
                      <th className="text-left py-3 px-3 font-medium">Callable</th>
                      <th className="text-center py-3 px-3 font-medium">Attempts</th>
                      <th className="text-left py-3 px-3 font-medium">Last Called</th>
                      <th className="text-left py-3 px-3 font-medium">Disposition</th>
                      <th className="w-12 py-3"></th>
                    </tr></thead>
                    <tbody>
                      {filteredLeads.map(l => {
                        const hidePhone = campaign.type === "Open Pool" && l.status === "Queued" && l.locked_by !== user?.id;
                        const callableStatus = getLeadCallableStatus(l.state, campaign.calling_hours_start, campaign.calling_hours_end);
                        const ownerAgent = l.locked_by ? agents.find(a => a.id === l.locked_by) : l.claimed_by ? agents.find(a => a.id === l.claimed_by) : null;
                        return (
                          <tr key={l.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
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
                            <td className="py-3 px-3">
                              {callableStatus === "available" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-success/10 text-success">Available</span>}
                              {callableStatus === "outside" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive">Outside Hours</span>}
                              {callableStatus === "nostate" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">No State</span>}
                            </td>
                            <td className="py-3 px-3 text-center text-foreground">{l.call_attempts}</td>
                            <td className="py-3 px-3 text-muted-foreground">{relativeTime(l.last_called_at)}</td>
                            <td className="py-3 px-3">
                              {l.disposition ? <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{l.disposition}</span> : "—"}
                            </td>
                            <td className="py-3 px-3 relative">
                              <button onClick={() => setActionMenuId(actionMenuId === l.id ? null : l.id)} className="text-muted-foreground hover:text-foreground">
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                              {actionMenuId === l.id && (
                                <div className="absolute right-0 top-full z-10 bg-card border rounded-lg shadow-lg py-1 w-48">
                                  {isOpenPool && isAdmin && l.status === "Locked" && (
                                    <button onClick={() => handleForceRelease(l.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-warning hover:bg-accent transition-colors">
                                      <ShieldAlert className="w-4 h-4" /> Force Release
                                    </button>
                                  )}
                                  <button onClick={() => { setRemoveLeadId(l.id); setActionMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors">
                                    <Trash2 className="w-4 h-4" /> Remove from Campaign
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* STATS TAB */}
      {tab === "Stats" && (
        <div className="space-y-4">
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
            <label className="text-xs font-medium text-muted-foreground block mb-1">Dial Mode</label>
            <div className="flex gap-3">
              {["Power", "Predictive"].map(m => (
                <label key={m} className={`flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${settingsForm.dial_mode === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                  <input type="radio" checked={settingsForm.dial_mode === m} onChange={() => handleSettingsChange("dial_mode", m)} className="accent-[hsl(var(--primary))]" />
                  <span className="text-sm font-medium text-foreground">{m}</span>
                </label>
              ))}
            </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Calling Hours Start (lead's local time)</label>
              <input type="time" value={settingsForm.calling_hours_start || "09:00"} onChange={e => handleSettingsChange("calling_hours_start", e.target.value)} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Calling Hours End (lead's local time)</label>
              <input type="time" value={settingsForm.calling_hours_end || "17:00"} onChange={e => handleSettingsChange("calling_hours_end", e.target.value)} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">Leads will only be available for calling when their local time falls within this window</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Max Retries</label>
              <input type="number" min={1} max={10} value={settingsForm.max_retries || 3} onChange={e => handleSettingsChange("max_retries", Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Retry Interval (minutes)</label>
              <input type="number" min={1} value={settingsForm.retry_interval || 60} onChange={e => handleSettingsChange("retry_interval", Math.max(1, parseInt(e.target.value) || 60))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <button onClick={saveSettings} disabled={!settingsDirty || settingsSaving} className="h-9 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2">
            {settingsSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      )}

      {/* Modals */}
      <AddLeadsModal open={addLeadsOpen} onClose={() => setAddLeadsOpen(false)} campaignId={id!} existingLeadIds={existingLeadIds} onAdded={() => { fetchLeads(); fetchCampaign(); }} />
      <ImportCSVModal open={importCSVOpen} onClose={() => setImportCSVOpen(false)} campaignId={id!} onImported={() => { fetchLeads(); fetchCampaign(); }} />
      <ConfirmDialog open={deleteConfirm} title="Delete Campaign?" message="Are you sure you want to delete this campaign? This will also remove all leads assigned to it. This cannot be undone." onConfirm={handleDelete} onClose={() => setDeleteConfirm(false)} />
      <ConfirmDialog open={!!removeLeadId} title="Remove Lead?" message="Remove this lead from the campaign? The lead itself won't be deleted." confirmLabel="Remove" onConfirm={handleRemoveLead} onClose={() => setRemoveLeadId(null)} />
    </div>
  );
};

export default CampaignDetail;
