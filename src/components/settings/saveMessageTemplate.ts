import { supabase } from "@/integrations/supabase/client";
import type { TemplateAttachment, TemplateCategory, TemplateScope } from "@/components/settings/messageTemplateTypes";

export interface SaveMessageTemplateInput {
  editTargetId: string | null;
  organizationId: string;
  name: string;
  type: "email" | "sms";
  subject: string | null;
  content: string;
  attachments: TemplateAttachment[];
  category: TemplateCategory | null;
  scope: TemplateScope;
  /** Current user id; required when inserting a personal template. */
  createdBy: string | null;
}

export type SaveMessageTemplateResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

export async function saveMessageTemplate(input: SaveMessageTemplateInput): Promise<SaveMessageTemplateResult> {
  // Scope is fixed at creation; we never include it in UPDATE payloads.
  const basePayload = {
    name: input.name,
    type: input.type,
    subject: input.type === "email" ? input.subject : null,
    content: input.content,
    attachments: input.attachments,
    category: input.category,
    updated_at: new Date().toISOString(),
  };

  if (input.editTargetId) {
    const { data, error } = await supabase
      .from("message_templates")
      .update(basePayload)
      .eq("id", input.editTargetId)
      .eq("organization_id", input.organizationId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!data?.id) return { ok: false, message: "Template not found or not permitted" };
    return { ok: true, id: data.id };
  }

  if (input.scope === "personal" && !input.createdBy) {
    return { ok: false, message: "Personal templates require an owner" };
  }

  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      ...basePayload,
      organization_id: input.organizationId,
      scope: input.scope,
      created_by: input.scope === "personal" ? input.createdBy : null,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data?.id) return { ok: false, message: "Insert returned no row" };
  return { ok: true, id: data.id };
}
