import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Every persistence RPC rechecks under database locks. This network preflight
// prevents starting work after deletion, but cannot recall a dispatched send.
export async function checkGoogleMailbox(admin: SupabaseClient, connectionId: string, generation: string) {
  const { data, error } = await admin.rpc("check_google_mailbox", { p_connection: connectionId, p_generation: generation });
  if (error || data !== true) throw new Error("Google connection is unavailable or a deletion request is in progress.");
}
