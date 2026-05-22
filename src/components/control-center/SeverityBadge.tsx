import React from "react";
import { cn } from "@/lib/utils";
import { ISSUE_SEVERITY_LABELS, type IssueSeverity } from "@/lib/control-center/constants";

const TONE: Record<IssueSeverity, string> = {
  critical: "bg-rose-950 text-rose-300 ring-rose-800",
  high: "bg-amber-950 text-amber-300 ring-amber-800",
  medium: "bg-sky-950 text-sky-300 ring-sky-800",
  low: "bg-slate-800 text-slate-300 ring-slate-700",
  info: "bg-zinc-900 text-zinc-400 ring-zinc-700",
};

interface Props {
  severity: IssueSeverity;
  className?: string;
}

const SeverityBadge: React.FC<Props> = ({ severity, className }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
      TONE[severity],
      className,
    )}
  >
    {ISSUE_SEVERITY_LABELS[severity]}
  </span>
);

export default SeverityBadge;
