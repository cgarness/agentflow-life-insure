import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DetailRow {
  label: string;
  value: string | null | undefined;
}

/**
 * Shared Details affordance for Conversation History items: a small accessible
 * toggle plus an inline label/value panel. Endpoint visibility only — callers
 * must never pass UUIDs, provider/debug identifiers, or storage paths.
 */
export const DetailsToggleButton: React.FC<{
  open: boolean;
  onClick: () => void;
  panelId: string;
  label: string;
}> = ({ open, onClick, panelId, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    aria-controls={panelId}
    aria-label={label}
    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    Details
    <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
  </button>
);

/** Missing values render "—" — never blank, undefined, or a fabricated value. */
export const DetailsPanel: React.FC<{ id: string; rows: DetailRow[]; className?: string }> = ({
  id,
  rows,
  className,
}) => (
  <dl
    id={id}
    className={cn(
      "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left animate-in fade-in slide-in-from-top-1 duration-200",
      className,
    )}
  >
    {rows.map((row) => (
      <React.Fragment key={row.label}>
        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground leading-snug pt-0.5">{row.label}</dt>
        <dd className="text-xs text-foreground break-all min-w-0">
          {row.value && row.value.trim() ? row.value : "—"}
        </dd>
      </React.Fragment>
    ))}
  </dl>
);
