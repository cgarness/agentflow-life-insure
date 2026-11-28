import { supabase } from "@/integrations/supabase/client";

export interface EmailSender {
  id: string;
  from_email: string;
  reply_to: string;
}

/** Verified agency email senders. Saved messages come from `automationApi.savedMessages`. */
export interface AutomationChannelOptions {
  moreSenders: boolean;
  senders: EmailSender[];
}

interface ChannelQuery {
  search?: string;
  offset?: number;
  senderId?: string;
  type?: "sms" | "email";
}

export async function getAutomationChannelOptions(
  input: ChannelQuery = {},
): Promise<AutomationChannelOptions> {
  const { data, error } = await supabase.rpc("automation_channel_options", {
    p_search: input.search,
    p_offset: input.offset,
    p_sender_id: input.senderId,
    p_type: input.type,
  });
  if (error) throw error;
  return data as unknown as AutomationChannelOptions;
}
