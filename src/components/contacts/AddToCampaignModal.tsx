import React, { useState, useEffect } from "react";
import { X, Loader2, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { addLeadsToCampaignBatched } from "@/lib/supabase-campaign-leads";
import { useAuth } from "@/contexts/AuthContext";
import { useAddToCampaignOptions } from "@/hooks/useAddToCampaignOptions";
import AddToCampaignExistingList from "@/components/contacts/AddToCampaignExistingList";
import {
  addToCampaignSubmitSchema,
  attachErrorMessage,
  describeAttachResult,
} from "@/components/contacts/addToCampaignOptions";

interface AddToCampaignModalProps {
  open: boolean;
  onClose: () => void;
  selectedContacts: Array<{ id: string; firstName: string; lastName: string; phone: string; email: string; state: string; age?: number }>;
  /** When set (e.g. select-all-leads or cross-page selection), every ID is sent to the campaign RPC instead of only rows in `selectedContacts`. */
  leadIds?: string[] | null;
  onSuccess: () => void;
}

const AddToCampaignModal: React.FC<AddToCampaignModalProps> = ({ open, onClose, selectedContacts, leadIds, onSuccess }) => {
  const { organizationId } = useOrganization();
  const { user, profile } = useAuth();
  const { status: campaignsStatus, options: campaigns, retry: retryCampaigns } = useAddToCampaignOptions({
    open,
    orgId: organizationId,
    userId: user?.id ?? null,
    profileRole: profile?.role ?? null,
    isSuperAdmin: Boolean(profile?.is_super_admin),
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignType, setNewCampaignType] = useState<"Open Pool" | "Personal" | "Team">("Open Pool");
  const [creating, setCreating] = useState(false);

  // Reset form state when the modal opens. Deliberately keyed on `open` ONLY, so a change
  // in org/user identity can never wipe the user's in-progress selection.
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedCampaignId(null);
      setActiveTab("existing");
      setNewCampaignName("");
      setNewCampaignType("Open Pool");
    }
  }, [open]);

  // Only a campaign in the CURRENT identity's loaded options can be submitted; a selection
  // kept across an org/user change stays visible but is not addable.
  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) ?? null;
  const effectiveLeadIds = leadIds && leadIds.length > 0 ? leadIds : selectedContacts.map(c => c.id);
  const contactCount = effectiveLeadIds.length;

  const handleAdd = async () => {
    const parsed = addToCampaignSubmitSchema.safeParse({
      campaignId: selectedCampaign?.id ?? "",
      leadIds: effectiveLeadIds,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please select a campaign");
      return;
    }

    setSaving(true);
    try {
      const result = await addLeadsToCampaignBatched(parsed.data.campaignId, parsed.data.leadIds);
      const { kind, message, duration } = describeAttachResult(result, selectedCampaign?.name || "campaign");
      toast[kind](message, { duration, position: "bottom-right" });

      onSuccess();
      onClose();
    } catch (err) {
      toast.error(attachErrorMessage(err));
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
          created_by: user?.id ?? null,
          // Without participants a Team campaign is invisible to every Agent
          // (campaigns_select requires auth.uid() to be in assigned_agent_ids).
          assigned_agent_ids: newCampaignType === "Team" && user?.id ? [user.id] : [],
        } as any)
        .select("*")
        .maybeSingle();

      if (createError) throw createError;

      const result = await addLeadsToCampaignBatched(newCampaign.id, effectiveLeadIds);
      if (result.added === 0 && result.skipped > 0) {
        // Campaign exists but is empty — reporting this as a success is what let a
        // 106-lead import look complete. Say what actually happened.
        toast.error(`Campaign created, but no leads were added — all ${result.skipped} are not eligible for it.`, { duration: 5000, position: "bottom-right" });
      } else if (result.skipped > 0) {
        toast.warning(`Campaign created — ${result.added} leads added, ${result.skipped} not added`, { duration: 4000, position: "bottom-right" });
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

            <AddToCampaignExistingList
              status={campaignsStatus}
              options={campaigns}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedId={selectedCampaignId}
              onSelect={setSelectedCampaignId}
              onRetry={retryCampaigns}
            />

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
                disabled={saving || !selectedCampaign}
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
