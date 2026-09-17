import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runVoicemailPhases, type VoicemailDeps } from "./voicemail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  // Invocation clock, captured BEFORE any await. The voicemail phases' admission limit is measured
  // from here, so a slow first read cannot be spent invisibly: previously this was taken after the
  // phone_settings query, and a 120 s read still admitted new voicemail work.
  const invocationStartMs = Date.now();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const requiredCronSecret = Deno.env.get("RECORDING_RETENTION_CRON_SECRET");
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (!requiredCronSecret || cronSecret !== requiredCronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase configuration" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: orgSettings, error: settingsError } = await supabase
    .from("phone_settings")
    .select("organization_id, recording_retention_days")
    .gt("recording_retention_days", 0);

  if (settingsError) {
    console.error("[recording-retention-purge] phone_settings:", settingsError.message);
    return json({ error: settingsError.message }, 500);
  }

  // Retention cutoff anchor — deliberately SEPARATE from the invocation clock and left exactly
  // where it was, so the conversation-recording pass below is unchanged.
  const now = Date.now();
  let orgsProcessed = 0;
  let rowsCleared = 0;
  let storageObjectsRemoved = 0;

  for (const row of orgSettings ?? []) {
    const orgId = row.organization_id as string | null;
    const days = Number(row.recording_retention_days);
    if (!orgId || !Number.isFinite(days) || days <= 0) continue;

    orgsProcessed += 1;
    const cutoff = new Date(now - days * 86_400_000).toISOString();

    for (let round = 0; round < 25; round++) {
      const { data: batch, error: batchError } = await supabase.rpc("calls_expired_recording_batch", {
        p_organization_id: orgId,
        p_cutoff: cutoff,
        p_limit: 200,
      });

      if (batchError) {
        console.error("[recording-retention-purge] batch RPC:", orgId, batchError.message);
        break;
      }

      const expired = (batch ?? []) as { id: string; recording_storage_path: string }[];
      if (expired.length === 0) break;

      const paths = expired.map((r) => r.recording_storage_path).filter(Boolean);
      if (paths.length) {
        const { error: removeError } = await supabase.storage.from("call-recordings").remove(paths);
        if (removeError) {
          console.warn("[recording-retention-purge] storage remove:", orgId, removeError.message);
        } else {
          storageObjectsRemoved += paths.length;
        }
      }

      const ids = expired.map((r) => r.id);
      const { error: updateError } = await supabase
        .from("calls")
        .update({
          recording_storage_path: null,
          recording_url: null,
          recording_duration: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", ids);

      if (updateError) {
        console.error("[recording-retention-purge] calls update:", orgId, updateError.message);
        break;
      }

      rowsCleared += ids.length;
    }
  }

  // ── Inbound Calling v2 — AgentFlow voicemail phases (P13 retention + safeguard-3 source cleanup) ──
  // Both phases live in ./voicemail.ts so they are unit-tested without Deno, and neither ever rejects:
  // a failure surfaces as an explicit phase status, so a voicemail problem can never turn this
  // handler's 200 into a 500 or disturb the conversation-recording purge above. `now` is the same
  // anchor the recording pass used — reusing it can only keep a voicemail marginally longer, never
  // purge one early.
  const voicemail = await runVoicemailPhases(buildVoicemailDeps(supabase, now, invocationStartMs));

  return json({
    ok: true,
    orgs_processed: orgsProcessed,
    calls_cleared: rowsCleared,
    storage_objects_removed: storageObjectsRemoved,
    ...voicemail,
  });
});

/**
 * Deno/Supabase wiring for the voicemail phases. Every provider request is cancellable; every
 * database call is a thin pass-through whose `{data,error}` the helper bounds and inspects.
 */
// deno-lint-ignore no-explicit-any
function buildVoicemailDeps(supabase: any, retentionAnchorMs: number, invocationStartMs: number): VoicemailDeps {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

  return {
    nowMs: () => Date.now(),
    invocationStartMs,
    retentionAnchorMs,

    listRoutingSettings: () =>
      supabase.from("inbound_routing_settings").select("organization_id, voicemail_retention_days"),
    expiredBatch: ({ orgId, listenedCutoff, unheardCutoff, limit }) =>
      supabase.rpc("voicemails_expired_batch", {
        p_org_id: orgId, p_listened_cutoff: listenedCutoff, p_unheard_cutoff: unheardCutoff, p_limit: limit,
      }),
    removeObjects: (paths) => supabase.storage.from("voicemails").remove(paths),
    markPurged: (ids) => supabase.rpc("mark_voicemails_purged", { p_ids: ids }),

    credentials: () => (accountSid && authToken ? { accountSid, authToken } : null),
    // M8. `voicemails_cleanup_batch` (M7) is deliberately NOT called any more: it returned rows whose
    // owning provider account cannot be established, and an arbitrary prefix of those hid every
    // actionable row behind it. It is still installed, so the previously deployed worker keeps working
    // and M8 can be applied before this code ships.
    cleanupActionableBatch: (limit) => supabase.rpc("voicemails_cleanup_actionable_batch", { p_limit: limit }),
    cleanupBlockedSummary: (scanLimit) => supabase.rpc("voicemails_cleanup_blocked_summary", { p_scan_limit: scanLimit }),
    deleteProviderRecording: async ({ ownerAccountSid, recordingSid, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${ownerAccountSid}/Recordings/${recordingSid}`,
          {
            method: "DELETE",
            headers: { Authorization: "Basic " + btoa(`${accountSid}:${authToken}`) },
            signal: controller.signal,
          },
        );
        // Drain the body so Deno can release the connection: at concurrency 5 across up to 1000 rows
        // an unread response body would leak a resource per row.
        try { await res.body?.cancel(); } catch { /* already closed */ }
        return { kind: "status", status: res.status };
      } catch (err) {
        if (controller.signal.aborted) return { kind: "timeout", message: `aborted after ${timeoutMs} ms` };
        return { kind: "network", message: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    },
    markSourceDeleted: (sid) => supabase.rpc("mark_voicemail_source_deleted", { p_recording_sid: sid }),
    recordCleanupFailure: (sid, error) =>
      supabase.rpc("record_voicemail_cleanup_failure", { p_recording_sid: sid, p_error: error }),
    readCleanupState: (sid) =>
      supabase.from("voicemails").select("source_cleanup_state").eq("recording_sid", sid).maybeSingle(),

    log: (level, message, detail) => {
      const line = `[recording-retention-purge] ${message}`;
      if (level === "error") console.error(line, detail ?? "");
      else if (level === "warn") console.warn(line, detail ?? "");
      else console.log(line, detail ?? "");
    },
  };
}
