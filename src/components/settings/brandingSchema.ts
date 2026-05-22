import { z } from "zod";

const TIMEZONE_VALUES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata",
  "Australia/Sydney", "America/Sao_Paulo",
] as const;

const optionalUrl = z
  .string()
  .trim()
  .max(2000, "Website URL is too long")
  .refine(
    (v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v),
    "Enter a valid URL starting with http:// or https://",
  );

const optionalPhone = z
  .string()
  .trim()
  .refine(
    (v) => v === "" || v.replace(/\D/g, "").length === 10,
    "Phone number must be 10 digits",
  );

export const brandingFormSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(100, "Company name must be 100 characters or less"),
  logoUrl: z.string().nullable(),
  logoName: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  faviconName: z.string().nullable(),
  timezone: z.enum(TIMEZONE_VALUES, { errorMap: () => ({ message: "Invalid timezone" }) }),
  timeFormat: z.enum(["12", "24"], { errorMap: () => ({ message: "Time format must be 12 or 24" }) }),
  companyPhone: optionalPhone,
  websiteUrl: optionalUrl,
  primaryColor: z
    .string()
    .regex(/^#([0-9A-Fa-f]{6})$/, "Primary color must be a 6-digit hex code (e.g. #3B82F6)"),
});

export type BrandingFormInput = z.infer<typeof brandingFormSchema>;

export const LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/svg+xml"] as const;
export const FAVICON_MIME_TYPES = ["image/x-icon", "image/vnd.microsoft.icon", "image/png"] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const FAVICON_MAX_BYTES = 1 * 1024 * 1024;

export const logoFileSchema = z
  .instanceof(File)
  .refine((f) => (LOGO_MIME_TYPES as readonly string[]).includes(f.type), {
    message: "Invalid file type. Please upload a JPG, PNG, or SVG.",
  })
  .refine((f) => f.size <= LOGO_MAX_BYTES, { message: "File too large. Maximum size is 5MB." });

export const faviconFileSchema = z
  .instanceof(File)
  .refine((f) => (FAVICON_MIME_TYPES as readonly string[]).includes(f.type), {
    message: "Invalid file type. Please upload an ICO or PNG.",
  })
  .refine((f) => f.size <= FAVICON_MAX_BYTES, { message: "File too large. Maximum size is 1MB." });
