import React, { useEffect, useState, useMemo } from "react";
import { filterCampaignsForAssignee } from "@/lib/campaign-assignee-scope";
import { supabase } from "@/integrations/supabase/client";

export type AssignToMode = "myself" | "specific_agent";

export type CampaignRowForLead = {
  id: string;
  name: string;
  type: string;
  status?: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
};

interface AddLeadAssignmentSectionProps {
  currentUserId: string | null | undefined;
  /** Exact profile/JWT role, e.g. Team Leader */
  viewerRole: string;
  viewerIsSuperAdmin: boolean;
  assignableAgents: { id: string; firstName: string; lastName: string }[];
  assignMode: AssignToMode;
  onAssignModeChange: (m: AssignToMode) => void;
  specificAgentId: string;
  onSpecificAgentChange: (id: string) => void;
  organizationId: string | null | undefined;
  /** Effective assignee (self or picked agent). */
  resolvedAssigneeId: string | null | undefined;
  attachCampaignId: string;
  onAttachCampaignChange: (id: string) => void;
}

function canPickOtherAgents(role: string, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  return role === "Admin" || role === "Team Leader";
}

export const AddLeadAssignmentSection: React.FC<AddLeadAssignmentSectionProps> = ({
  currentUserId,
  viewerRole,
  viewerIsSuperAdmin,
  assignableAgents,
  assignMode,
  onAssignModeChange,
  specificAgentId,
  onSpecificAgentChange,
  organizationId,
  resolvedAssigneeId,
  attachCampaignId,
  onAttachCampaignChange,
}) => {
  const [campaignList, setCampaignList] = useState<CampaignRowForLead[]>([]);
  const elevate = canPickOtherAgents(viewerRole, viewerIsSuperAdmin);
  const showCampaignAttach =
    elevate && !!resolvedAssigneeId && !!currentUserId && resolvedAssigneeId !== currentUserId;

  useEffect(() => {
    if (!showCampaignAttach || !resolvedAssigneeId || !organizationId) {
      setCampaignList([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, type, status, user_id, assigned_agent_ids")
        .eq("organization_id", organizationId)
        .eq("status", "Active")
        .order("name", { ascending: true });

      if (cancelled) return;
      if (error || !data) {
        setCampaignList([]);
        return;
      }

      const rows = data as CampaignRowForLead[];
      const filtered = rows.filter((c) =>
        filterCampaignsForAssignee([c], resolvedAssigneeId).length > 0,
      );
      setCampaignList(filtered);
    })();

    return () => {
      cancelled = true;
    };
  }, [showCampaignAttach, resolvedAssigneeId, organizationId]);

  const options = useMemo(() => campaignList, [campaignList]);

  if (!elevate) return null;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <label className="text-xs font-medium text-muted-foreground block">Assign To</label>
      <select
        value={assignMode}
        onChange={(e) => onAssignModeChange(e.target.value as AssignToMode)}
        className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
      >
        <option value="myself">Myself</option>
        <option value="specific_agent">Specific Agent</option>
      </select>

      {assignMode === "specific_agent" && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Agent</label>
          <select
            value={specificAgentId}
            onChange={(e) => onSpecificAgentChange(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
          >
            <option value="">Select an agent…</option>
            {assignableAgents
              .filter((a) => a.id !== currentUserId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.firstName, a.lastName].filter(Boolean).join(" ") || a.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </div>
      )}

      {showCampaignAttach && options.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Attach to Campaign (optional)
          </label>
          <select
            value={attachCampaignId || ""}
            onChange={(e) => onAttachCampaignChange(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
          >
            <option value="">None — save without a campaign queue</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type} — {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Their Personal queues, Team queues they are on, and Open Pool queues.
          </p>
        </div>
      )}

      {showCampaignAttach && options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No qualifying campaigns — you can save the lead without a queue.
        </p>
      )}
    </div>
  );
};
