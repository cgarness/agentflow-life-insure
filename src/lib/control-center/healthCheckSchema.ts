import { z } from "zod";
import { HEALTH_CHECK_TYPES, HEALTH_STATUSES, ISSUE_SEVERITIES } from "./constants";

export const healthCheckFormSchema = z.object({
  check_key: z
    .string()
    .min(1, "Check key is required")
    .max(120)
    .regex(/^[a-z0-9_.-]+$/i, "Letters, numbers, _ . - only"),
  name: z.string().min(1, "Name is required").max(160),
  category: z.string().min(1, "Category is required").max(80),
  check_type: z.enum(HEALTH_CHECK_TYPES),
  description: z.string().max(2000).optional().or(z.literal("")),
  target: z.string().max(400).optional().or(z.literal("")),
  expected_result: z.string().max(400).optional().or(z.literal("")),
  status: z.enum(HEALTH_STATUSES).default("unknown"),
  severity: z.enum(ISSUE_SEVERITIES).default("medium"),
  is_enabled: z.boolean().default(true),
});

export type HealthCheckFormValues = z.infer<typeof healthCheckFormSchema>;
