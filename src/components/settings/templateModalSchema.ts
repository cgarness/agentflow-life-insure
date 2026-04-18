import { z } from "zod";

export const templateCategorySchema = z
  .enum(["Prospecting", "Follow-Up", "Appointment", "Re-Engagement", "Closing"])
  .nullable()
  .optional();

export const templateAttachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  size: z.number(),
});

export const templateFormSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required"),
    content: z.string().trim().min(1, "Message content is required"),
    type: z.enum(["email", "sms"]),
    subject: z.string().optional().nullable(),
    attachments: z.array(templateAttachmentSchema).optional(),
    category: templateCategorySchema,
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
