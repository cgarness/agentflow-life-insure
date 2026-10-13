import { z } from "zod";

/** Supported lead fields (keys match the server mapping contract). */
export const STANDARD_FIELDS = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "full_name", label: "Full Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "state", label: "State" },
  { key: "lead_source", label: "Lead Source" },
  { key: "age", label: "Age" },
  { key: "date_of_birth", label: "Date of Birth" },
  { key: "best_time_to_call", label: "Best Time to Call" },
  { key: "notes", label: "Notes" },
] as const;
export type StandardKey = (typeof STANDARD_FIELDS)[number]["key"];
export const SKIP = "__skip__";

export const mappingColumnSchema = z.object({ header: z.string().trim().min(1), target: z.string().min(1) });

/** Mapping form (Zod): phone + a name are required; one column per field; ID column required in ID mode. */
export const sourceDraftSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(120),
  leadSourceDefault: z.string().trim().min(1).max(120),
  idHeader: z.string().trim().max(200).nullable(),
  columns: z.array(mappingColumnSchema).max(200),
  includeExisting: z.boolean(),
}).superRefine((d, ctx) => {
  const targets = d.columns.map((c) => c.target);
  if (!targets.includes("phone")) ctx.addIssue({ code: "custom", message: "Map a Phone column", path: ["columns"] });
  if (!(targets.includes("full_name") || (targets.includes("first_name") && targets.includes("last_name")))) {
    ctx.addIssue({ code: "custom", message: "Map First and Last Name, or Full Name", path: ["columns"] });
  }
  if (new Set(targets).size !== targets.length) ctx.addIssue({ code: "custom", message: "Each field can be mapped once", path: ["columns"] });
  if (d.idHeader && d.columns.some((c) => c.header === d.idHeader)) {
    ctx.addIssue({ code: "custom", message: "The Lead ID column can't also be a lead field", path: ["idHeader"] });
  }
});
export interface SourceDraft {
  displayName: string;
  leadSourceDefault: string;
  idHeader: string | null;
  columns: { header: string; target: string }[];
  includeExisting: boolean;
}

export function toPayload(draft: SourceDraft, pick: { spreadsheetId: string; sheetId: number; spreadsheetName: string; sheetTitle: string }) {
  return {
    spreadsheet_id: pick.spreadsheetId, sheet_id: pick.sheetId, spreadsheet_name: pick.spreadsheetName, sheet_title: pick.sheetTitle,
    display_name: draft.displayName, lead_source_default: draft.leadSourceDefault,
    identity_mode: draft.idHeader ? "source_id" : "row_position", id_header: draft.idHeader,
    mapping: { v: 1, columns: draft.columns }, include_existing: draft.includeExisting,
  };
}

export interface SheetSourceRow {
  id: string; organization_id: string; user_id: string; spreadsheet_id: string; sheet_id: number;
  spreadsheet_name: string; sheet_title: string; display_name: string;
  mapping: { v: 1; columns: { header: string; target: string }[] }; identity_mode: "source_id" | "row_position";
  id_header: string | null; lead_source_default: string; include_existing: boolean; config_version: number;
  state: "draft" | "enabled" | "paused"; health: "ok" | "needs_review" | "access_lost" | "error"; review_reason: string | null;
  phase: "initial" | "steady"; lease_owner: string | null; last_checked_at: string | null; last_success_at: string | null;
  last_result: { imported: number; flagged: number; skipped: number; errors: number; pending?: number } | null;
  last_error_code: string | null; created_at: string;
}
export interface ConnectionStatus {
  enabled: boolean; eligible: boolean;
  connection: { status: "connected" | "reconnect_required" | "disconnected"; google_email: string | null; connected_at: string | null; last_error_code: string | null } | null;
}
export interface SheetsContext {
  duplicate_action: string; default_status: string; lead_sources: string[]; has_lead_created_workflows: boolean;
  custom_fields: { id: string; name: string; created_by: string | null; created_at: string | null }[];
}
export interface PreviewResult {
  title: string; total_rows: number; valid_rows: number; invalid_rows: number; imported_before: number;
  duplicate_action: string; has_lead_created_workflows: boolean;
  rows: { row: number; first_name: string; last_name: string; phone: string; email: string; outcome: string; reason: string | null }[];
}
