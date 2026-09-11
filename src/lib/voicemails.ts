/**
 * Inbound Calling v2 — AgentFlow voicemail access (implementation_plan.md rev 3 §10, P3).
 * Rows are visible only through the `voicemails_select` policy (recipient, group members, org Admins,
 * super admins); objects in the PRIVATE `voicemails` bucket are readable only through the mirrored
 * storage policy. The browser never writes anything but `listened_at` (column-scoped grant).
 */
// The client is imported lazily: this module is reached from presentational components (notification
// rows, history items) whose tests never construct a Supabase client.
async function client() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

export interface VoicemailRow {
  id: string;
  call_id: string;
  organization_id: string;
  recipient_kind: "agent" | "group" | string;
  recipient_agent_id: string | null;
  storage_bucket: string;
  storage_path: string | null;
  duration_seconds: number | null;
  status: string;
  listened_at: string | null;
  created_at: string;
}

export async function fetchVoicemail(voicemailId: string): Promise<VoicemailRow | null> {
  const supabase = await client();
  const { data, error } = await supabase
    .from("voicemails")
    .select("id, call_id, organization_id, recipient_kind, recipient_agent_id, storage_bucket, storage_path, duration_seconds, status, listened_at, created_at")
    .eq("id", voicemailId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VoicemailRow | null) ?? null;
}

/** Short-lived signed URL for the private object (the storage policy re-checks can_access_voicemail). */
export async function getVoicemailPlaybackUrl(row: VoicemailRow): Promise<string | null> {
  if (!row.storage_path || row.status !== "stored") return null;
  const supabase = await client();
  const { data, error } = await supabase.storage.from(row.storage_bucket || "voicemails").createSignedUrl(row.storage_path, 300);
  if (error) throw new Error(error.message);
  return data?.signedUrl ?? null;
}

/** The ONLY browser write on voicemails: listened_at (first listen wins; idempotent). */
export async function markVoicemailListened(voicemailId: string): Promise<void> {
  const supabase = await client();
  const { error } = await supabase
    .from("voicemails")
    .update({ listened_at: new Date().toISOString() })
    .eq("id", voicemailId)
    .is("listened_at", null);
  if (error) throw new Error(error.message);
}

export function formatVoicemailDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds ?? 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
