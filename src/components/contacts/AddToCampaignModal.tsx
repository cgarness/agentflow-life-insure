import React, { useState, useEffect } from "react";
import { X, Search, Loader2, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Campaign } from "@/lib/types";

interface AddToCampaignModalProps {
  open: boolean;
  onClose: () => void;
  selectedContacts: Array<{ id: string; firstName: string; lastName: string; phone: string; email: string; state: string; age?: number }>;
  /** When set (e.g. select-all-leads or cross-page selection), every ID is sent to the campaign RPC instead of only rows in `selectedContacts`. */
  leadIds?: string[] | null;
  onSuccess: () => void;
}

const RPC_BATCH_SIZE = 500;

async function addLeadsToCampaignBatched(
  campaignId: string,
  leadIds: string[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < leadIds.length; i += RPC_BATCH_SIZE) {
    const batch = leadIds.slice(i, i + RPC_BATCH_SIZE);
    const { data, error } = await supabase.rpc("add_leads_to_campaign", {
      p_campaign_id: campaignId,
      p_lead_ids: batch,
    });
    if (error) throw error;
    const result = data as { added: number; skipped: number };
    added += result.added ?? 0;
    skipped += result.skipped ?? 0;
  }
  return { added, skipped };
}

const AddToCampaignModal: React.FC<AddToCampaignModalProps> = ({ open, onClose, selectedContacts, leadIds, onSuccess }) => {
  const { organizationId } = useOrganization();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignType, setNewCampaignType] = useState<"Open Pool" | "Personal" | "Team">("Open Pool");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      fetchCampaigns();
      setSelectedCampaignId(null);
      setActiveTab("existing");
      setNewCampaignName("");
      setNewCampaignType("Open Pool");
    }
  }, [open]);

  const fetchCampaigns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("status", "Active")
      .order("name");
    
    if (error) {
      toast.error("Failed to load active campaigns");
    } else {
      const mapped = (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
        description: c.description,
        assignedAgentIds: c.assigned_agent_ids || [],
        createdBy: c.created_by,
        totalLeads: c.total_leads,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }));
      setCampaigns(mapped as any);
    }
    setLoading(false);
  };

  const effectiveLeadIds = leadIds && leadIds.length > 0 ? leadIds : selectedContacts.map(c => c.id);
  const contactCount = effectiveLeadIds.length;

  const handleAdd = async () => {
    if (!selectedCampaignId) {
      toast.error("Please select a campaign");
      return;
    }
    if (contactCount === 0) {
      toast.error("No contacts selected");
      return;
    }

    setSaving(true);
    try {
      const result = await addLeadsToCampaignBatched(selectedCampaignId, effectiveLeadIds);
      const campaignName = campaigns.find(c => c.id === selectedCampaignId)?.name || "campaign";

      if (result.added === 0 && result.skipped > 0) {
        toast.info(`All ${result.skipped} leads skipped — not eligible for this campaign`);
      } else if (result.skipped > 0) {
        toast.success(`${result.added} leads added to ${campaignName}, ${result.skipped} skipped`, { duration: 4000, position: "bottom-right" });
      } else {
        toast.success(`${result.added} leads added to ${campaignName}`, { duration: 3000, position: "bottom-right" });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error("Failed to add contacts: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newCampaignName.trim()) {
      toast.error("Please enter a campaign name");
      return;
    }
    if (contactCount === 0) {
      toast.error("No contacts selected");
      return;
    }

    setCreating(true);
    try {
      const { data: newCampaign, error: createError } = await supabase
        .from("campaigns")
        .insert({
          name: newCampaignName.trim(),
          type: newCampaignType,
          status: "Active",
          total_leads: 0,
          organization_id: organizationId,
        } as any)
        .select("*")
        .maybeSingle();

      if (createError) throw createError;

      const result = await addLeadsToCampaignBatched(newCampaign.id, effectiveLeadIds);
      if (result.skipped > 0) {
        toast.success(`Campaign created — ${result.added} leads added, ${result.skipped} skipped`, { duration: 4000, position: "bottom-right" });
      } else {
        toast.success(`Campaign created and ${result.added} leads added`, { duration: 3000, position: "bottom-right" });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error("Failed to create campaign: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  const filteredCampaigns = campaigns.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedCampaignName = campaigns.find(c => c.id === selectedCampaignId)?.name || "campaign";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Add to Campaign</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Two-tab selector */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("existing")}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${activeTab === "existing" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Add to Existing
          </button>
          <button
            onClick={() => setActiveTab("new")}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${activeTab === "new" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Create New Campaign
          </button>
        </div>

        {/* Add to Existing tab */}
        {activeTab === "existing" && (
          <>
            <p className="text-sm text-muted-foreground">
              Select an active campaign to add {contactCount} contact{contactCount !== 1 ? "s" : ""} to.
            </p>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1 border rounded-lg p-1 bg-muted/30">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active campaigns found</p>
              ) : (
                filteredCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCampaignId(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedCampaignId === c.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent text-foreground"
                    }`}
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className={`text-xs ${selectedCampaignId === c.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {c.type} • {c.totalLeads || 0} leads
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-10 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving || !selectedCampaignId}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Add to Campaign
              </button>
            </div>
          </>
        )}

        {/* Create New Campaign tab */}
        {activeTab === "new" && (
          <>
            <p className="text-sm text-muted-foreground">
              Create a new campaign and add {contactCount} contact{contactCount !== 1 ? "s" : ""} to it.
            </p>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={newCampaignName}
                onChange={e => setNewCampaignName(e.target.value)}
                placeholder="Enter campaign name..."
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Type</label>
              <select
                value={newCampaignType}
                onChange={e => setNewCampaignType(e.target.value as "Open Pool" | "Personal" | "Team")}
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                <option value="Open Pool">Open Pool</option>
                <option value="Personal">Personal</option>
                <option value="Team">Team</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-10 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAndAdd}
                disabled={creating || !newCampaignName.trim()}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create & Add Leads
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AddToCampaignModal;
