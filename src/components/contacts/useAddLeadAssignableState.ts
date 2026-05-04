import { useCallback, useMemo, useState } from "react";

export type LeadAssignUiMode = "myself" | "specific_agent";

export function useAddLeadAssignableState(opts: {
  initial: Partial<unknown> | null | undefined;
  currentUserId?: string | null;
  viewerRole?: string;
  viewerIsSuperAdmin?: boolean;
  assignableAgents: { id: string; firstName: string; lastName: string }[];
}) {
  const {
    initial,
    currentUserId,
    viewerRole = "Agent",
    viewerIsSuperAdmin = false,
    assignableAgents,
  } = opts;

  const [assignMode, setAssignMode] = useState<LeadAssignUiMode>("myself");
  const [specificAgentId, setSpecificAgentId] = useState("");
  const [attachCampaignId, setAttachCampaignId] = useState("");

  const canElevateLeadAssignment =
    viewerIsSuperAdmin || viewerRole === "Admin" || viewerRole === "Team Leader";

  const resolvedAssigneeId = useMemo(() => {
    if (initial || !canElevateLeadAssignment || !currentUserId) return currentUserId ?? null;
    if (assignMode === "myself") return currentUserId;
    return specificAgentId || null;
  }, [initial, canElevateLeadAssignment, currentUserId, assignMode, specificAgentId]);

  const validateAssignment = useCallback((): string | null => {
    if (initial || !currentUserId) return null;
    if (!canElevateLeadAssignment) return null;
    if (assignMode === "specific_agent") {
      if (!specificAgentId) return "Select an agent to assign.";
      const allowedIds = assignableAgents.map((a) => a.id);
      if (!allowedIds.includes(specificAgentId))
        return "Pick an agent you are allowed to assign.";
    }
    return null;
  }, [initial, currentUserId, canElevateLeadAssignment, assignMode, specificAgentId, assignableAgents]);

  const resetAssignFields = useCallback(() => {
    setAssignMode("myself");
    setSpecificAgentId("");
    setAttachCampaignId("");
  }, []);

  return {
    assignMode,
    setAssignMode,
    specificAgentId,
    setSpecificAgentId,
    attachCampaignId,
    setAttachCampaignId,
    resolvedAssigneeId,
    validateAssignment,
    resetAssignFields,
    canElevateLeadAssignment,
  };
}
