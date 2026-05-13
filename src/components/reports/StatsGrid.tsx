import React from "react";
import StatCard from "./StatCard";
import {
  ReportCallSummary,
  ReportDispositionBreakdown,
  ReportCallVolumeTimeseries,
  AgentProfile,
} from "@/lib/reports-queries";
import { computeAllStats, StatResult } from "@/lib/stat-computations";

interface Props {
  summary?: ReportCallSummary;
  compSummary?: ReportCallSummary;
  breakdown?: ReportDispositionBreakdown;
  compBreakdown?: ReportDispositionBreakdown;
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
  comparing: boolean;
  loading: boolean;
}

/**
 * Builds a Map of all 62 stat IDs → computed StatResult.
 * The SectionRenderer reads this map to render visible stats and the edit-mode picker.
 */
export function buildStatResults(props: Props): Map<string, StatResult> {
  return computeAllStats({
    summary: props.summary,
    compSummary: props.compSummary,
    breakdown: props.breakdown,
    compBreakdown: props.compBreakdown,
    volume: props.volume,
    sessions: props.sessions,
    agents: props.agents,
    activeLeadsCount: props.activeLeadsCount,
    dispositions: props.dispositions,
    dateRange: props.dateRange,
    comparing: props.comparing,
  });
}

/** Map results to React nodes keyed by stat id. */
export function buildStatComponents(props: Props): Record<string, React.ReactNode> {
  const results = buildStatResults(props);
  const components: Record<string, React.ReactNode> = {};
  results.forEach((r, id) => {
    components[id] = (
      <StatCard
        label={r.label}
        value={r.value}
        subtitle={r.subtitle}
        trend={r.trend}
        category={r.category}
        comingSoon={r.comingSoon}
        noData={r.noData}
        smallValue={r.smallValue}
      />
    );
  });
  return components;
}
