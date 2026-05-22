import { z } from "zod";
import { ISSUE_SEVERITIES, ISSUE_SOURCES, ISSUE_STATUSES } from "./constants";

export const issueFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  severity: z.enum(ISSUE_SEVERITIES),
  status: z.enum(ISSUE_STATUSES),
  source: z.enum(ISSUE_SOURCES),
  feature_id: z.string().uuid().nullable().optional(),
  resolution_notes: z.string().max(2000).optional().or(z.literal("")),
});

export type IssueFormValues = z.infer<typeof issueFormSchema>;
