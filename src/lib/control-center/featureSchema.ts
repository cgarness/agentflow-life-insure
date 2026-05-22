import { z } from "zod";
import { FEATURE_PRIORITIES, FEATURE_STATUSES } from "./constants";

export const featureFormSchema = z
  .object({
    feature_key: z
      .string()
      .min(1, "Feature key is required")
      .max(120)
      .regex(/^[a-z0-9_.-]+$/i, "Letters, numbers, _ . - only"),
    name: z.string().min(1, "Name is required").max(160),
    category: z.string().min(1, "Category is required").max(80),
    description: z.string().max(2000).optional().or(z.literal("")),
    status: z.enum(FEATURE_STATUSES),
    priority: z.enum(FEATURE_PRIORITIES),
    owner: z.string().max(120).optional().or(z.literal("")),
    is_customer_visible: z.boolean().default(false),
    is_internal_only: z.boolean().default(true),
    is_blocked: z.boolean().default(false),
    blocked_reason: z.string().max(500).optional().or(z.literal("")),
  })
  .refine((v) => !v.is_blocked || (v.blocked_reason && v.blocked_reason.trim().length > 0), {
    message: "Blocked reason is required when feature is blocked",
    path: ["blocked_reason"],
  });

export type FeatureFormValues = z.infer<typeof featureFormSchema>;
