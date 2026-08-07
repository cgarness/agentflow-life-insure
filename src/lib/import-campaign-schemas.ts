import { z } from "zod";

/**
 * Runtime contracts for the trust boundaries this import work introduces or modifies.
 *
 * Lives in `src/lib` (not under a component directory) because `src/lib/supabase-import-undo.ts`
 * and `src/lib/supabase-import-campaign.ts` consume it — a `src/lib` -> component dependency
 * would be the wrong direction.
 *
 * SCOPE — deliberately narrow. These schemas validate **shape only**: UUIDs, enums, counts,
 * nullable fields, and RPC response envelopes. Campaign eligibility, ownership resolution and
 * authorization are NOT duplicated here — they live in the pure helpers
 * (`@/lib/import-campaign-compatibility`) and, authoritatively, in the database functions
 * `create_import_campaign` / `add_leads_to_campaign` / `retry_import_campaign_attachment`.
 * Re-encoding business rules in Zod would create a second source of truth that could drift
 * from the server.
 *
 * NOT duplicated here: the custom-field creation form. That boundary is already fully covered
 * by the shared `customFieldSchema` in
 *   src/components/settings/contact-flow/contactFlowSchemas.ts
 * (name trim/min 1/max 40, type enum, appliesTo, required, active, defaultValue, dropdown
 * options with a `superRefine`), which the import mapper now reuses directly.
 */

/* ------------------------------------------------------------------ shared primitives */

export const uuidSchema = z.string().uuid();

/** Mirrors `campaigns_type_check`: type = ANY (ARRAY['Open Pool','Personal','Team']). */
export const importCampaignTypeSchema = z.enum(["Personal", "Team", "Open Pool"]);

/** Mirrors the four assignment strategies the import wizard and the Edge Function accept. */
export const importAssignStrategySchema = z.enum([
  "myself",
  "specific_agent",
  "round_robin",
  "unassigned",
]);

/** Mirrors `import_history_completion_status_chk` (nullable in the database). */
export const importCompletionStatusSchema = z.enum([
  "pending_campaign",
  "completed",
  "completed_with_skips",
  "campaign_partial",
  "campaign_failed",
]);

const countSchema = z.number().int().nonnegative();

/* --------------------------------------------------- create_import_campaign (request) */

/**
 * Outbound payload shape for `public.create_import_campaign`.
 *
 * `ownerId` is nullable by design: the server defaults it to the caller. Whether a given
 * (type, strategy, ownerId) combination is *allowed* is decided by the server, not here.
 */
export const createImportCampaignArgsSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required"),
  type: importCampaignTypeSchema,
  description: z.string(),
  ownerId: uuidSchema.nullable(),
  participantIds: z.array(uuidSchema),
  strategy: importAssignStrategySchema,
});

export type CreateImportCampaignArgsInput = z.infer<typeof createImportCampaignArgsSchema>;

/* -------------------------------------------------- create_import_campaign (response) */

/**
 * `assigned_agent_ids` arrives as a jsonb array. It is normalized to `string[]` and each
 * element must be a UUID — a malformed participant list must never reach React state.
 */
export const createdImportCampaignSchema = z.object({
  id: uuidSchema,
  type: importCampaignTypeSchema,
  user_id: uuidSchema,
  created_by: uuidSchema.nullable().optional(),
  assigned_agent_ids: z.array(uuidSchema).catch([]),
  organization_id: uuidSchema,
});

export type CreatedImportCampaignResponse = z.infer<typeof createdImportCampaignSchema>;

/* ------------------------------------------ retry_import_campaign_attachment (response) */

export const importRetryReasonSchema = z.enum([
  "not_authenticated",
  "no_org",
  "not_found",
  "cross_org",
  "not_authorized",
  "already_undone",
  "legacy_no_ids",
  "invalid_import_provenance",
  "no_campaign",
  "campaign_not_found",
  "campaign_mismatch",
  "incompatible_campaign_type",
]);

/**
 * The retry envelope. Counts are only present on the success branch, so they are optional —
 * but when present they must be non-negative integers, because they are rendered to the user
 * as truthful attachment figures.
 */
export const importRetryResultSchema = z.object({
  ok: z.boolean(),
  has_campaign: z.boolean().optional(),
  // An unrecognized reason code is preserved as a plain string rather than dropped, so a
  // future server-side code still surfaces to the user instead of vanishing.
  reason: z.union([importRetryReasonSchema, z.string()]).optional(),
  status: importCompletionStatusSchema.optional(),
  imported_count: countSchema.optional(),
  // The four attachment categories are NULL for an import with no campaign, so a surface can
  // tell "no attachment dimension" apart from "zero attached".
  attached_count: countSchema.nullable().optional(),
  already_present: countSchema.nullable().optional(),
  ineligible_count: countSchema.nullable().optional(),
  remaining_count: countSchema.nullable().optional(),
  newly_attached: countSchema.optional(),
});

export type ImportRetryResultResponse = z.infer<typeof importRetryResultSchema>;

/* ---------------------------------------------------- finalize_contact_import (response) */

/**
 * The finalize envelope. `status` is nullable because a refused finalize returns
 * `{finalized:false, reason}` with no status, and legacy rows can carry NULL.
 */
export const importFinalizeOutcomeSchema = z.object({
  finalized: z.boolean().optional(),
  reason: z.string().optional(),
  status: importCompletionStatusSchema.nullable().optional(),
  idempotent: z.boolean().optional(),
  has_campaign: z.boolean().optional(),
  imported_count: countSchema.optional(),
  // NULL for an import with no campaign — see importRetryResultSchema.
  attached_count: countSchema.nullable().optional(),
  already_present: countSchema.nullable().optional(),
  remaining_count: countSchema.nullable().optional(),
  ineligible_count: countSchema.nullable().optional(),
  tagged_count: countSchema.optional(),
});

/**
 * The server guarantees these four categories are mutually exclusive and exhaustive:
 *   imported_count = attached_count + already_present + ineligible_count + remaining_count
 * Returns null when the import has no campaign (no attachment dimension exists).
 */
export function attachmentPartitionHolds(o: {
  imported_count?: number;
  attached_count?: number | null;
  already_present?: number | null;
  ineligible_count?: number | null;
  remaining_count?: number | null;
}): boolean | null {
  const { imported_count, attached_count, already_present, ineligible_count, remaining_count } = o;
  if (
    typeof imported_count !== "number" ||
    typeof attached_count !== "number" ||
    typeof already_present !== "number" ||
    typeof ineligible_count !== "number" ||
    typeof remaining_count !== "number"
  ) {
    return null;
  }
  return attached_count + already_present + ineligible_count + remaining_count === imported_count;
}

export type ImportFinalizeOutcomeResponse = z.infer<typeof importFinalizeOutcomeSchema>;

/* ------------------------------------------------------- can_dial_campaign (response) */

/**
 * Strictly boolean. Anything else — null, a string, an object — is NOT a grant.
 * The consumer treats a parse failure as `false` (fail closed).
 */
export const canDialCampaignSchema = z.boolean();

/* ------------------------------------------------ import payload custom-field contract */

/**
 * The `customFields` object sent to the unchanged `import-contacts` Edge Function.
 *
 * CONTRACT: keys are CANONICAL FIELD NAMES, never stable option values and never database
 * UUIDs — `leads.custom_fields` is flat JSONB keyed by name (migration `20260403000000`) and
 * no rename propagation exists. This schema is the runtime guard that a `custom:<uuid>`
 * mapping value can never leak into the payload as a key.
 */
const CUSTOM_OPTION_VALUE_RE = /^custom:/i;
const BARE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** UI-only decoration. Must never appear in a persisted or transmitted field name. */
const CUSTOM_LABEL_SUFFIX_RE = /\(\s*custom\s*\)/i;

export const importCustomFieldsPayloadSchema = z
  .record(z.string(), z.unknown())
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      // `__agentflow` and `tags` are reserved markers the Edge Function writes/reads.
      if (key === "__agentflow" || key === "tags") continue;
      if (CUSTOM_OPTION_VALUE_RE.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Custom-field payload key "${key}" is a stable option value, not a canonical field name`,
        });
      }
      if (BARE_UUID_RE.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Custom-field payload key "${key}" is a database UUID, not a canonical field name`,
        });
      }
      if (CUSTOM_LABEL_SUFFIX_RE.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Custom-field payload key "${key}" carries the UI-only "(Custom)" suffix`,
        });
      }
    }
  });

export type ImportCustomFieldsPayload = z.infer<typeof importCustomFieldsPayloadSchema>;
