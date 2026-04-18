import { supabase } from "@/integrations/supabase/client";
import type { TemplateAttachment, TemplateCategory } from "@/components/settings/messageTemplateTypes";

export interface SaveMessageTemplateInput {
  editTargetId: string | null;
  organizationId: string;
  name: string;
  type: "email" | "sms";
  subject: string | null;
  content: string;
  attachments: TemplateAttachment[];
  category: TemplateCategory | null;
}

export async function saveMessageTemplate(input: SaveMessageTemplateInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const payload = {
    name: input.name,
    type: input.type,
    subject: input.type === "email" ? input.subject : null,
    content: input.content,
    attachments: input.type === "email" ? input.attachments : [],
    category: input.category,
    updated_at: new Date().toISOString(),
  };

  if (input.editTargetId) {
    const { error } = await supabase.from("message_templates").update(payload).eq("id", input.editTargetId);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("message_templates").insert({
    ...payload,
    organization_id: input.organizationId,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
