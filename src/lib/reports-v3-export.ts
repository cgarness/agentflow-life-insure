// Reports v3 exports (D6 §4.9): the KPI files from the 21-column coverage builder, and the Note lines each file
// carries. Every value is rounded once from the exact numbers; a panel that is not current is panel_not_loaded.
import { buildKpiCoverageRows, type KpiCoverageInput } from "@/lib/reports-export";
import { KPI_REGISTRY } from "@/lib/reports-kpi-registry";
import { csvValue, disclosureLines } from "@/lib/reports-kpi-format";
import type { KpiEnvelope } from "@/lib/reports-v3-schemas";
import { BREAKDOWN_CALLS_NOTE, CALLS_MADE_BASIS_NOTE, REASON_NOTICES, fillNotice } from "@/lib/reports-v3-text";

/** The KPI coverage rows for the given ids; `envelopeOf` returns null for a panel that is not current. */
export function kpiRows(ids: number[], envelopeOf: (id: number) => KpiEnvelope | null) {
  const inputs: KpiCoverageInput[] = KPI_REGISTRY.filter(k => ids.includes(k.id)).map(k => {
    const e = envelopeOf(k.id);
    return { id: k.id, label: k.label, unit: k.unit, dateBasis: k.date_basis, credit: k.credit, cohort: k.cohort_30d, envelope: e,
      csvValue: e && e.value !== null ? csvValue(k, e) : null };
  });
  return buildKpiCoverageRows(inputs);
}

/** The KPI files' Note rows: each KPI's on-demand lines (the same lines as its chip disclosure). */
export function kpiNotes(ids: number[], envelopeOf: (id: number) => KpiEnvelope | null): string[] {
  const notes = KPI_REGISTRY.filter(k => ids.includes(k.id)).flatMap(k => {
    const e = envelopeOf(k.id);
    return e && (e.status !== "available" || e.maturity?.state === "in_progress") ? disclosureLines(k, e).map(l => `${k.label}: ${l}`) : [];
  });
  return [...new Set(notes)];
}

/** Call-panel files: the Calls made basis, the unverified-attempt notice when present, and the breakdown note. */
export function callNotes(unverified: number, breakdown = false): string[] {
  return [CALLS_MADE_BASIS_NOTE, ...(unverified > 0 ? [fillNotice(REASON_NOTICES.attempt_unverified, { n: unverified })] : []),
    ...(breakdown ? [BREAKDOWN_CALLS_NOTE] : [])];
}
