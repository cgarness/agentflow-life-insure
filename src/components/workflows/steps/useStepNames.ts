import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { automationApi } from "@/lib/automation-api";
import { triggerNode, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";
import type { SummaryNames } from "../../../../supabase/functions/_shared/automations/blockRegistry";

/** Display names for step summaries. A failed or pending lookup falls back to neutral wording in the summary. */
export function useStepNames(scope: string, graph: AutomationGraph): SummaryNames {
  const trigger = triggerNode(graph);
  const campaignId = typeof trigger?.config.campaign_id === "string" ? trigger.config.campaign_id : "";
  const needsDispositions = trigger?.type === "disposition_recorded";
  const campaign = useQuery({
    queryKey: ["automation-campaign-name", scope, campaignId],
    queryFn: () => automationApi.campaigns("", campaignId),
    enabled: !!campaignId,
    staleTime: 60_000,
    retry: false,
  });
  const dispositions = useQuery({
    queryKey: ["automation-dispositions", scope],
    queryFn: () => automationApi.dispositions(),
    enabled: needsDispositions,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo<SummaryNames>(() => ({
    campaign: id => campaign.data?.selected?.id === id
      ? campaign.data.selected.name
      : campaign.data?.items.find(option => option.id === id)?.name,
    disposition: id => dispositions.data?.find(option => option.id === id)?.name,
  }), [campaign.data, dispositions.data]);
}
