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
 * The four attachment categories are mutually exclusive and exhaustive over the imported set:
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

/**
 * Applies the partition identity to a success envelope during parsing. A success with a campaign
 * requires all four numeric categories AND the identity; a success with no campaign requires all
 * four to be null. Anything else is a malformed / overlapping / non-exhaustive partition and fails.
 */
function refineAttachmentPartition(
  val: {
    has_campaign?: boolean;
    imported_count?: number;
    attached_count?: number | null;
    already_present?: number | null;
    ineligible_count?: number | null;
    remaining_count?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const cats = [val.attached_count, val.already_present, val.ineligible_count, val.remaining_count];
  if (val.has_campaign === false) {
    if (cats.some((c) => c !== null)) {
      ctx.addIssue({ code: "custom", message: "a no-campaign import must report all four categories as null" });
    }
    return;
  }
  // has_campaign === true
  if (cats.some((c) => typeof c !== "number")) {
    ctx.addIssue({ code: "custom", message: "a campaign import must report all four numeric categories" });
    return;
  }
  const holds = attachmentPartitionHolds(val);
  if (holds !== true) {
    ctx.addIssue({
      code: "custom",
      message: "attachment categories do not partition the imported set (overlapping or non-exhaustive)",
    });
  }
}

/* -------------------------------------------- retry_import_campaign_attachment (response) */

/**
 * A real success/refusal union — NOT a bag of optional fields.
 *   ok:false  → a reason is required (nothing else is trusted).
 *   ok:true   → status, campaign state, imported count, ALL FOUR categories, and newly_attached
 *               are required, and the four categories must partition the imported set.
 */
const retryRefusalSchema = z.object({
  ok: z.literal(false),
  // An unrecognized reason code is preserved as a plain string so a future server code still
  // surfaces to the user instead of vanishing.
  reason: z.union([importRetryReasonSchema, z.string()]),
});

const retrySuccessSchema = z
  .object({
    ok: z.literal(true),
    status: importCompletionStatusSchema,
    has_campaign: z.boolean(),
    imported_count: countSchema,
    attached_count: countSchema.nullable(),
    already_present: countSchema.nullable(),
    ineligible_count: countSchema.nullable(),
    remaining_count: countSchema.nullable(),
    newly_attached: countSchema,
  })
  .superRefine(refineAttachmentPartition);

export const importRetryResultSchema = z.union([retryRefusalSchema, retrySuccessSchema]);

export type ImportRetryResultResponse = z.infer<typeof importRetryResultSchema>;

/* ---------------------------------------------------- finalize_contact_import (response) */

/**
 * A real union — NOT a bag of optional success fields (which let `{finalized:true,
 * status:"completed"}` pass and drive success UI).
 *   finalized:false          → a reason is required (refused).
 *   finalized:true + undone   → an already-undone import; status may be null (legacy), no partition.
 *   finalized:true + success  → status + campaign state + imported count + ALL FOUR categories
 *                               (numeric-and-partitioned with a campaign, all-null without one).
 *                               The idempotent (already-finalized, non-undone) branch returns the
 *                               same complete state as a fresh finalize.
 */
const finalizeRefusalSchema = z.object({
  finalized: z.literal(false),
  reason: z.string(),
});

const finalizeUndoneSchema = z.object({
  finalized: z.literal(true),
  undone: z.literal(true),
  status: importCompletionStatusSchema.nullable().optional(),
  idempotent: z.boolean().optional(),
});

const finalizeSuccessSchema = z
  .object({
    finalized: z.literal(true),
    status: importCompletionStatusSchema,
    idempotent: z.boolean().optional(),
    has_campaign: z.boolean(),
    imported_count: countSchema,
    attached_count: countSchema.nullable(),
    already_present: countSchema.nullable(),
    ineligible_count: countSchema.nullable(),
    remaining_count: countSchema.nullable(),
    tagged_count: countSchema.optional(),
  })
  .superRefine(refineAttachmentPartition);

export const importFinalizeOutcomeSchema = z.union([
  finalizeRefusalSchema,
  finalizeUndoneSchema,
  finalizeSuccessSchema,
]);

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
