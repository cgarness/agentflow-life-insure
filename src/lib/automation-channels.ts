import { supabase } from "@/integrations/supabase/client";

export interface AutomationChannelOptions {
  moreTemplates: boolean;
  moreSenders: boolean;
  senders: { id: string; from_email: string; reply_to: string }[];
  templates: {
    id: string;
    name: string;
    type: "email" | "sms";
    sms_purpose: "informational" | "marketing" | null;
    subject: string | null;
    content: string;
  }[];
}

interface ChannelQuery {
  search?: string;
  offset?: number;
  senderId?: string;
  templateId?: string;
  type?: "sms" | "email";
}

export async function getAutomationChannelOptions(
  input: ChannelQuery = {},
): Promise<AutomationChannelOptions> {
  const { data, error } = await supabase.rpc("automation_channel_options", {
    p_search: input.search,
    p_offset: input.offset,
    p_sender_id: input.senderId,
    p_template_id: input.templateId,
    p_type: input.type,
  });
  if (error) throw error;
  return data as unknown as AutomationChannelOptions;
}
