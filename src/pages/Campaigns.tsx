import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Megaphone, X, Loader2, Users, Tag, Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useBranding } from "@/contexts/BrandingContext";

// Types
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

interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
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


function getAgentDisplayName(a: AgentProfile): string {
  const full = `${a.first_name} ${a.last_name}`.trim();
  return full || a.email || "Unknown";
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
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-foreground">
            {tag}
            <button onClick={() => onChange(tags.filter(t => t !== tag))} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      {tags.length < max && (
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) addTag(input); }}
          placeholder="Type a tag and press Enter..."
          className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        />
      )}
      <p className="text-xs text-muted-foreground mt-1">{tags.length}/{max} tags</p>
    </div>
  );
};

// ---- Create Campaign Modal ----
const CreateCampaignModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  agents: AgentProfile[];
  agentsLoading: boolean;
}> = ({ open, onClose, onCreated, agents, agentsLoading }) => {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const [name, setName] = useState("");
  const [type, setType] = useState("Personal");
  const [description, setDescription] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [agentError, setAgentError] = useState(false);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(""); setType("Personal"); setDescription("");
      setSelectedAgents([]); setTags([]); setSaving(false); setNameError(false); setAgentError(false);
    }
  }, [open]);

  useEffect(() => {
    if (type === "Personal" && selectedAgents.length > 1) {
      setSelectedAgents([selectedAgents[0]]);
    }
  }, [type]);

  const toggleAgent = (id: string) => {
    if (type === "Personal") {
      setSelectedAgents([id]);
    } else {
      setSelectedAgents(prev =>
        prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
      );
    }
    setAgentError(false);
  };

  const handleSubmit = async () => {
    let hasErr = false;
    if (!name.trim()) { setNameError(true); hasErr = true; }
    if (selectedAgents.length === 0) { setAgentError(true); hasErr = true; }
    if (hasErr) return;

    setSaving(true);
    const { error } = await supabase.from("campaigns").insert({
      name: name.trim(),
      type,
      description: description.trim(),
      assigned_agent_ids: selectedAgents,
      tags: tags,
      status: "Active",
      created_by: user?.id || null,
      organization_id: organizationId,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    setSaving(false);
    if (error) {
      toast.error("Failed to create campaign: " + error.message, { duration: 3000, position: "bottom-right" });
    } else {
      toast.success("Campaign created successfully", { duration: 3000, position: "bottom-right" });
      onCreated();
      onClose();
    }
  };

  if (!open) return null;

  const typeOptions = [
    { value: "Open Pool", desc: "All assigned agents compete for the same leads in real time" },
    { value: "Personal", desc: "Agent manages their own private lead list" },
    { value: "Team", desc: "Admin assigns specific leads to specific agents" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Create Campaign</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name *</label>
          <input
            value={name} onChange={e => { setName(e.target.value); setNameError(false); }}
            className={`w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border focus:ring-2 focus:ring-primary/50 focus:outline-none ${nameError ? "border-destructive" : "border-border"}`}
            placeholder="e.g. Q1 Facebook Leads"
          />
          {nameError && <p className="text-xs text-destructive mt-1">Campaign name is required</p>}
        </div>

        {/* Type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Type</label>
          <div className="space-y-2">
            {typeOptions.map(opt => (
              <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${type === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                <input type="radio" name="type" checked={type === opt.value} onChange={() => setType(opt.value)} className="mt-0.5 accent-[hsl(var(--primary))]" />
                <div>
                  <span className="text-sm font-medium text-foreground">{opt.value}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
          <textarea
            value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
            className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none"
            placeholder="Brief description..."
          />
          <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Tags</label>
          <TagInput tags={tags} onChange={setTags} max={10} />
        </div>

        {/* Assigned Agents */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            {type === "Personal" ? "Assigned Agent *" : "Assigned Agents *"}
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
              className={`w-full h-9 px-3 rounded-lg bg-muted text-sm text-left border focus:ring-2 focus:ring-primary/50 focus:outline-none flex items-center justify-between ${agentError ? "border-destructive" : "border-border"}`}
            >
              <span className={selectedAgents.length ? "text-foreground" : "text-muted-foreground"}>
                {selectedAgents.length === 0
                  ? "Select agent(s)..."
                  : agents.filter(a => selectedAgents.includes(a.id)).map(a => getAgentDisplayName(a)).join(", ")}
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
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAgent(a.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedAgents.includes(a.id) ? "bg-primary border-primary" : "border-border"}`}>
                        {selectedAgents.includes(a.id) && <span className="text-primary-foreground text-[10px]">✓</span>}
                      </div>
                      <span className="text-foreground">{getAgentDisplayName(a)}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {agentError && <p className="text-xs text-destructive mt-1">At least one agent must be assigned</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Campaign
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Lead Health Bar ----
const LeadHealthBar: React.FC<{ total: number; contacted: number; converted: number }> = ({ total, contacted, converted }) => {
  if (total === 0) return <div className="h-1.5 w-full bg-muted rounded-full mt-3" />;
  const convertedPct = (converted / total) * 100;
  const contactedPct = ((contacted - converted) / total) * 100;
  const untouched = total - contacted;
  const untouchedPct = (untouched / total) * 100;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-1.5 w-full bg-muted rounded-full mt-3 overflow-hidden flex">
            {convertedPct > 0 && <div className="h-full bg-success transition-all" style={{ width: `${convertedPct}%` }} />}
            {contactedPct > 0 && <div className="h-full bg-primary transition-all" style={{ width: `${contactedPct}%` }} />}
            {untouchedPct > 0 && <div className="h-full bg-muted-foreground/20 transition-all" style={{ width: `${untouchedPct}%` }} />}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{converted} converted · {contacted} contacted · {untouched} untouched</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ---- Duplicate Campaign Modal ----
const DuplicateCampaignModal: React.FC<{
  campaign: Campaign | null;
  onClose: () => void;
  onDuplicated: () => void;
}> = ({ campaign, onClose, onDuplicated }) => {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (campaign) setSaving(false);
  }, [campaign]);

  const handleDuplicate = async () => {
    if (!campaign) return;
    setSaving(true);

    // SECURITY: Leads are never copied under any circumstance.
    const { error } = await supabase.from("campaigns").insert({
      name: `${campaign.name} (Copy)`,
      type: campaign.type,
      description: campaign.description,
      assigned_agent_ids: campaign.assigned_agent_ids,
      tags: campaign.tags,
      status: "Draft",
      total_leads: 0,
      leads_contacted: 0,
      leads_converted: 0,
      created_by: user?.id || null,
      organization_id: organizationId,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    setSaving(false);
    if (error) {
      toast.error("Failed to duplicate campaign", { duration: 3000, position: "bottom-right" });
      return;
    }

    toast.success("Campaign duplicated. Find it in your Draft campaigns.", { duration: 3000, position: "bottom-right" });
    onDuplicated();
    onClose();
  };

  if (!campaign) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Duplicate Campaign</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-muted-foreground">
          This will create a copy of <span className="font-medium text-foreground">{campaign.name}</span> as a Draft. No leads will be carried over.
        </p>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
          <button onClick={handleDuplicate} disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Duplicate Campaign
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Main Campaigns Page ----
const Campaigns: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<Campaign | null>(null);
  const { formatDate } = useBranding();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setCampaigns(data.map((r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        ...r,
        assigned_agent_ids: r.assigned_agent_ids || [],
        tags: r.tags || [],
      })));
    }
    setLoading(false);
  }, []);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role");
    if (data) {
      setAgents(data as AgentProfile[]);
    }
    setAgentsLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); fetchAgents(); }, [fetchCampaigns, fetchAgents]);

  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      if (typeFilter !== "All" && c.type !== typeFilter) return false;
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [campaigns, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
        <button onClick={() => setCreateOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Create Campaign
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
          <option value="All">All Types</option>
          <option value="Open Pool">Open Pool</option>
          <option value="Personal">Personal</option>
          <option value="Team">Team</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
          <option value="All">All Statuses</option>
          {["Draft", "Active", "Paused", "Completed", "Archived"].map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border p-5 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <div className="flex gap-2"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /></div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-4"><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-16" /></div>
            </div>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Megaphone className="w-16 h-16 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No campaigns yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Create your first campaign to start reaching leads</p>
          <button onClick={() => setCreateOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Create Campaign
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No campaigns match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className="bg-card rounded-xl border p-5 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group" onClick={() => navigate(`/campaigns/${c.id}`)}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-foreground truncate pr-2">{c.name}</h3>
                <div className="flex gap-1.5 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${TYPE_COLORS[c.type] || "bg-muted text-muted-foreground"}`}>{c.type}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[c.status] || "bg-muted text-muted-foreground"}`}>{c.status}</span>
                </div>
              </div>
              {c.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{c.description}</p>
              )}
              {/* Tags */}
              {c.tags && c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {c.tags.map((tag: string) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground">
                      <Tag className="w-2.5 h-2.5" />{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-4 mb-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.total_leads}</p>
                  <p className="text-[10px] text-muted-foreground">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.leads_contacted}</p>
                  <p className="text-[10px] text-muted-foreground">Contacted</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.leads_converted}</p>
                  <p className="text-[10px] text-muted-foreground">Converted</p>
                </div>
              </div>
              {/* Lead Health Bar */}
              <LeadHealthBar total={c.total_leads} contacted={c.leads_contacted} converted={c.leads_converted} />
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const role = profile?.role?.toLowerCase();
                    const isAdmin = role === "admin";
                    const isTeamLeader = role === "team leader" || role === "team_leader";
                    const isAgent = role === "agent";
                    const isOwner = c.created_by === user?.id || c.assigned_agent_ids.includes(user?.id ?? "");
                    if (isAgent) return null;
                    const canDuplicate = isAdmin || (isTeamLeader && isOwner);
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={e => { e.stopPropagation(); if (canDuplicate) setDuplicateTarget(c); }}
                              disabled={!canDuplicate}
                              className="text-xs p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">{canDuplicate ? "Duplicate campaign" : "Only the campaign owner can duplicate"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/campaigns/${c.id}`); }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
                  >
                    View Campaign
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateCampaignModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={fetchCampaigns} agents={agents} agentsLoading={agentsLoading} />
      <DuplicateCampaignModal campaign={duplicateTarget} onClose={() => setDuplicateTarget(null)} onDuplicated={fetchCampaigns} />
    </div>
  );
};

export default Campaigns;
