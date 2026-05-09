import { z } from "zod";
import { toE164Plus } from "@/utils/phoneUtils";

export const TRUST_HUB_BUSINESS_TYPES = [
  "sole_proprietorship",
  "partnership",
  "llc",
  "corporation",
] as const;

export const TRUST_HUB_BUSINESS_INDUSTRIES = [
  "INSURANCE",
  "FINANCE",
  "HEALTHCARE",
  "LEGAL",
  "REAL_ESTATE",
  "OTHER",
] as const;

export const TRUST_HUB_REGIONS_OF_OPERATION = [
  "USA_AND_CANADA",
  "LATIN_AMERICA",
  "EUROPE",
  "ASIA",
  "AFRICA",
  "AUSTRALIA",
] as const;

// Which Trust Hub registration programs to enroll in
export const TRUST_HUB_PROGRAMS = {
  shaken_stir: "SHAKEN/STIR",
  voice_integrity: "Voice Integrity",
  cnam: "CNAM (Caller ID Name)",
} as const;

export type TrustHubProgram = keyof typeof TRUST_HUB_PROGRAMS;

export const trustHubRegistrationSchema = z.object({
  // Business Information
  business_name: z.string().trim().min(1, "Legal business name is required"),
  business_type: z.enum(TRUST_HUB_BUSINESS_TYPES, {
    message: "Choose a business structure",
  }),
  business_industry: z.enum(TRUST_HUB_BUSINESS_INDUSTRIES).default("INSURANCE"),
  business_registration_number: z.string().trim().optional(), // same as EIN typically
  ein: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().length(9, "EIN must be exactly 9 digits")),
  website: z.string().trim().optional(),

  // Business Address
  address_street: z.string().trim().min(1, "Street address is required"),
  address_city: z.string().trim().min(1, "City is required"),
  address_state: z
    .string()
    .trim()
    .length(2, "Use a 2-letter state code")
    .transform((s) => s.toUpperCase()),
  address_zip: z.string().trim().min(1, "ZIP code is required"),

  // Authorized Representative / Contact
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
  contact_title: z.string().trim().optional(), // job title of the authorized rep

  // CNAM display name (optional, up to 15 chars)
  cnam_display_name: z
    .string()
    .trim()
    .max(15, "CNAM display name must be 15 characters or fewer")
    .optional(),

  // Which programs to enroll in
  enroll_shaken_stir: z.boolean().default(true),
  enroll_voice_integrity: z.boolean().default(true),
  enroll_cnam: z.boolean().default(false),
});

export type TrustHubRegistrationOutput = z.infer<typeof trustHubRegistrationSchema>;
export type TrustHubRegistrationFormInput = z.input<typeof trustHubRegistrationSchema>;
