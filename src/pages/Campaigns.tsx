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
import { CreateCampaignModal } from "@/components/campaigns/CreateCampaignModal";

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
  // TODO: add leads_called column to campaigns table and remove fallback
  leads_called: number;
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
  const { organizationId } = useOrganization();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setCampaigns(data.map((r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        ...r,
        assigned_agent_ids: r.assigned_agent_ids || [],
        tags: r.tags || [],
        // TODO: remove fallback once leads_called column exists on campaigns table
        leads_called: r.leads_called ?? 0,
      })));
    }
    setLoading(false);
  }, [organizationId]);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role, avatar_url")
      .eq("status", "Active");
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
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { label: "Total", value: c.total_leads },
                  { label: "Called", value: c.leads_called },
                  { label: "Contacted", value: c.leads_contacted },
                  { label: "Converted", value: c.leads_converted },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/40 rounded-lg p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
                    <p className="text-xl font-bold text-foreground">{value}</p>
                  </div>
                ))}
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
