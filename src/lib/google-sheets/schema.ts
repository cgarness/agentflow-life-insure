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
  mapping: SheetMappingJson; identity_mode: "source_id" | "row_position";
  id_header: string | null; lead_source_default: string; include_existing: boolean; config_version: number;
  state: "draft" | "enabled" | "paused"; health: "ok" | "needs_review" | "access_lost" | "error"; review_reason: string | null;
  phase: "initial" | "steady"; lease_owner: string | null; last_checked_at: string | null; last_success_at: string | null;
  last_result: { imported: number; flagged: number; skipped: number; errors: number; pending?: number } | null;
  last_error_code: string | null; created_at: string;
}
/** Real-time sync (Google Drive change notifications), per enabled source in push scope; from the status action. */
export type MonitoringState = "active" | "setting_up" | "interrupted";
export interface RealtimeStatus {
  mode: "off" | "pilot" | "on";
  sources: Record<string, { state: MonitoringState; last_notification_at: string | null; last_processed_at: string | null; pending: boolean }>;
}
export interface ConnectionStatus {
  enabled: boolean; eligible: boolean;
  connection: { status: "connected" | "reconnect_required" | "disconnected"; google_email: string | null; connected_at: string | null; last_error_code: string | null } | null;
  /** Absent or null when real-time sync is unavailable (the UI then shows no monitoring line). */
  realtime?: RealtimeStatus | null;
}
export interface SheetsContext {
  duplicate_action: string; default_status: string; lead_sources: string[]; has_lead_created_workflows: boolean;
  custom_fields: CatalogField[];
  /** 2 with the typed catalog (migration google_sheets_context_field_types); absent from older servers. */
  catalog_version?: number;
  /** Mapping versions the server accepts for NEW writes: the compatibility half of the mapping v2 gate. */
  mapping_versions?: number[];
}
export type CustomFieldType = "Text" | "Number" | "Date" | "Dropdown" | "Email" | "Phone";
/** A custom field the owner may map. The typed keys exist only with catalog_version 2. */
export interface CatalogField {
  id: string; name: string; created_by: string | null; created_at: string | null;
  type?: CustomFieldType | null; required?: boolean; dropdown_options?: string[] | null; scope?: "agency" | "personal"; own?: boolean;
}
/** One mapped optional value as ingest will store it (mapping v2 previews). */
export interface PreviewField { target: string; value: string; kept_as_text?: boolean; not_an_option?: boolean }
export interface HeaderColumn { index: number; letter: string; header: string; blank: boolean; duplicate: boolean; has_data: boolean }
export interface PreviewResult {
  title: string; total_rows: number; valid_rows: number; invalid_rows: number; repeat_rows?: number; imported_before: number;
  duplicate_action: string; has_lead_created_workflows: boolean;
  rows: { row: number; first_name: string; last_name: string; phone: string; email: string; outcome: string; reason: string | null;
          fields?: PreviewField[] }[];
  mapping_version?: number; locale?: string | null; ignored?: string[]; unaccounted_headers?: string[]; header_issues?: HeaderColumn[];
  /** Mapping v2 previews: the columns past A–GR as read now, and what no mapping can import (with its acknowledgement token). */
  beyond_limit?: BeyondLimit; not_importable?: NotImportable;
}
/** Columns past the import limit (A–GR): the real width and which scanned columns hold a header or data. Labels only. */
export interface BeyondLimit { width: number; checked_through: number; columns: { letter: string; header: string; has_data: boolean }[]; unchecked: boolean }
/**
 * Sheet content no mapping can import, as the server read it for a preview: headerless data columns and repeated
 * headers (A–GR), headers / headerless data past GR, and columns too far out to check. `signature` acknowledges
 * exactly this content (null: nothing to acknowledge).
 */
export interface NotImportable {
  headerless: string[]; repeated: string[];
  beyond: { width: number; checked_through: number; headers: string[]; headerless: string[]; unchecked: boolean };
  signature: string | null;
}
/** `headers` action. The keys after `sample` come from servers with mapping v2 support. */
export interface HeadersResult {
  title: string; spreadsheet_name: string; header: string[]; row_count: number; overflow: boolean; sample: string[][];
  locale?: string | null; column_count?: number; columns?: HeaderColumn[]; beyond_limit?: BeyondLimit;
}

/** Structural / identity-change review preview: established by Lead ID, matched by content only, unmatched. */
export interface StructuralReview { established: number; matched: number; unknown: number; config_version: number; snapshot: string }

export type IdentityHint = "same_row" | "content" | "position" | null;
export interface IdentityReviewRow {
  key: string; row: number; lead_id: string | null; hint: IdentityHint; valid: boolean; reason: string | null; rows: number;
  first_name: string; last_name: string; phone: string; email: string;
}
export interface IdentityReviewPreview {
  snapshot: string; config_version: number; unresolved_rows: number[]; established: number; approved: number; kept: number;
  rows: IdentityReviewRow[];
}
export type IdentityDecision = "import" | "exclude";

/** Identity review form (Zod): every listed row needs an explicit choice, and only listed rows. */
export function identityDecisionsSchema(keys: string[]) {
  return z.record(z.enum(["import", "exclude"])).refine(
    (d) => keys.every((k) => d[k] === "import" || d[k] === "exclude") && Object.keys(d).every((k) => keys.includes(k)),
    { message: "Choose what to do with every row" });
}

// ---------------------------------------------------------------- mapping v2 (gated: see mappingGate.ts)
export interface MappingColumn { header: string; target: string }
export type SheetMappingJson = { v: 1; columns: MappingColumn[] } | { v: 2; columns: MappingColumn[]; ignored: string[] };

export interface SourceDraftV2 extends SourceDraft {
  /** Headers the owner chose not to import. Stored with the mapping so a later edit can tell new columns apart. */
  ignored: string[];
  /** The owner confirmed that the ignored columns, and any content no mapping can import, will not be imported. */
  acknowledged: boolean;
}

/**
 * Mapping v2 form (Zod). On top of the v1 rules: every importable column of the CURRENT sheet is mapped, ignored or
 * the Lead ID column; mapped headers must exist in the sheet; ignoring anything, or content no mapping can import
 * (`notImportable`, from the preview), needs the acknowledgement.
 */
export function sourceDraftV2Schema(sheetHeaders: readonly string[], opts: { notImportable?: boolean } = {}) {
  const norm = (h: string) => h.trim().replace(/\s+/g, " ").toLowerCase();
  const present = new Set(sheetHeaders.map(norm));
  return z.object({
    displayName: z.string().trim().min(1, "Name is required").max(120),
    leadSourceDefault: z.string().trim().min(1).max(120),
    idHeader: z.string().trim().max(200).nullable(),
    columns: z.array(mappingColumnSchema).max(200),
    ignored: z.array(z.string().trim().min(1)).max(200),
    includeExisting: z.boolean(),
    acknowledged: z.boolean(),
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
    const missing = d.columns.find((c) => !present.has(norm(c.header)));
    if (missing) ctx.addIssue({ code: "custom", message: `"${missing.header}" is no longer in the sheet. Choose another column or remove it.`, path: ["columns"] });
    const accounted = new Set([...d.columns.map((c) => c.header), ...d.ignored, ...(d.idHeader ? [d.idHeader] : [])].map(norm));
    if (d.ignored.some((h) => d.columns.some((c) => norm(c.header) === norm(h)))) {
      ctx.addIssue({ code: "custom", message: "A column can't be both imported and ignored", path: ["ignored"] });
    }
    const open = sheetHeaders.filter((h) => h.trim() && !accounted.has(norm(h)));
    if (open.length) ctx.addIssue({ code: "custom", message: `Choose a field or "Don't import" for: ${open.slice(0, 3).join(", ")}${open.length > 3 ? "…" : ""}`, path: ["columns"] });
    if ((d.ignored.length > 0 || opts.notImportable) && !d.acknowledged) {
      ctx.addIssue({ code: "custom", message: "Confirm the columns that won't be imported", path: ["acknowledged"] });
    }
  });
}

export function toPayloadV2(draft: SourceDraftV2, pick: { spreadsheetId: string; sheetId: number; spreadsheetName: string; sheetTitle: string }) {
  return { ...toPayload(draft, pick), mapping: { v: 2 as const, columns: draft.columns, ignored: draft.ignored } };
}
