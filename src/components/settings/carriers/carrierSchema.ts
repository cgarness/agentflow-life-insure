import { z } from "zod";

const labeledContactSchema = z.object({
  label: z.string().trim().max(50, "Label must be 50 characters or less"),
  value: z.string().trim()
});

export const carrierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Carrier name is required")
    .max(80, "Carrier name must be 80 characters or less"),
  
  portal_url: z
    .string()
    .trim()
    .transform((val) => {
      if (!val) return null;
      let url = val;
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }
      return url;
    })
    .pipe(
      z
        .string()
        .nullable()
        .refine((val) => {
          if (!val) return true;
          try {
            const u = new URL(val);
            return ["http:", "https:"].includes(u.protocol);
          } catch {
            return false;
          }
        }, "Portal URL must be a valid http or https link")
    )
    .nullable()
    .optional(),
  
  logo_url: z
    .string()
    .trim()
    .refine((val) => {
      if (!val) return true;
      if (val.toLowerCase().startsWith("data:")) {
        // Allow only jpeg, png, and webp data URLs
        return /^data:image\/(jpeg|png|webp);base64,/i.test(val);
      }
      return /^https:\/\//i.test(val);
    }, "Logo must be a valid https:// URL or a safe image data URL (JPEG, PNG, WebP)")
    .nullable()
    .optional(),
  
  contact_phones: z
    .array(labeledContactSchema)
    .transform((rows) => rows.filter((r) => r.label.trim() || r.value.trim()))
    .pipe(
      z
        .array(
          labeledContactSchema.extend({
            value: z.string().trim().max(40, "Phone number must be 40 characters or less")
          })
        )
        .max(10, "Maximum of 10 phone contacts")
    ),

  contact_emails: z
    .array(labeledContactSchema)
    .transform((rows) => rows.filter((r) => r.label.trim() || r.value.trim()))
    .pipe(
      z
        .array(
          z.object({
            label: z.string().trim().max(50, "Label must be 50 characters or less"),
            value: z
              .string()
              .trim()
              .refine((val) => {
                if (!val) return true;
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
              }, "Enter a valid email address")
          })
        )
        .max(10, "Maximum of 10 email contacts")
    ),

  is_appointed: z.boolean().default(false),
});

export type CarrierFormInput = z.input<typeof carrierSchema>;
export type CarrierFormOutput = z.output<typeof carrierSchema>;
