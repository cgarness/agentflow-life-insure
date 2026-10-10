import React, { useId } from "react";
import { formatAsOf } from "@/lib/reports-format";
import {
  DATA_QUALITY_TITLE, FRESHNESS_TITLE, INDEPENDENT_PANELS_NOTE, dataBasisSections, timeZoneNote,
} from "@/lib/reports-basis-text";
import ReportDataQuality, { type LiveSummary } from "./ReportDataQuality";

export interface DataBasisContent {
  summary: LiveSummary;
  /** The agency time zone and agency today from the resolved report scope. */
  timeZone: string;
  today: string;
  /** The lead-source payload's own reason, only when that payload is current. */
  convertedReason?: string | null;
}

const TEXT = "text-sm leading-relaxed text-muted-foreground";

const BasisSection: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section aria-labelledby={id} className="space-y-1">
    <h3 id={id} className="text-sm font-semibold text-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * The Data basis content: static methodology (always, so it is reachable when a panel failed), the live
 * data quality of the current summary, then the time zone and freshness. Mounted only while the sheet is open.
 */
export default function DataBasisSections({ summary, timeZone, today, convertedReason = null }: DataBasisContent) {
  const uid = useId();
  return (
    <div className="mt-6 space-y-5">
      {dataBasisSections(convertedReason).map((section) => (
        <BasisSection key={section.key} id={`${uid}-${section.key}`} title={section.title}>
          {section.paragraphs.map((text) => <p key={text} className={TEXT}>{text}</p>)}
        </BasisSection>
      ))}
      <BasisSection id={`${uid}-quality`} title={DATA_QUALITY_TITLE}>
        <ReportDataQuality summary={summary} />
      </BasisSection>
      <BasisSection id={`${uid}-freshness`} title={FRESHNESS_TITLE}>
        <p className={TEXT}>{timeZoneNote(timeZone)}</p>
        <p className={TEXT}>{INDEPENDENT_PANELS_NOTE}</p>
        {summary.status === "ready" && (
          <p className={TEXT} data-testid="data-basis-as-of">
            Summary as of <time dateTime={summary.data.as_of}>{formatAsOf(summary.data.as_of, timeZone, today)}</time>
          </p>
        )}
      </BasisSection>
    </div>
  );
}
