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

  return json({
    ok: true,
    orgs_processed: orgsProcessed,
    calls_cleared: rowsCleared,
    storage_objects_removed: storageObjectsRemoved,
  });
});
