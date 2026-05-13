import React from "react";
import StatCard from "./StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ReportCallSummary,
  ReportDispositionBreakdown,
  ReportCallVolumeTimeseries,
  AgentProfile,
} from "@/lib/reports-queries";
import { computeAllStats, StatResult, STAT_DEFINITIONS } from "@/lib/stat-computations";

interface Props {
  summary?: ReportCallSummary;
  breakdown?: ReportDispositionBreakdown;
  volume?: ReportCallVolumeTimeseries;
  sessions?: { duration_seconds?: number }[];
  agents?: AgentProfile[];
  activeLeadsCount?: number;
  dispositions?: {
    name: string;
    auto_add_to_dnc?: boolean;
    callback_scheduler?: boolean;
    appointment_scheduler?: boolean;
  }[];
  dateRange?: { from?: Date; to?: Date };
  loading: boolean;
}

/**
 * Builds a Map of all 62 stat IDs → computed StatResult.
 * The SectionRenderer reads this map to render visible stats and the edit-mode picker.
 */
export function buildStatResults(props: Props): Map<string, StatResult> {
  return computeAllStats({
    summary: props.summary,
    breakdown: props.breakdown,
    volume: props.volume,
    sessions: props.sessions,
    agents: props.agents,
    activeLeadsCount: props.activeLeadsCount,
    dispositions: props.dispositions,
    dateRange: props.dateRange,
  });
}

/** Map results to React nodes keyed by stat id. */
export function buildStatComponents(props: Props): Record<string, React.ReactNode> {
  // When loading, return skeleton placeholders for all stat cards
  if (props.loading) {
    const skeletonComponents: Record<string, React.ReactNode> = {};
    STAT_DEFINITIONS.forEach(def => {
      skeletonComponents[def.id] = (
        <div className="bg-card border border-border/50 rounded-[1.5rem] p-5 flex flex-col justify-between min-h-[120px] animate-pulse">
          <div><Skeleton className="h-3 w-20 mb-3 rounded" /><Skeleton className="h-8 w-16 rounded" /></div>
          <Skeleton className="h-3 w-24 mt-4 rounded" />
        </div>
      );
    });
    return skeletonComponents;
  }

  const results = buildStatResults(props);
  const components: Record<string, React.ReactNode> = {};
  results.forEach((r, id) => {
    components[id] = (
      <StatCard
        label={r.label}
        value={r.value}
        subtitle={r.subtitle}
        category={r.category}
        comingSoon={r.comingSoon}
        noData={r.noData}
        smallValue={r.smallValue}
      />
    );
  });
  return components;
}
