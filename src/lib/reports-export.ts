/**
 * reports-export.ts — the ONE CSV writer for Reports.
 *
 * - Exports only data that is on screen for the CURRENT report key (viewer, organization, range,
 *   agent filter). A panel that is loading, failed, denied or belongs to a previous key refuses.
 * - Every file carries its scope, agent filter, agency period and time zone, so an export can never be
 *   mistaken for a different scope or period.
 * - Spreadsheet formula injection is neutralized: user-controlled text (campaign, disposition, lead
 *   source and agent names) starting with = + - @ tab or CR is prefixed with an apostrophe.
 * - The permission gate ("Export Reports", resolved server-side as `can_export`) is applied by the
 *   callers; this module never decides authorization.
 */
import type { ReportScopeKind, ReportWindow } from "@/lib/reports-schemas";

export type CsvCell = string | number | null | undefined;

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

export function sanitizeCsvText(value: string): string {
  return FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : '""';
  }
  return `"${sanitizeCsvText(value).replace(/"/g, '""')}"`;
}

export interface ReportExportContext {
  report: string;
  scope: ReportScopeKind;
  agentLabel: string;
  window: ReportWindow;
  generatedAt?: Date;
  /** Basis notes (e.g. how policies are counted and credited), written as metadata rows. */
  notes?: string[];
}

const SCOPE_LABELS: Record<ReportScopeKind, string> = {
  own: "Your activity",
  team: "Your team",
  organization: "Organization",
};

export function buildReportCsv(context: ReportExportContext, headers: string[], rows: CsvCell[][]): string {
  const meta: CsvCell[][] = [
    ["Report", context.report],
    ["Scope", SCOPE_LABELS[context.scope]],
    ["Agent filter", context.agentLabel],
    ["Period", `${context.window.start_date} to ${context.window.end_date}`],
    ["Time zone", context.window.time_zone],
    ["Generated", (context.generatedAt ?? new Date()).toISOString()],
    ...(context.notes ?? []).map((n): CsvCell[] => ["Note", n]),
  ];
  const lines = [
    ...meta.map((r) => r.map(cell).join(",")),
    "",
    headers.map(cell).join(","),
    ...rows.map((r) => r.map(cell).join(",")),
  ];
  return lines.join("\n");
}

export function csvFileName(report: string, window: ReportWindow): string {
  const slug = report.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug || "report"}-${window.start_date}-to-${window.end_date}.csv`;
}

/** Triggers the browser download. The object URL is released after the click has dispatched. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The export callback a Reports section receives. Present ONLY when the viewer may export
 * (`can_export`); the page binds it to the current report key, scope, agent filter and window.
 */
export type ReportExportFn = (report: string, headers: string[], rows: CsvCell[][]) => void;
