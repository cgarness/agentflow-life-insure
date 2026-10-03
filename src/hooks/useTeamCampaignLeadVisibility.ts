import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  canShowTeamCampaignLeadDetails,
  type TeamLeadDisplayConfirmation,
  type TeamLeadDisplayVisit,
} from "@/lib/teamCampaignLeadVisibility";

interface Args {
  enabled: boolean;
  organizationId: string | null;
  viewerId: string | null;
  campaignId: string | null;
  lead: Record<string, unknown> | null;
  confirmedLockLeadId: string | null;
  loading: boolean;
  advancing: boolean;
}

type ConfirmLoad = (lockedRow: Record<string, unknown>) => void;
const ignoreLoad: ConfirmLoad = () => {};

/**
 * Presentation only. A new visit is a new object, including A → B → A. Each existing queue load
 * receives a one-use, generation-bound display confirmation; stale starts and finishes do nothing.
 * There is no read, timer, lock operation, call-state mutation, or ownership change in this hook.
 */
export function useTeamCampaignLeadVisibility(i: Args) {
  const visit = useMemo<TeamLeadDisplayVisit | null>(
    () => i.enabled && i.organizationId && i.viewerId && i.campaignId
      ? { organizationId: i.organizationId, viewerId: i.viewerId, campaignId: i.campaignId }
      : null,
    [i.enabled, i.organizationId, i.viewerId, i.campaignId],
  );
  const activeVisitRef = useRef(visit);
  const generationRef = useRef(0);
  const [confirmation, setConfirmation] = useState<TeamLeadDisplayConfirmation | null>(null);

  useLayoutEffect(() => {
    activeVisitRef.current = visit;
    return () => {
      activeVisitRef.current = null;
      generationRef.current += 1;
    };
  }, [visit]);

  const beginLoad = useCallback((): ConfirmLoad => {
    if (!visit || activeVisitRef.current !== visit) return ignoreLoad;
    const generation = ++generationRef.current;
    setConfirmation(null);
    let completed = false;
    return (lockedRow) => {
      if (completed || activeVisitRef.current !== visit || generationRef.current !== generation) return;
      completed = true;
      if (lockedRow.organization_id !== visit.organizationId || lockedRow.campaign_id !== visit.campaignId ||
          typeof lockedRow.id !== "string" || !lockedRow.id || typeof lockedRow.lead_id !== "string" || !lockedRow.lead_id) return;
      setConfirmation({ visit, campaignLeadId: lockedRow.id, leadId: lockedRow.lead_id });
    };
  }, [visit]);

  return {
    beginLoad,
    visible: canShowTeamCampaignLeadDetails({
      visit, confirmation, lead: i.lead, confirmedLockLeadId: i.confirmedLockLeadId,
      loading: i.loading, advancing: i.advancing,
    }),
  };
}
