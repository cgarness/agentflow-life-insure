import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pendingSmsStore } from "./pendingSmsStore";
import { createManualSmsSender } from "./sendManualSms";
import { CANONICAL_SMS_COLUMNS } from "./smsSendResult";

/** Set `localStorage['af:debug:sms-timing'] = '1'` to record `af-sms:<localId>:<phase>` marks. */
const TIMING_FLAG = "af:debug:sms-timing";

function timingEnabled(): boolean {
  try {
    return localStorage.getItem(TIMING_FLAG) === "1";
  } catch {
    return false;
  }
}

/** The app's one manual-SMS sender, shared by Conversations and the contact record. */
export const manualSmsSender = createManualSmsSender({
  store: pendingSmsStore,
  getSession: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    return session?.access_token && session.user?.id
      ? { accessToken: session.access_token, userId: session.user.id }
      : null;
  },
  post: async (body, accessToken, signal) => {
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/twilio-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal,
    });
    return { status: res.status, text: await res.text() };
  },
  readRow: async (messageId, organizationId) => {
    const { data, error } = await supabase
      .from("messages")
      .select(CANONICAL_SMS_COLUMNS)
      .eq("id", messageId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new Error("Saved message unavailable");
    return data;
  },
  notify: {
    error: (message) => toast.error(message),
    warning: (message) => toast.warning(message),
  },
  mark: (localId, phase) => {
    if (timingEnabled()) performance.mark(`af-sms:${localId}:${phase}`);
  },
});
