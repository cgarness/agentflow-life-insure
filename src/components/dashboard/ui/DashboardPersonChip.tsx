import React from "react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/dashboard-people";

/**
 * An agent named on a record the viewer can already see (Team-mode context, plan §6): initials
 * (no photo, decision D7) and the name. "Name unavailable" when the name could not be read —
 * never an invented one.
 */
export const DashboardPersonChip: React.FC<{
  /** What the person is to this record ("Owner", "Assigned to", "Writing agent"). */
  role: string;
  name: string;
  className?: string;
}> = ({ role, name, className }) => {
  const known = name !== "Name unavailable";
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground"
      >
        {known ? initialsOf(name) : "?"}
      </span>
      <span className="truncate">
        <span className="sr-only">{role}: </span>
        <span aria-hidden="true">{role} · </span>
        <span className={cn(known ? "font-medium text-foreground" : "italic")}>{name}</span>
      </span>
    </span>
  );
};
