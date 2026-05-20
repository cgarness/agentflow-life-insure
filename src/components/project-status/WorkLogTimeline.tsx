import React from "react";
import { StatusBadge } from "./statusBadge";
import { matchesQuery } from "./InventorySearch";
import type { ParsedWorkLogEntry } from "@/lib/project-status/types";

interface WorkLogTimelineProps {
  entries: ParsedWorkLogEntry[];
  search: string;
}

const WorkLogTimeline: React.FC<WorkLogTimelineProps> = ({ entries, search }) => {
  const filtered = entries.filter((e) =>
    matchesQuery(`${e.date} ${e.title} ${e.excerpt} ${e.status}`, search)
  );

  return (
    <ul className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
      {filtered.map((e) => (
        <li key={e.itemKey} className="border-l-2 border-primary/30 pl-4 py-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{e.date}</span>
            <StatusBadge status={e.status} />
          </div>
          <p className="font-medium text-sm mt-0.5">{e.title}</p>
          {e.excerpt && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.excerpt}</p>
          )}
        </li>
      ))}
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No work log entries match.</p>
      )}
    </ul>
  );
};

export default WorkLogTimeline;
