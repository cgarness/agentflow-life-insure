// Reports v3 exports (D6 §4.9): the KPI files from the 21-column coverage builder, and the Note lines each file
// carries. Every value is rounded once from the exact numbers; a panel that is not current is panel_not_loaded.
import { buildKpiCoverageRows, type CsvCell, type KpiCoverageInput } from "@/lib/reports-export";
import { KPI_REGISTRY, kpi } from "@/lib/reports-kpi-registry";
import { csvValue, disclosureLines, roundHalfUp, toCents } from "@/lib/reports-kpi-format";
import type { Panels } from "@/lib/reports-panels";
import { REGIONAL_MODES, REGIONAL_MODE_LABELS, stateName } from "@/lib/reports-regional";
import type { KpiEnvelope, ReportStateBreakdownV3 } from "@/lib/reports-v3-schemas";
import {
  BREAKDOWN_CALLS_NOTE, CALLS_MADE_BASIS_NOTE, NOT_LOADED, REASON_NOTICES, STATE_BASIS_NOTE, UNMAPPED_REASON_LABELS, fillNotice,
} from "@/lib/reports-v3-text";
import { AGENT_COLUMNS } from "@/components/reports/agentPerformanceColumns";

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

/** Dollars with exact cents written at 2 dp, rounded once; null stays a blank cell. */
const money = (cents: bigint | null): string | null => (cents === null ? null : roundHalfUp(cents, 100, 2));
const centsOf = (dollars: number | null): bigint | null => (dollars === null ? null : toCents(dollars));

export const STATE_CSV_HEADERS = [
  "State", "State name", "Calls made", "Contacted calls", "Policies sold", "AP", "Policies with premium", "Policies missing premium",
  "Invalid premium", "Calls by current record", "Policies by current record", "Calls by campaign copy", "Policies by campaign copy",
  "Calls with state changed after the event", "Policies with state changed after the event",
];

/**
 * The Regional performance file (D5 §4): 51 states, Mapped total, the 6 Unmapped rows, Unmapped total and Total.
 * AP is written at 2 dp from exact cents and is blank when the AP mode is unavailable; counts are integers.
 * A partial or unavailable mode adds its notice (unverified attempts come from the call notes); the state basis note
 * is always written.
 */
export function stateCsv(data: ReportStateBreakdownV3): { headers: string[]; rows: CsvCell[][]; notes: string[] } {
  const apOff = data.modes.ap.status === "unavailable";
  type Counts = Pick<ReportStateBreakdownV3["totals"], "calls_made" | "contacted_calls" | "policies_sold" | "premium">;
  const values = (r: Counts, ap: bigint | null): CsvCell[] => [r.calls_made, r.contacted_calls, r.policies_sold, apOff ? null : money(ap),
    r.premium.known_count, r.premium.missing_count, r.premium.invalid_count];
  const sum = (pick: (j: ReportStateBreakdownV3["jurisdictions"][number]) => number) => data.jurisdictions.reduce((a, j) => a + pick(j), 0);
  const known = data.jurisdictions.filter(j => j.premium.annual_premium !== null);
  const mappedAp = known.length ? known.reduce((a, j) => a + toCents(j.premium.annual_premium as number), 0n) : null;
  const blankBasis: CsvCell[] = [null, null, null, null, null, null];
  const rows: CsvCell[][] = [
    ...data.jurisdictions.map(j => [j.state, stateName(j.state), ...values(j, centsOf(j.premium.annual_premium)),
      j.basis.calls.current_record, j.basis.policies.current_record, j.basis.calls.campaign_copy, j.basis.policies.campaign_copy,
      j.basis.calls_changed_after_event, j.basis.policies_changed_after_event]),
    ["Mapped total", null, sum(j => j.calls_made), sum(j => j.contacted_calls), sum(j => j.policies_sold), apOff ? null : money(mappedAp),
      sum(j => j.premium.known_count), sum(j => j.premium.missing_count), sum(j => j.premium.invalid_count),
      sum(j => j.basis.calls.current_record), sum(j => j.basis.policies.current_record), sum(j => j.basis.calls.campaign_copy),
      sum(j => j.basis.policies.campaign_copy), sum(j => j.basis.calls_changed_after_event), sum(j => j.basis.policies_changed_after_event)],
    ...data.unmapped.reasons.map(r => ["Unmapped", UNMAPPED_REASON_LABELS[r.reason], ...values(r, centsOf(r.premium.annual_premium)), ...blankBasis]),
    ["Unmapped total", null, ...values(data.unmapped, centsOf(data.unmapped.premium.annual_premium)), ...blankBasis],
    ["Total", null, ...values(data.totals, centsOf(data.totals.premium.annual_premium)), ...blankBasis],
  ];
  const notes = [STATE_BASIS_NOTE];
  for (const mode of REGIONAL_MODES) {
    const m = data.modes[mode];
    // An unverified-attempt mode is already disclosed by the call notes written with every call file.
    if (m.status === "available" || !m.reason || m.reason === "attempt_unverified") continue;
    const n = m.reason === "premium_invalid" ? data.totals.premium.invalid_count : data.totals.premium.missing_count;
    const text = fillNotice(REASON_NOTICES[m.reason], { n });
    if (text) notes.push(`${REGIONAL_MODE_LABELS[mode]}: ${text}`);
  }
  return { headers: STATE_CSV_HEADERS, rows, notes };
}

export interface AgentRow { id: string; name: string; cells: (KpiEnvelope | null)[] }

/** The agent table rows (D6 §4.6): the summary's agents in server order, joined on agent_id to journey (38) and
 *  sales appointments (12); a cell whose panel is not current is null. */
export function agentRows(panels: Panels, current: (key: "summary" | "journey" | "salesAppointments") => boolean = () => true): AgentRow[] {
  if (panels.summary.status !== "ready" || !current("summary")) return [];
  const index = (key: "journey" | "salesAppointments") => {
    const p = panels[key];
    return new Map(p.status === "ready" && current(key) ? p.data.by_agent.map(r => [r.agent_id, r.metrics]) : []);
  };
  const journey = index("journey"), appts = index("salesAppointments");
  return panels.summary.data.by_agent.map(r => ({
    id: r.agent_id, name: r.name,
    cells: AGENT_COLUMNS.map(c => {
      const ms = c.panel === "summary" ? r.metrics : c.panel === "journey" ? journey.get(r.agent_id) : appts.get(r.agent_id);
      return ms?.find(m => m.id === c.id) ?? null;
    }),
  }));
}

/** Agency-scope unattributed policies and AP from the summary's top-level KPI 2 and 1 details. */
export function unattributed(panels: Panels): { policies: number | null; ap: number | null } {
  const top = panels.summary.status === "ready" ? panels.summary.data.metrics : [];
  return {
    policies: (top.find(m => m.id === 2)?.detail as { quality?: { unattributed_policies?: number | null } } | null)?.quality?.unattributed_policies ?? null,
    ap: (top.find(m => m.id === 1)?.detail as { unattributed_annual_premium?: number | null } | null)?.unattributed_annual_premium ?? null,
  };
}

/** The agent-performance file: one row per agent with each column's value rounded once (blank when not loaded or
 *  unavailable), the agency Unattributed row when above 0, and Note rows for the cells' on-demand lines. */
export function agentCsv(rows: AgentRow[], extra: { policies: number | null; ap: number | null } | null): { headers: string[]; rows: CsvCell[][]; notes: string[] } {
  const defs = AGENT_COLUMNS.map(c => kpi(c.id));
  const body: CsvCell[][] = rows.map(r => [r.name, ...r.cells.map((e, i) => (e && e.value !== null ? csvValue(defs[i], e) : null))]);
  if (extra && extra.policies !== null && extra.policies > 0) {
    body.push(["Unattributed", extra.policies, extra.ap === null ? null : money(toCents(extra.ap)), ...defs.slice(2).map(() => null)]);
  }
  const notes = new Set<string>();
  defs.forEach((d, i) => { if (rows.length && rows.every(r => !r.cells[i])) notes.add(`${d.label}: ${NOT_LOADED}`); });
  for (const r of rows) r.cells.forEach((e, i) => {
    if (e && (e.status !== "available" || e.maturity?.state === "in_progress")) disclosureLines(defs[i], e).forEach(l => notes.add(`${r.name}, ${defs[i].label}: ${l}`));
  });
  return { headers: ["Agent", ...defs.map(d => d.label)], rows: body, notes: [...notes] };
}
