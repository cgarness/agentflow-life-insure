import { z } from "zod";
import { normalizePhoneNumber } from "@/utils/phoneUtils";

export const dncEntrySchema = z.object({
  phone_number: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .transform((v) => normalizePhoneNumber(v))
    .refine((v) => /^1\d{10}$/.test(v), "Enter a valid 10-digit US phone number"),
  reason: z
    .string()
    .trim()
    .max(200, "Reason must be 200 characters or fewer")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type DNCEntryInput = z.input<typeof dncEntrySchema>;
export type DNCEntryParsed = z.output<typeof dncEntrySchema>;
