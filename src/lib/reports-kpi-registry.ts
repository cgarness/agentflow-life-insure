// The 23 Reports v3 KPIs (D6 §4.2). The SQL fields equal private.report_v3_metric_registry() field for field
// (reportsKpiRegistry.test.ts reads the foundation migration); the presentation fields are D6's.

export type KpiReader = "summary" | "journey" | "sales_appointments";
export type KpiPlacement = "production" | "highlight" | "strip" | "more";
export type KpiMoreGroup = "effort" | "journey" | "appointments" | "time";
export type KpiAccent = "production" | "appointment" | "close" | null;

export interface KpiSqlFields {
  id: number;
  label: string;
  reader: KpiReader;
  unit: "currency" | "count" | "calls" | "people" | "percent" | "ratio" | "days" | "bookings" | "appointments" | "attempts" | "duration";
  kind: "sum" | "count" | "distinct_count" | "ratio" | "rate" | "median";
  eligible_population: string | null;
  cohort_30d: boolean;
  credit: "original_seller" | "placing_agent" | "setter" | "assigned_agent_at_start" | "first_contact_agent" | "session_agent" | "placing_agent_and_original_seller";
  date_basis: string;
  display: "premium" | "integer" | "1dp" | "1dp_drop_zero" | "elapsed";
  csv: "2dp" | "integer" | "1dp" | "integer_seconds";
}

export interface KpiDefinition extends KpiSqlFields {
  layoutId: string;
  placement: KpiPlacement;
  moreGroup: KpiMoreGroup | null;
  accent: KpiAccent;
}

type Row = [KpiSqlFields, KpiPlacement, KpiMoreGroup | null, KpiAccent];
const S = "summary" as const, J = "journey" as const, A = "sales_appointments" as const;

const ROWS: Row[] = [
  [{ id: 1, label: "Annual premium (AP)", reader: S, unit: "currency", kind: "sum", eligible_population: "policies_sold", cohort_30d: false, credit: "original_seller", date_basis: "sold_date", display: "premium", csv: "2dp" }, "production", null, "production"],
  [{ id: 2, label: "Policies sold", reader: S, unit: "count", kind: "count", eligible_population: null, cohort_30d: false, credit: "original_seller", date_basis: "sold_date", display: "integer", csv: "integer" }, "production", null, null],
  [{ id: 3, label: "Clients who purchased", reader: S, unit: "count", kind: "distinct_count", eligible_population: null, cohort_30d: false, credit: "original_seller", date_basis: "sold_date", display: "integer", csv: "integer" }, "production", null, null],
  [{ id: 4, label: "Average AP per policy", reader: S, unit: "currency", kind: "ratio", eligible_population: "policies_sold", cohort_30d: false, credit: "original_seller", date_basis: "sold_date", display: "premium", csv: "2dp" }, "production", null, null],
  [{ id: 5, label: "Calls", reader: S, unit: "calls", kind: "count", eligible_population: "attempt_and_unverified_rows", cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "integer", csv: "integer" }, "strip", "effort", null],
  [{ id: 6, label: "Contacted calls", reader: S, unit: "calls", kind: "count", eligible_population: null, cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "integer", csv: "integer" }, "strip", "effort", null],
  [{ id: 7, label: "Unique prospects reached", reader: S, unit: "people", kind: "distinct_count", eligible_population: "contacted_calls_excluding_recruits", cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "integer", csv: "integer" }, "strip", "effort", null],
  [{ id: 8, label: "Call contact rate", reader: S, unit: "percent", kind: "rate", eligible_population: "attempt_and_unverified_rows", cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "1dp", csv: "1dp" }, "strip", "effort", null],
  [{ id: 9, label: "Calls per policy", reader: S, unit: "ratio", kind: "ratio", eligible_population: "attempt_and_unverified_rows", cohort_30d: false, credit: "placing_agent_and_original_seller", date_basis: "call_created_at_and_sold_date", display: "1dp", csv: "2dp" }, "highlight", null, "appointment"],
  [{ id: 10, label: "Contacted calls per policy", reader: S, unit: "ratio", kind: "ratio", eligible_population: null, cohort_30d: false, credit: "placing_agent_and_original_seller", date_basis: "call_created_at_and_sold_date", display: "1dp", csv: "2dp" }, "highlight", null, "appointment"],
  [{ id: 11, label: "Prospects reached per policy", reader: S, unit: "ratio", kind: "ratio", eligible_population: "contacted_calls_excluding_recruits", cohort_30d: false, credit: "placing_agent_and_original_seller", date_basis: "call_created_at_and_sold_date", display: "1dp", csv: "2dp" }, "more", "effort", null],
  [{ id: 12, label: "Sales appointments per policy", reader: A, unit: "ratio", kind: "ratio", eligible_population: "held_group_members", cohort_30d: true, credit: "assigned_agent_at_start", date_basis: "occurrence_date", display: "1dp", csv: "2dp" }, "highlight", null, "appointment"],
  [{ id: 14, label: "Days to first sale", reader: J, unit: "days", kind: "median", eligible_population: "first_time_buyers_in_period", cohort_30d: false, credit: "original_seller", date_basis: "first_sale_date", display: "1dp_drop_zero", csv: "1dp" }, "more", "journey", null],
  [{ id: 15, label: "Sales appointments booked", reader: A, unit: "bookings", kind: "count", eligible_population: "bookings_in_period", cohort_30d: false, credit: "setter", date_basis: "booking_created_at", display: "integer", csv: "integer" }, "strip", "appointments", null],
  [{ id: 16, label: "Sales appointments completed", reader: A, unit: "appointments", kind: "count", eligible_population: "due_occurrences", cohort_30d: false, credit: "assigned_agent_at_start", date_basis: "occurrence_date", display: "integer", csv: "integer" }, "more", "appointments", null],
  [{ id: 17, label: "Appointment show rate", reader: A, unit: "percent", kind: "rate", eligible_population: "due_occurrences", cohort_30d: false, credit: "assigned_agent_at_start", date_basis: "occurrence_date", display: "1dp", csv: "1dp" }, "more", "appointments", null],
  [{ id: 18, label: "Appointment close rate", reader: A, unit: "percent", kind: "rate", eligible_population: "held_group_members", cohort_30d: true, credit: "assigned_agent_at_start", date_basis: "occurrence_date", display: "1dp", csv: "1dp" }, "more", "appointments", null],
  [{ id: 19, label: "Contact-to-sale rate", reader: J, unit: "percent", kind: "rate", eligible_population: "first_contacts_in_period", cohort_30d: true, credit: "first_contact_agent", date_basis: "first_contact_date", display: "1dp", csv: "1dp" }, "more", "journey", null],
  [{ id: 21, label: "Calls to first contact", reader: J, unit: "attempts", kind: "median", eligible_population: "first_contacts_in_period", cohort_30d: false, credit: "first_contact_agent", date_basis: "first_contact_date", display: "1dp_drop_zero", csv: "1dp" }, "more", "journey", null],
  [{ id: 24, label: "Total talk time", reader: S, unit: "duration", kind: "sum", eligible_population: null, cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "elapsed", csv: "integer_seconds" }, "more", "time", null],
  [{ id: 25, label: "Time in dialer", reader: S, unit: "duration", kind: "sum", eligible_population: null, cohort_30d: false, credit: "session_agent", date_basis: "session_interval", display: "elapsed", csv: "integer_seconds" }, "more", "time", null],
  [{ id: 34, label: "Calls per lead", reader: S, unit: "ratio", kind: "ratio", eligible_population: "lead_stage_attempt_and_unverified_rows", cohort_30d: false, credit: "placing_agent", date_basis: "call_created_at", display: "1dp", csv: "2dp" }, "more", "journey", null],
  [{ id: 38, label: "1 Call Close", reader: J, unit: "percent", kind: "rate", eligible_population: "first_time_buyers_in_period", cohort_30d: false, credit: "original_seller", date_basis: "first_sale_date", display: "1dp", csv: "1dp" }, "highlight", null, "close"],
];

export const KPI_REGISTRY: readonly KpiDefinition[] = ROWS.map(([sql, placement, moreGroup, accent]) => ({
  ...sql, layoutId: `kpi_${sql.id}`, placement, moreGroup, accent,
}));

export const KPI_BY_ID: ReadonlyMap<number, KpiDefinition> = new Map(KPI_REGISTRY.map(k => [k.id, k]));

export function kpi(id: number): KpiDefinition {
  const def = KPI_BY_ID.get(id);
  if (!def) throw new Error(`Unknown Reports KPI ${id}`);
  return def;
}

/** The SQL-registry part of a definition, for the equality test with private.report_v3_metric_registry(). */
export function sqlFields(def: KpiDefinition): KpiSqlFields {
  const { layoutId: _l, placement: _p, moreGroup: _m, accent: _a, ...sql } = def;
  return sql;
}

export const PRODUCTION_KPIS = [1, 2, 3, 4] as const;
export const HIGHLIGHT_KPIS = [9, 10, 12, 38] as const;
export const DEFAULT_STRIP_KPIS = [5, 6, 7, 8, 15] as const;
export const MORE_GROUP_ORDER: readonly KpiMoreGroup[] = ["appointments", "journey", "time", "effort"];
export const MORE_GROUP_LABELS: Record<KpiMoreGroup, string> = {
  appointments: "Appointments", journey: "Journey", time: "Time", effort: "Effort",
};
