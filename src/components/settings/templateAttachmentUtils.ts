import { templateAttachmentSchema } from "@/components/settings/templateModalSchema";
import type { TemplateAttachment } from "@/components/settings/messageTemplateTypes";

export const TEMPLATE_ATTACHMENTS_BUCKET = "template-attachments";

export const TEMPLATE_ATTACHMENT_ACCEPT_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".docx"];

export function parseAttachments(raw: unknown): TemplateAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateAttachment[] = [];
  for (const item of raw) {
    const r = templateAttachmentSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}
