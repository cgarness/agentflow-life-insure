// GENERATED, DO NOT EDIT BY HAND.
//
// A faithful extraction of `retryVoicemailSourceCleanup` as it exists at commit 411faf4
// (supabase/functions/recording-retention-purge/index.ts, sha256
// c80e3a61a72750b7c42cd23c4c99347c399f5675cdd9a01bf82668c2cdeffb83). It exists so the corrective
// pass's regressions can be run against the PREVIOUS behaviour and shown to fail there.
//
// The ONLY edit is the credential prologue: the two `Deno.env.get(...)` reads become injected
// parameters so the function runs under vitest. Every line after that prologue is byte-identical to
// 411faf4 — the generator asserts this, and `npm run test` re-proves the tail on every run via
// recordingRetentionBaseline.test.ts.

export async function retryVoicemailSourceCleanup(
  supabase: any,
  accountSid: string | undefined,
  authToken: string | undefined,
): Promise<{ deleted: number; failed: number }> {
  const out = { deleted: 0, failed: 0 };
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
