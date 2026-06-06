import { z } from "zod";
import {
  TRACKER_ACTIONS_NEEDED,
  TRACKER_ISSUE_SEVERITIES,
  TRACKER_ISSUE_STATUSES,
  TRACKER_MARKETABLE_STATUSES,
  TRACKER_PRIORITIES,
  TRACKER_REALITY_STATUSES,
  TRACKER_STATUSES,
} from "./trackerTypes";

const keyField = z
  .string()
  .min(1, "Key is required")
  .max(120)
  .regex(/^[a-z0-9_.-]+$/i, "Letters, numbers, _ . - only");

const optionalText = (max: number) => z.string().max(max).optional().or(z.literal(""));

// --- System ------------------------------------------------------------------
export const systemFormSchema = z.object({
  system_key: keyField,
  name: z.string().min(1, "Name is required").max(160),
  category: z.string().min(1, "Category is required").max(80),
  plain_english_summary: optionalText(2000),
  status: z.enum(TRACKER_STATUSES),
  priority: z.enum(TRACKER_PRIORITIES),
  marketable_status: z.enum(TRACKER_MARKETABLE_STATUSES),
  owner: optionalText(120),
  sort_order: z.coerce.number().int().min(0).max(100000).default(100),
  notes: optionalText(4000),
});
export type SystemFormValues = z.infer<typeof systemFormSchema>;

// --- Item --------------------------------------------------------------------
export const itemFormSchema = z.object({
  system_id: z.string().uuid("Select a system"),
  item_key: keyField,
  title: z.string().min(1, "Title is required").max(200),
  description: optionalText(4000),
  status: z.enum(TRACKER_STATUSES),
  priority: z.enum(TRACKER_PRIORITIES),
  marketable_status: z.enum(TRACKER_MARKETABLE_STATUSES),
  production_critical: z.boolean().default(false),
  mobile_visible: z.boolean().default(true),
  source_of_truth: optionalText(500),
  next_action: optionalText(1000),
  notes: optionalText(4000),
  sort_order: z.coerce.number().int().min(0).max(100000).default(100),
});
export type ItemFormValues = z.infer<typeof itemFormSchema>;

// --- Issue -------------------------------------------------------------------
const NONE = "__none__";
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v !== NONE ? v : undefined))
  .refine((v) => v === undefined || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection");

export const issueFormSchema = z.object({
  issue_key: keyField,
  title: z.string().min(1, "Title is required").max(200),
  description: optionalText(4000),
  severity: z.enum(TRACKER_ISSUE_SEVERITIES),
  status: z.enum(TRACKER_ISSUE_STATUSES),
  system_id: optionalUuid,
  item_id: optionalUuid,
  owner: optionalText(120),
  next_action: optionalText(1000),
  notes: optionalText(4000),
});
export type IssueFormValues = z.infer<typeof issueFormSchema>;
export const ISSUE_LINK_NONE = NONE;

// --- Marketing claim ---------------------------------------------------------
export const marketingClaimFormSchema = z.object({
  claim_key: keyField,
  feature_claim: z.string().min(1, "Claim is required").max(400),
  marketed_location: optionalText(300),
  reality_status: z.enum(TRACKER_REALITY_STATUSES),
  actual_status: optionalText(1000),
  action_needed: z.enum(TRACKER_ACTIONS_NEEDED),
  priority: z.enum(TRACKER_PRIORITIES),
  system_id: optionalUuid,
  notes: optionalText(4000),
});
export type MarketingClaimFormValues = z.infer<typeof marketingClaimFormSchema>;
