import React from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: React.ReactNode;
  className?: string;
}

const TONE_RING: Record<NonNullable<Props["tone"]>, string> = {
  default: "ring-slate-800",
  warning: "ring-amber-800",
  danger: "ring-rose-800",
  success: "ring-emerald-800",
};

const TONE_TEXT: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-slate-100",
  warning: "text-amber-200",
  danger: "text-rose-200",
  success: "text-emerald-200",
};

const SummaryCard: React.FC<Props> = ({
  label,
  value,
  hint,
  tone = "default",
  icon,
  className,
}) => (
  <div
    className={cn(
      "rounded-xl bg-slate-900/80 ring-1 ring-inset p-4 flex flex-col gap-2",
      TONE_RING[tone],
      className,
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      {icon && <span className="text-slate-500">{icon}</span>}
    </div>
    <div className={cn("text-2xl font-semibold", TONE_TEXT[tone])}>{value}</div>
    {hint && <div className="text-xs text-slate-500">{hint}</div>}
  </div>
);

export default SummaryCard;
