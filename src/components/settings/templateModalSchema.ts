import { z } from "zod";

export const templateCategorySchema = z
  .enum(["Prospecting", "Follow-Up", "Appointment", "Re-Engagement", "Closing"])
  .nullable()
  .optional();

export const templateScopeSchema = z.enum(["agency", "personal"]);

export const templateAttachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  size: z.number(),
});

export const templateFormSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required").max(80, "Name must be 80 characters or fewer"),
    content: z.string().trim().min(1, "Message content is required").max(10000, "Content is too long"),
    type: z.enum(["email", "sms"]),
    subject: z
      .string()
      .max(120, "Subject must be 120 characters or fewer")
      .optional()
      .nullable(),
    attachments: z.array(templateAttachmentSchema).optional(),
    category: templateCategorySchema,
    scope: templateScopeSchema,
  })
  .superRefine((data, ctx) => {
    if (data.type === "email" && !data.subject?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subject is required for email templates",
        path: ["subject"],
      });
    }
  });

export type TemplateFormValues = z.infer<typeof templateFormSchema>;
