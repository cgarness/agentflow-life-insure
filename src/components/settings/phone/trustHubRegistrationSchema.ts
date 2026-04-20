import { z } from "zod";
import { toE164Plus } from "@/utils/phoneUtils";

export const TRUST_HUB_BUSINESS_TYPES = [
  "sole_proprietorship",
  "partnership",
  "llc",
  "corporation",
] as const;

export const trustHubRegistrationSchema = z.object({
  business_name: z.string().trim().min(1, "Legal business name is required"),
  business_type: z.enum(TRUST_HUB_BUSINESS_TYPES, {
    message: "Choose a business structure",
  }),
  ein: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().length(9, "EIN must be exactly 9 digits")),
  address_street: z.string().trim().min(1, "Street address is required"),
  address_city: z.string().trim().min(1, "City is required"),
  address_state: z
    .string()
    .trim()
    .length(2, "Use a 2-letter state code")
    .transform((s) => s.toUpperCase()),
  address_zip: z.string().trim().min(1, "ZIP code is required"),
  contact_first_name: z.string().trim().min(1, "First name is required"),
  contact_last_name: z.string().trim().min(1, "Last name is required"),
  contact_email: z.string().trim().email("Enter a valid email"),
  contact_phone: z
    .string()
    .trim()
    .min(1, "Business phone is required")
    .refine((s) => {
      const e164 = toE164Plus(s);
      return e164.startsWith("+") && e164.replace(/\D/g, "").length >= 11;
    }, "Use a full phone number with area code (US numbers are fine)."),
  website: z.string().trim().optional(),
});

export type TrustHubRegistrationOutput = z.infer<typeof trustHubRegistrationSchema>;
export type TrustHubRegistrationFormInput = z.input<typeof trustHubRegistrationSchema>;
