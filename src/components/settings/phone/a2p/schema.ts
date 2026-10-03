import { z } from "zod";
const https = z.string().trim().max(2048).refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "Use an HTTPS URL");
export const preparationSchema = z.object({
  businessName: z.string().trim().min(1, "Enter your legal business name").max(120),
  brandType: z.enum(["STANDARD", "SOLE_PROPRIETOR"]),
  website: https.refine((v) => v.length <= 255, "Business website must be 255 characters or fewer"),
  description: z.string().trim().max(4096),
  privacyUrl: https,
  termsUrl: https,
});
