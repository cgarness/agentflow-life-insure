import React from "react";
import { cn } from "@/lib/utils";
import {
  TRACKER_ISSUE_SEVERITY_LABELS,
  TRACKER_ISSUE_SEVERITY_TONES,
  TRACKER_ISSUE_STATUS_LABELS,
  TRACKER_ISSUE_STATUS_TONES,
  TRACKER_MARKETABLE_LABELS,
  TRACKER_MARKETABLE_TONES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_PRIORITY_TONES,
  TRACKER_REALITY_STATUS_LABELS,
  TRACKER_REALITY_STATUS_TONES,
  TRACKER_STATUS_LABELS,
  TRACKER_STATUS_TONES,
  type TrackerIssueSeverity,
  type TrackerIssueStatus,
  type TrackerMarketableStatus,
  type TrackerPriority,
  type TrackerRealityStatus,
  type TrackerStatus,
} from "@/lib/control-center/trackerTypes";

const PILL =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

function Pill({ tone, label, className }: { tone: string; label: string; className?: string }) {
  return <span className={cn(PILL, tone, className)}>{label}</span>;
}

export const StatusPill: React.FC<{ status: TrackerStatus; className?: string }> = ({
  status,
  className,
}) => <Pill tone={TRACKER_STATUS_TONES[status]} label={TRACKER_STATUS_LABELS[status]} className={className} />;

export const PriorityPill: React.FC<{ priority: TrackerPriority; className?: string }> = ({
  priority,
  className,
}) => (
  <Pill
    tone={TRACKER_PRIORITY_TONES[priority]}
    label={TRACKER_PRIORITY_LABELS[priority]}
    className={className}
  />
);

export const MarketablePill: React.FC<{
  marketable: TrackerMarketableStatus;
  className?: string;
}> = ({ marketable, className }) => (
  <Pill
    tone={TRACKER_MARKETABLE_TONES[marketable]}
    label={TRACKER_MARKETABLE_LABELS[marketable]}
    className={className}
  />
);

export const SeverityPill: React.FC<{ severity: TrackerIssueSeverity; className?: string }> = ({
  severity,
  className,
}) => (
  <Pill
    tone={TRACKER_ISSUE_SEVERITY_TONES[severity]}
    label={TRACKER_ISSUE_SEVERITY_LABELS[severity]}
    className={className}
  />
);

export const IssueStatusPill: React.FC<{ status: TrackerIssueStatus; className?: string }> = ({
  status,
  className,
}) => (
  <Pill
    tone={TRACKER_ISSUE_STATUS_TONES[status]}
    label={TRACKER_ISSUE_STATUS_LABELS[status]}
    className={className}
  />
);

export const RealityPill: React.FC<{ reality: TrackerRealityStatus; className?: string }> = ({
  reality,
  className,
}) => (
  <Pill
    tone={TRACKER_REALITY_STATUS_TONES[reality]}
    label={TRACKER_REALITY_STATUS_LABELS[reality]}
    className={className}
  />
);
