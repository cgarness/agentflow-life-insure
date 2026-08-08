import { supabase } from "@/integrations/supabase/client";
import type { ImportCompletionStatus } from "@/lib/supabase-import-undo";
import type { ImportAssignStrategy, ImportCampaignType } from "@/lib/import-campaign-compatibility";
import {
  canDialCampaignSchema,
  createImportCampaignArgsSchema,
  createdImportCampaignSchema,
  importRetryResultSchema,
  type ImportRetryResultResponse,
} from "@/lib/import-campaign-schemas";

/**
 * Typed wrappers for the import-campaign RPCs.
 *
 * `create_import_campaign` and `retry_import_campaign_attachment` are narrowly-scoped
 * SECURITY DEFINER functions. The generated Supabase types are not regenerated until the
 * migrations are applied, so the calls use a surgical `(supabase as any).rpc(...)` cast —
 * the SQL functions are the source of truth. Counts and codes only; no PII crosses the boundary.
 *
 * `can_dial_campaign` is the SERVER-AUTHORITATIVE answer to "may this user dial this
 * campaign?". Every Dialer entry point gates on it. It FAILS CLOSED on any error.
 */

/* The new RPCs are absent from the generated Supabase types until the migrations are
   applied, so calls go through one narrow cast in this single place. */
const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> })
    .rpc(name, args);

export interface CreatedImportCampaign {
  id: string;
  type: ImportCampaignType;
  user_id: string;
  assigned_agent_ids: string[];
  organization_id: string;
}

export interface CreateImportCampaignArgs {
  name: string;
  type: ImportCampaignType;
  description: string;
  /** Resolved campaign owner. `null` lets the server default it to the caller. */
  ownerId: string | null;
  participantIds: string[];
  strategy: ImportAssignStrategy;
}

/**
 * Creates the import-time campaign server-side so an authorized Admin can create a campaign
 * OWNED BY the selected agent. A browser INSERT cannot do this: RLS `campaigns_insert`
 * requires `user_id = auth.uid()`.
 */
export async function createImportCampaign(args: CreateImportCampaignArgs): Promise<CreatedImportCampaign | null> {
  // Validate the OUTBOUND shape before it leaves the browser: a malformed uuid or a bad
  // enum should surface here, not as an opaque Postgres error.
  const parsedArgs = createImportCampaignArgsSchema.safeParse(args);
  if (!parsedArgs.success) {
    throw new Error(parsedArgs.error.issues[0]?.message ?? "Invalid campaign payload");
  }

  const { data, error } = await rpc("create_import_campaign", {
    p_name: parsedArgs.data.name,
    p_type: parsedArgs.data.type,
    p_description: parsedArgs.data.description,
    p_owner_id: parsedArgs.data.ownerId,
    p_participant_ids: parsedArgs.data.participantIds,
    p_assignment_strategy: parsedArgs.data.strategy,
  });
  if (error) throw new Error(error.message ?? "Failed to create the campaign");
  if (data == null) return null;

  // Validate the INBOUND envelope: the campaign id drives every downstream attach, so a
  // malformed response must fail loudly rather than silently attach nothing.
  const parsed = createdImportCampaignSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("The server returned an unexpected campaign payload");
  }
  return parsed.data as CreatedImportCampaign;
}

export type ImportRetryReason =
  | "not_authenticated"
  | "no_org"
  | "not_found"
  | "cross_org"
  | "not_authorized"
  | "already_undone"
  | "legacy_no_ids"
  | "invalid_import_provenance"
  | "no_campaign"
  | "campaign_not_found"
  | "campaign_mismatch"
  | "incompatible_campaign_type";

/**
 * The retry outcome IS the runtime-validated Zod union (refusal | complete success), not a loose
 * optional bag — a consumer must narrow on `ok` before reading the partition, and a partial success
 * cannot be fabricated in code.
 */
export type ImportRetryResult = ImportRetryResultResponse;

/**
 * Retries ONLY the campaign attachment for an import. The client supplies the import id and
 * nothing else — the retry set is derived server-side from `import_history.imported_lead_ids`
 * minus actual current membership. Idempotent and concurrency-safe; never re-runs the import.
 */
export async function retryImportCampaignAttachment(importId: string): Promise<ImportRetryResult> {
  const { data, error } = await rpc("retry_import_campaign_attachment", { p_import_id: importId });
  if (error) throw new Error(error.message ?? "Retry failed");

  // The envelope is a real success/refusal union — a malformed or overlapping-partition response
  // (or a null envelope) must fail loudly, never render as trusted attachment figures.
  const parsed = importRetryResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("The server returned an unexpected retry result");
  }
  return parsed.data;
}

/**
 * Server-authoritative Dialer authorization for one campaign. FAILS CLOSED.
 *
 * NOTE: this is the authorization *decision*. The database independently enforces Dialer
 * SESSIONS in `start_dialer_session`. The Campaign Detail quick-call path does not pass
 * through `start_dialer_session`, so for that path this is a server-authoritative answer
 * consumed by a cooperating client — NOT a database-level block. See AGENT_RULES.
 */
export async function canDialCampaign(campaignId: string): Promise<boolean> {
  if (!campaignId) return false;
  try {
    const { data, error } = await rpc("can_dial_campaign", { p_campaign_id: campaignId });
    if (error) return false;
    // Strictly boolean. Anything else is not a grant — fail closed.
    const parsed = canDialCampaignSchema.safeParse(data);
    return parsed.success && parsed.data === true;
  } catch {
    return false;
  }
}

/**
 * Whether an import's campaign attachment can still be retried.
 *
 * `completed_with_skips` is included deliberately: the pre-fix `finalize_contact_import`
 * arithmetic stamped total attachment failures with that status, so legacy rows must stay
 * recoverable. The server re-derives the truth from actual `campaign_leads` membership and
 * no-ops when nothing is left to attach.
 */
export function isRetryableImportStatus(status: ImportCompletionStatus | null | undefined): boolean {
  if (!status) return false;
  return status !== "completed";
}

export type ImportCompletionTone = "success" | "warning" | "error" | "neutral";

export interface ImportCompletionDescriptor {
  tone: ImportCompletionTone;
  title: string;
  detail: string;
  retryable: boolean;
}

/** Truthful presentation of an import's completion state. Never reports a false success. */
export function describeImportCompletion(
  status: ImportCompletionStatus | null | undefined,
): ImportCompletionDescriptor {
  switch (status) {
    case "completed":
      return { tone: "success", title: "Import Complete!", detail: "All imported leads were added to the campaign.", retryable: false };
    case "completed_with_skips":
      return {
        tone: "warning",
        title: "Imported — some leads were not eligible",
        detail: "Your leads were imported. Some could not join this campaign under its rules.",
        retryable: true,
      };
    case "campaign_partial":
      return {
        tone: "warning",
        title: "Imported — campaign attachment incomplete",
        detail: "Your leads were imported and kept. Some were not added to the campaign yet.",
        retryable: true,
      };
    case "campaign_failed":
      return {
        tone: "error",
        title: "Imported — campaign attachment failed",
        detail: "Every lead was imported and kept, but none were added to the campaign.",
        retryable: true,
      };
    case "pending_campaign":
      return { tone: "neutral", title: "Imported — finishing campaign attachment…", detail: "Finalizing.", retryable: true };
    default:
      return {
        tone: "neutral",
        title: "Imported — attachment not confirmed",
        detail: "Your leads were imported and kept. We couldn't confirm the campaign attachment.",
        retryable: true,
      };
  }
}
