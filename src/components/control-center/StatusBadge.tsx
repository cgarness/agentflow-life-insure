import React from "react";
import { cn } from "@/lib/utils";
import {
  FEATURE_STATUS_LABELS,
  HEALTH_STATUS_LABELS,
  ISSUE_STATUS_LABELS,
  type FeatureStatus,
  type HealthStatus,
  type IssueStatus,
} from "@/lib/control-center/constants";

type AnyStatus = FeatureStatus | IssueStatus | HealthStatus;

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-slate-800 text-slate-300 ring-slate-700",
  planned: "bg-slate-700 text-slate-200 ring-slate-600",
  in_progress: "bg-sky-950 text-sky-300 ring-sky-800",
  needs_review: "bg-indigo-950 text-indigo-300 ring-indigo-800",
  testing: "bg-violet-950 text-violet-300 ring-violet-800",
  live: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  live_with_issues: "bg-amber-950 text-amber-300 ring-amber-800",
  broken: "bg-rose-950 text-rose-300 ring-rose-800",
  blocked: "bg-rose-950 text-rose-300 ring-rose-800",
  deprecated: "bg-zinc-900 text-zinc-400 ring-zinc-700",
  open: "bg-sky-950 text-sky-300 ring-sky-800",
  investigating: "bg-indigo-950 text-indigo-300 ring-indigo-800",
  fix_in_progress: "bg-violet-950 text-violet-300 ring-violet-800",
  waiting_on_review: "bg-amber-950 text-amber-300 ring-amber-800",
  resolved: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  ignored: "bg-zinc-900 text-zinc-400 ring-zinc-700",
  healthy: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  degraded: "bg-amber-950 text-amber-300 ring-amber-800",
  failing: "bg-rose-950 text-rose-300 ring-rose-800",
  unknown: "bg-slate-800 text-slate-300 ring-slate-700",
  disabled: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

function labelFor(status: AnyStatus): string {
  return (
    (FEATURE_STATUS_LABELS as Record<string, string>)[status] ??
    (ISSUE_STATUS_LABELS as Record<string, string>)[status] ??
    (HEALTH_STATUS_LABELS as Record<string, string>)[status] ??
    String(status)
  );
}

interface Props {
  status: AnyStatus;
  className?: string;
}

const StatusBadge: React.FC<Props> = ({ status, className }) => {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.unknown;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        tone,
        className,
      )}
    >
      {labelFor(status)}
    </span>
  );
};

export default StatusBadge;
