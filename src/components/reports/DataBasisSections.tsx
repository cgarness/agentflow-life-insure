import React, { useId } from "react";
import { formatAsOf, formatCount } from "@/lib/reports-format";
import { KPI_REGISTRY } from "@/lib/reports-kpi-registry";
import { disclosureLines } from "@/lib/reports-kpi-format";
import type { PanelKey, Panels } from "@/lib/reports-panels";
import type { KpiEnvelope } from "@/lib/reports-v3-schemas";
import {
  ASSIGNED_AT_START_NOTE, BREAKDOWN_CALLS_NOTE, CALLS_MADE_BASIS_NOTE, COVERAGE_TITLE, CREDIT_LABELS, EFFECTIVE_PREMIUM_BASIS,
  NOT_A_FUNNEL_NOTE, ORIGINAL_SELLER_NOTE, SALE_SOURCE_NOTE, STATE_BASIS_NOTE, STATE_MAP_SOURCE_NOTE,
} from "@/lib/reports-v3-text";

/** How it's calculated (D6 §4.4): definitions, credit and dates always; coverage only from current envelopes. */
export interface DataBasisContent { panels: Panels; timeZone: string; today: string }

const TEXT = "text-sm leading-relaxed text-muted-foreground";
const DATE_WORDS: Record<string, string> = {
  sold_date: "Sold Date", call_created_at: "Call date", call_created_at_and_sold_date: "Call date and Sold Date", occurrence_date: "Appointment date",
  first_sale_date: "First sale date", booking_created_at: "Booking date", first_contact_date: "First contact date", session_interval: "Dialer session",
};
const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section aria-labelledby={id} className="space-y-1.5"><h3 id={id} className="text-sm font-semibold text-foreground">{title}</h3>{children}</section>
);

function envelopeOf(panels: Panels, id: number): KpiEnvelope | null {
  for (const key of ["summary", "journey", "salesAppointments"] as PanelKey[]) {
    const p = panels[key];
    if (p.status === "ready") { const m = (p.data as { metrics: KpiEnvelope[] }).metrics.find(e => e.id === id); if (m) return m; }
  }
  return null;
}

/** Quality lines at any status (D6 §4.4): each only when its count is above 0, except talk time and dialer time. */
function qualityLines(panels: Panels): string[] {
  const s = panels.summary;
  if (s.status !== "ready") return [];
  const d = (id: number) => s.data.metrics.find(m => m.id === id)?.detail as Record<string, any> | null | undefined;
  const lines: string[] = [];
  const legacy = d(1)?.premium?.legacy_record_fallback ?? 0;
  if (legacy > 0) lines.push(legacy === 1 ? "1 older sale uses its current policy premium" : `${formatCount(legacy)} older sales use their current policy premium`);
  const stored = d(2)?.stored_without_sale ?? 0;
  if (stored > 0) lines.push(`${formatCount(stored)} stored policies without a recorded sale are not counted`);
  const pop = d(5)?.call_population;
  if (pop?.non_attempts > 0) lines.push(`${formatCount(pop.non_attempts)} calls the dialer refused to place are excluded.`);
  if (pop?.duplicates_excluded > 0) lines.push(`${formatCount(pop.duplicates_excluded)} reviewed duplicate calls are excluded.`);
  const q24 = d(24)?.quality;
  if (q24) lines.push(`Talk time: ${q24.provider_confirmed} provider-confirmed; ${q24.conflicting} conflicting, ${q24.inconsistent} inconsistent, ${q24.estimated} estimated and ${q24.unknown} unknown durations included as recorded.`);
  const q25 = d(25)?.quality;
  if (q25) lines.push(`Time in dialer: ${q25.stale_capped} sessions capped at their last heartbeat; ${q25.late_ended} ended late.`);
  return lines;
}

export default function DataBasisSections({ panels, timeZone, today }: DataBasisContent) {
  const uid = useId();
  const coverage = KPI_REGISTRY.flatMap(k => {
    const e = envelopeOf(panels, k.id);
    if (!e || (e.status === "available" && e.maturity?.state !== "in_progress")) return [];
    return [{ id: k.id, label: k.label, status: e.status === "unavailable" ? "Not available" : e.status === "partial" ? "Partial" : "In progress", lines: disclosureLines(k, e) }];
  });
  const notCurrent = (["summary", "journey", "salesAppointments"] as PanelKey[]).filter(k => panels[k].status !== "ready");
  return (
    <div className="mt-6 space-y-5">
      <Section id={`${uid}-defs`} title="Definitions">
        <dl className="space-y-2">
          {KPI_REGISTRY.map(k => (
            <div key={k.id}><dt className="text-sm font-medium text-foreground">{k.label}</dt>
              <dd className={TEXT}>{DATE_WORDS[k.date_basis] ?? k.date_basis} · {CREDIT_LABELS[k.credit]}</dd></div>
          ))}
        </dl>
        <p className={TEXT}>{ASSIGNED_AT_START_NOTE}</p>
      </Section>
      <Section id={`${uid}-basis`} title="Basis">
        {[SALE_SOURCE_NOTE, ORIGINAL_SELLER_NOTE, EFFECTIVE_PREMIUM_BASIS, NOT_A_FUNNEL_NOTE, CALLS_MADE_BASIS_NOTE, BREAKDOWN_CALLS_NOTE, STATE_BASIS_NOTE, STATE_MAP_SOURCE_NOTE]
          .map(t => <p key={t} className={TEXT}>{t}</p>)}
      </Section>
      <Section id={`${uid}-coverage`} title={COVERAGE_TITLE}>
        {notCurrent.length > 0 && <p className={TEXT}>Some parts of the report are not loaded, so their coverage isn't shown.</p>}
        {coverage.map(c => (
          <div key={c.id}><p className="text-sm font-medium text-foreground">{c.label} · {c.status}</p>
            {c.lines.map(l => <p key={l} className={TEXT}>{l}</p>)}</div>
        ))}
        {qualityLines(panels).map(l => <p key={l} className={TEXT}>{l}</p>)}
      </Section>
      <Section id={`${uid}-freshness`} title="Freshness">
        <p className={TEXT}>Dates and hours use the agency time zone ({timeZone}).</p>
        {(Object.keys(panels) as PanelKey[]).map(k => {
          const p = panels[k];
          return p.status === "ready" ? <p key={k} className={TEXT} data-testid={k === "summary" ? "data-basis-as-of" : undefined}>
            {k} as of <time dateTime={(p.data as { as_of: string }).as_of}>{formatAsOf((p.data as { as_of: string }).as_of, timeZone, today)}</time></p> : null;
        })}
      </Section>
    </div>
  );
}
