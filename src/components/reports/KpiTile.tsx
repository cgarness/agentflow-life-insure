import React from "react";
import { cn } from "@/lib/utils";
import { kpi } from "@/lib/reports-kpi-registry";
import { disclosureLines, tileView } from "@/lib/reports-kpi-format";
import type { KpiEnvelope } from "@/lib/reports-v3-schemas";
import { CHIP_IN_PROGRESS, CHIP_PARTIAL } from "@/lib/reports-v3-text";
import KpiStatusNote from "./KpiStatusNote";

interface Props {
  id: number;
  /** The current envelope; undefined while its panel loads; null when the panel failed (never shown as 0). */
  envelope: KpiEnvelope | null | undefined;
  size?: "hero" | "large" | "compact";
  className?: string;
}

const VALUE = { hero: "text-[2rem] leading-10 xl:text-[2.25rem] xl:leading-[2.75rem]", large: "text-xl min-[400px]:text-2xl xl:text-3xl", compact: "text-xl sm:text-2xl" } as const;

/** One KPI: a value with at most two text chips, or "—" with a short cue. Nothing is written beneath it. */
const KpiTile: React.FC<Props> = ({ id, envelope, size = "compact", className }) => {
  const def = kpi(id);
  const view = envelope ? tileView(def, envelope) : null;
  const lines = envelope ? disclosureLines(def, envelope) : [];
  return (
    <div data-kpi-id={id} data-report-value={size === "hero" ? "hero" : undefined}
      className={cn("min-w-0 rounded-xl border border-border bg-card p-4", className)}>
      <p className="line-clamp-2 text-xs font-medium leading-4 text-muted-foreground">{def.label}</p>
      {envelope === undefined ? (
        <div aria-label={`${def.label}: loading`} className="mt-2 h-8 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ) : view === null ? (
        <p className="mt-1.5 text-2xl font-semibold text-muted-foreground" aria-label={`${def.label}: not loaded`}>—</p>
      ) : (
        <>
          <p className={cn("mt-1.5 whitespace-nowrap font-semibold tabular-nums tracking-tight text-foreground", VALUE[size])}>
            <span aria-hidden="true">{view.text}</span>
            <span className="sr-only">{view.srText}</span>
          </p>
          {(view.cue || view.chips.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {view.cue && <span className="text-xs text-muted-foreground" aria-hidden="true">{view.cue}</span>}
              {view.chips.map(chip => (
                <KpiStatusNote key={chip} tone={chip === "partial" ? "partial" : "progress"}
                  label={chip === "partial" ? CHIP_PARTIAL : CHIP_IN_PROGRESS} lines={lines} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default KpiTile;
