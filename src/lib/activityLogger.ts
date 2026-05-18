import { supabase } from "@/integrations/supabase/client";

export type ActivityCategory =
  | "user_management"
  | "contacts"
  | "campaigns"
  | "telephony"
  | "settings"
  | "system";

export interface LogActivityInput {
  action: string;
  category: ActivityCategory;
  organizationId: string;
  userId?: string;
  userName?: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const { error } = await supabase.from("activity_logs").insert({
      action: input.action,
      category: input.category,
      organization_id: input.organizationId,
      user_id: input.userId ?? null,
      user_name: input.userName ?? null,
      metadata: (input.metadata ?? {}) as never,
    });
    if (error) {
      console.error("[ActivityLogger]", error.message);
    }
  } catch (e) {
    console.error("[ActivityLogger]", e);
  }
}
