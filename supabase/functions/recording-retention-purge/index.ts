import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  // ── Inbound Calling v2 — AgentFlow voicemail retention (P13) + durable source-cleanup retries ───────
  // Separate store, separate settings: `inbound_routing_settings.voicemail_retention_days` (DEFAULT 30)
  // applies to LISTENED voicemails; UNHEARD voicemails are kept up to VOICEMAIL_UNHEARD_MAX_DAYS. Every
  // step is additive and guarded so a missing M5/M7 object can never affect the recording purge above.
  const voicemail = await purgeVoicemails(supabase, now);
  const cleanup = await retryVoicemailSourceCleanup(supabase);

  return json({
    ok: true,
    orgs_processed: orgsProcessed,
    calls_cleared: rowsCleared,
    storage_objects_removed: storageObjectsRemoved,
    voicemails_purged: voicemail.purged,
    voicemail_objects_removed: voicemail.objectsRemoved,
    voicemail_orgs_processed: voicemail.orgs,
    voicemail_source_cleanups: cleanup.deleted,
    voicemail_source_cleanup_failures: cleanup.failed,
  });
});

const VOICEMAIL_UNHEARD_MAX_DAYS = 90;

// deno-lint-ignore no-explicit-any
async function purgeVoicemails(supabase: any, now: number): Promise<{ orgs: number; purged: number; objectsRemoved: number }> {
  const out = { orgs: 0, purged: 0, objectsRemoved: 0 };
  const { data: settings, error } = await supabase
    .from("inbound_routing_settings")
    .select("organization_id, voicemail_retention_days");
  if (error) {
    console.warn("[recording-retention-purge] voicemail settings unavailable (M5 not applied?) — voicemail pass skipped:", error.message);
    return out;
  }
  for (const row of (settings ?? []) as Array<{ organization_id: string | null; voicemail_retention_days: number | null }>) {
    const orgId = row.organization_id;
    const days = Number(row.voicemail_retention_days ?? 30);
    if (!orgId || !Number.isFinite(days) || days <= 0) continue;
    out.orgs += 1;
    const listenedCutoff = new Date(now - days * 86_400_000).toISOString();
    const unheardCutoff = new Date(now - VOICEMAIL_UNHEARD_MAX_DAYS * 86_400_000).toISOString();
    for (let round = 0; round < 25; round++) {
      const { data: batch, error: batchError } = await supabase.rpc("voicemails_expired_batch", {
        p_org_id: orgId, p_listened_cutoff: listenedCutoff, p_unheard_cutoff: unheardCutoff, p_limit: 200,
      });
      if (batchError) {
        console.error("[recording-retention-purge] voicemails_expired_batch:", orgId, batchError.message);
        break;
      }
      const expired = (batch ?? []) as { id: string; storage_path: string | null }[];
      if (expired.length === 0) break;
      const paths = expired.map((r) => r.storage_path).filter((p): p is string => !!p);
      if (paths.length) {
        const { error: removeError } = await supabase.storage.from("voicemails").remove(paths);
        if (removeError) {
          // objects stay; rows stay 'stored' so the next run retries — never mark purged without removal
          console.warn("[recording-retention-purge] voicemail storage remove:", orgId, removeError.message);
          break;
        }
        out.objectsRemoved += paths.length;
      }
      const { data: purged, error: purgeError } = await supabase.rpc("mark_voicemails_purged", { p_ids: expired.map((r) => r.id) });
      if (purgeError) {
        console.error("[recording-retention-purge] mark_voicemails_purged:", orgId, purgeError.message);
        break;
      }
      out.purged += Number(purged ?? 0);
    }
  }
  return out;
}

/**
 * Safeguard 3: a voicemail whose Twilio source could not be deleted after storage carries a durable
 * `source_cleanup_state='failed'` with backoff; this pass performs the deletion (2xx/404 = success)
 * and never touches media, metadata or notifications.
 */
// deno-lint-ignore no-explicit-any
async function retryVoicemailSourceCleanup(supabase: any): Promise<{ deleted: number; failed: number }> {
  const out = { deleted: 0, failed: 0 };
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) {
    console.warn("[recording-retention-purge] TWILIO credentials absent — voicemail source cleanup pass skipped");
    return out;
  }
  const { data: due, error } = await supabase.rpc("voicemails_cleanup_batch", { p_limit: 100 });
  if (error) {
    console.warn("[recording-retention-purge] voicemails_cleanup_batch unavailable — pass skipped:", error.message);
    return out;
  }
  for (const row of (due ?? []) as Array<{ id: string; recording_sid: string; provider_account_sid: string | null }>) {
    const sid = (row.recording_sid || "").trim();
    if (!/^RE[0-9a-fA-F]{32}$/.test(sid)) continue;
    const owner = (row.provider_account_sid || "").trim() || accountSid;
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${owner}/Recordings/${sid}`, {
        method: "DELETE", headers: { Authorization: "Basic " + btoa(`${accountSid}:${authToken}`) },
      });
      if (res.ok || res.status === 404) {
        await supabase.rpc("mark_voicemail_source_deleted", { p_recording_sid: sid });
        out.deleted += 1;
      } else {
        await supabase.rpc("record_voicemail_cleanup_failure", { p_recording_sid: sid, p_error: `delete HTTP ${res.status}` });
        out.failed += 1;
      }
    } catch (err) {
      await supabase.rpc("record_voicemail_cleanup_failure", { p_recording_sid: sid, p_error: err instanceof Error ? err.message : String(err) });
      out.failed += 1;
    }
  }
  return out;
}
