/**
 * supabase-import-history — the scoped reader for Contacts → Import History.
 *
 * The defect this replaces: `Contacts.tsx` fetched `import_history` with `select("*")`, no
 * `organization_id` filter, no `agent_id` filter and no limit, then swallowed every error behind
 * `if (!error && data)`. Because `import_history_select` RLS is organization-wide
 * (`organization_id = get_user_org_id()`), the page rendered every import in the organization to
 * every user, and a failed load was pixel-identical to an empty history.
 *
 * Scoping contract:
 *   - Admin and non-impersonating Super Admin → all imports in the EFFECTIVE organization.
 *   - Every other role, INCLUDING Team Leaders → only rows they personally uploaded
 *     (`agent_id = effective profile id`). A Team Leader's downline is deliberately NOT consulted.
 *   - Every query carries `organization_id`, in both modes.
 *
 * ⚠️ This is QUERY SCOPING, not a database authorization boundary. `import_history_select` remains
 * organization-wide; tightening it is a separate, unapproved RLS phase.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";

/** Explicit projection — every field the Import History tab actually renders, and nothing more. */
const IMPORT_HISTORY_COLUMNS =
  "id, file_name, created_at, total_records, imported, duplicates, errors, imported_lead_ids, import_completion_status, undo_status, campaign_id";

/** Bound on a single page of history. Generous for a real agency, but never unbounded. */
export const IMPORT_HISTORY_LIMIT = 200;

export interface ListImportHistoryParams {
  /** The EFFECTIVE organization id. Required — a missing value issues no query. */
  organizationId: string | null | undefined;
  /** The EFFECTIVE profile id (matched against `import_history.agent_id`). */
  viewerId: string | null | undefined;
  /** True only for an Admin or a non-impersonating Super Admin (see `isOrganizationWideViewer`). */
  orgWide: boolean;
  limit?: number;
}

function toEntry(row: Record<string, unknown>): ImportHistoryEntry {
  return {
    id: String(row.id ?? ""),
    fileName: typeof row.file_name === "string" ? row.file_name : "",
    date: typeof row.created_at === "string" ? row.created_at : "",
    totalRecords: typeof row.total_records === "number" ? row.total_records : 0,
    imported: typeof row.imported === "number" ? row.imported : 0,
    duplicates: typeof row.duplicates === "number" ? row.duplicates : 0,
    errors: typeof row.errors === "number" ? row.errors : 0,
    importedLeadIds: Array.isArray(row.imported_lead_ids) ? (row.imported_lead_ids as string[]) : [],
    importCompletionStatus: (row.import_completion_status as string | null) ?? null,
    undoStatus: (row.undo_status as string | null) ?? null,
    campaignId: (row.campaign_id as string | null) ?? null,
  };
}

/**
 * List import history for ONE effective viewer.
 *
 * Fails closed: a missing organization or viewer id returns `[]` without issuing a query.
 * Throws on any query error, so the caller can distinguish a failure from a genuinely empty
 * history and offer a retry.
 */
export async function listImportHistory(params: ListImportHistoryParams): Promise<ImportHistoryEntry[]> {
  const organizationId = (params.organizationId ?? "").trim();
  const viewerId = (params.viewerId ?? "").trim();

  // Fail closed. Without an organization there is no tenant boundary to apply, and without a
  // viewer id a non-org-wide viewer has no uploader filter — either way, issue nothing.
  if (!organizationId) return [];
  if (!params.orgWide && !viewerId) return [];

  let query = supabase
    .from("import_history")
    .select(IMPORT_HISTORY_COLUMNS)
    // ALWAYS present, in both modes — never inferred from RLS.
    .eq("organization_id", organizationId);

  if (!params.orgWide) {
    query = query.eq("agent_id", viewerId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(params.limit ?? IMPORT_HISTORY_LIMIT);

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map(toEntry);
}
