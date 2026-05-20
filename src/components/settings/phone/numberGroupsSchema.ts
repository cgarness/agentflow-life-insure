import { z } from "zod";

export const numberGroupFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Max 100 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Max 500 characters")
    .optional()
    .or(z.literal("")),
});

export type NumberGroupFormValues = z.infer<typeof numberGroupFormSchema>;
