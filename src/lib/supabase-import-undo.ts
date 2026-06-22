import { supabase } from "@/integrations/supabase/client";

/**
 * Typed wrappers for the Import-Undo RPCs (Contacts Build 3, CP2).
 *
 * These call three narrowly-scoped SECURITY DEFINER functions added in migration
 * `20260620000100_import_undo_provenance_and_rpcs.sql`. The generated Supabase types are NOT
 * regenerated until CP3 (after the migration is applied), so the calls use a surgical
 * `(supabase as any).rpc(...)` cast. The local interfaces below are the contract; the SQL
 * functions are the source of truth (counts/codes only — no PII crosses the boundary).
 */

export type ImportCompletionStatus =
  | "pending_campaign"
  | "completed"
  | "completed_with_skips"
  | "campaign_partial"
  | "campaign_failed";

export type ImportUndoStatus = "undone" | null;

/** Blocking reason codes returned by preview/undo. Mirrors the SQL `_import_undo_context`/`_import_undo_blockers`. */
export type ImportUndoReasonCode =
  | "not_authenticated"
  | "no_org"
  | "not_found"
  | "cross_org"
  | "not_authorized"
  | "expired"
  | "legacy_no_ids"
  | "invalid_import_provenance"
  | "already_undone"
  | "lead_missing"
  | "has_calls"
  | "has_messages"
  | "has_emails"
  | "has_appointments"
  | "has_tasks"
  | "has_notes"
  | "has_activity"
  | "has_workflow"
  | "has_win"
  | "foreign_campaign_membership"
  | "ineligible";

export interface ImportUndoPreview {
  eligible: boolean;
  imported_id_count: number;
  existing_lead_count?: number;
  campaign_membership_count?: number;
  foreign_campaign_membership_count?: number;
  changed_or_missing_count?: number;
  blocked_reason_codes: ImportUndoReasonCode[];
  import_completion_status: ImportCompletionStatus | null;
  undo_status: ImportUndoStatus;
  summary?: string;
}

export interface ImportFinalizeResult {
  finalized: boolean;
  status?: ImportCompletionStatus;
  idempotent?: boolean;
  imported_count?: number;
  eligible_count?: number;
  tagged_count?: number;
  reason?: ImportUndoReasonCode;
}

export interface ImportUndoResult {
  success: boolean;
  reason?: ImportUndoReasonCode;
  blocked_reason_codes?: ImportUndoReasonCode[];
  deleted_leads?: number;
  deleted_campaign_rows?: number;
  undo_status?: "undone";
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Provenance id hygiene: keep only distinct, valid-UUID strings. The edge returns NEW inserted lead
 * ids only (updated duplicates excluded), so the deduped, valid set is the rollback source of truth.
 */
export function dedupeValidImportIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x))));
}

/**
 * Client-side import-history row status HINT (Active / Undone / Undo unavailable / Expired). The server
 * preview/undo RPCs remain authoritative on true eligibility (engagement, conversion, etc.).
 */
export function importUndoRowStatus(args: {
  undoStatus?: string | null;
  importedLeadIds: string[] | null | undefined;
  date: string;
  now?: number;
}): { label: "Active" | "Undone" | "Undo unavailable" | "Expired"; undoable: boolean; reason?: ImportUndoReasonCode } {
  if (args.undoStatus === "undone") return { label: "Undone", undoable: false };
  if (!args.importedLeadIds || args.importedLeadIds.length === 0) {
    return { label: "Undo unavailable", undoable: false, reason: "legacy_no_ids" };
  }
  const now = args.now ?? Date.now();
  const hours = (now - new Date(args.date).getTime()) / 3_600_000;
  if (hours >= 24) return { label: "Expired", undoable: false, reason: "expired" };
  return { label: "Active", undoable: true };
}

/** Human-readable explanation for a blocking reason code (for tooltips / undo-unavailable messaging). */
export function describeImportUndoReason(code: ImportUndoReasonCode): string {
  switch (code) {
    case "expired":
      return "Undo is only available within 24 hours of import.";
    case "legacy_no_ids":
      return "Undo unavailable — this legacy import did not record created Lead IDs.";
    case "invalid_import_provenance":
      return "Undo unavailable — this import's recorded Lead IDs are incomplete or invalid.";
    case "already_undone":
      return "This import has already been undone.";
    case "not_authorized":
      return "You are not authorized to undo this import.";
    case "cross_org":
      return "This import belongs to a different organization.";
    case "not_found":
      return "Import record not found.";
    case "lead_missing":
      return "Some imported leads were converted or deleted — undo would be incomplete.";
    case "has_calls":
      return "Some imported leads have call history.";
    case "has_messages":
      return "Some imported leads have SMS history.";
    case "has_emails":
      return "Some imported leads have email history.";
    case "has_appointments":
      return "Some imported leads have appointments.";
    case "has_tasks":
      return "Some imported leads have tasks.";
    case "has_notes":
      return "Some imported leads have notes.";
    case "has_activity":
      return "Some imported leads have recorded activity.";
    case "has_workflow":
      return "Some imported leads have a running workflow.";
    case "has_win":
      return "Some imported leads are linked to a recorded sale.";
    case "foreign_campaign_membership":
      return "Some imported leads were added to a campaign outside this import.";
    case "not_authenticated":
    case "no_org":
      return "Your session is missing required account context — please refresh and try again.";
    case "ineligible":
    default:
      return "This import can no longer be safely undone.";
  }
}

/** Server-backed eligibility preview (advisory). The execute RPC re-validates everything. */
export async function previewImportUndo(importId: string): Promise<ImportUndoPreview> {
  const { data, error } = await supabase.rpc("preview_contact_import_undo", {
    p_import_id: importId,
  });
  if (error) throw error;
  return data as unknown as ImportUndoPreview;
}

/** Compute + persist an import's completion status from actual DB state (idempotent). */
export async function finalizeImport(importId: string): Promise<ImportFinalizeResult> {
  const { data, error } = await supabase.rpc("finalize_contact_import", {
    p_import_id: importId,
  });
  if (error) throw error;
  return data as unknown as ImportFinalizeResult;
}

/** Atomic, all-or-nothing undo. Returns actual deleted counts or a stable reason code. */
export async function undoContactImport(importId: string): Promise<ImportUndoResult> {
  const { data, error } = await supabase.rpc("undo_contact_import", {
    p_import_id: importId,
  });
  if (error) throw error;
  return data as unknown as ImportUndoResult;
}
