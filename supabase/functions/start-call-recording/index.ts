import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResp({ error: 'Missing authorization' }, 401);
  }

  const anon = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400);
  }

  const { call_id, call_control_id, call_session_id } = body || {};
  if (!call_id) {
    return jsonResp({ error: 'call_id required' }, 400);
  }

  console.log(`[start-call-recording] Starting for call_id=${call_id}, provided call_control_id=${call_control_id || 'none'}`);

  const svc = createClient(supabaseUrl, serviceKey);

  // Read the call row to get org + phone info
  const { data: callRow, error: readErr } = await svc
    .from('calls')
    .select('organization_id, contact_phone, telnyx_call_control_id')
    .eq('id', call_id)
    .maybeSingle();

  if (readErr) {
    console.error(`[start-call-recording] Failed to read call ${call_id}:`, readErr);
  }

  const orgId = callRow?.organization_id || user.app_metadata?.organization_id;

  // Get Telnyx API key + connection_id
  let apiKey: string | null = null;
  let connectionId: string | null = null;
  if (orgId) {
    const { data } = await svc.from('telnyx_settings').select('api_key, connection_id').eq('organization_id', orgId).maybeSingle();
    if (data) {
      apiKey = data.api_key;
      connectionId = data.connection_id;
    }
  }
  if (!apiKey) {
    const { data } = await svc.from('telnyx_settings').select('api_key, connection_id').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle();
    apiKey = data?.api_key || null;
    connectionId = connectionId || data?.connection_id || null;
  }

  if (!apiKey) {
    return jsonResp({ error: 'No Telnyx API key' });
  }

  // Check if recording is enabled
  let recordingEnabled = true;
  try {
    const table = 'phone_settings';
    const { data: ps } = orgId
      ? await svc.from(table).select('recording_enabled').eq('organization_id', orgId).maybeSingle()
      : await svc.from(table).select('recording_enabled').limit(1).maybeSingle();
    if (ps && ps.recording_enabled === false) recordingEnabled = false;
  } catch { /* default enabled */ }

  if (!recordingEnabled) {
    return jsonResp({ recording: false, reason: 'disabled' });
  }

  // Resolve the call_control_id — use provided, then DB, then Telnyx API lookup
  let resolvedControlId = call_control_id || callRow?.telnyx_call_control_id || null;

  if (!resolvedControlId && connectionId) {
    console.log(`[start-call-recording] No call_control_id — looking up via Telnyx API, connection_id=${connectionId}`);
    resolvedControlId = await lookupCallControlId(apiKey, connectionId, callRow?.contact_phone);
  }

  if (!resolvedControlId) {
    console.error(`[start-call-recording] Could not determine call_control_id for call ${call_id}`);
    return jsonResp({ recording: false, reason: 'no_call_control_id' });
  }

  console.log(`[start-call-recording] Resolved call_control_id=${resolvedControlId}`);

  // Save the IDs to DB
  const patch: Record<string, unknown> = {
    telnyx_call_control_id: resolvedControlId,
    status: 'connected',
    updated_at: new Date().toISOString(),
  };
  if (call_session_id) patch.telnyx_call_id = call_session_id;

  const { error: updateErr } = await svc
    .from('calls')
    .update(patch)
    .eq('id', call_id);

  if (updateErr) {
    console.error(`[start-call-recording] DB update failed for ${call_id}:`, updateErr);
  }

  // Start recording via Telnyx Call Control API
  try {
    const url = `https://api.telnyx.com/v2/calls/${resolvedControlId}/actions/record_start`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'mp3', channels: 'dual', play_beep: false }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[start-call-recording] record_start failed (${resp.status}):`, errText);
      return jsonResp({ recording: false, reason: 'record_start_failed', status: resp.status, ids_saved: true });
    }

    console.log(`[start-call-recording] Recording started for call ${call_id} / ${resolvedControlId}`);

    await svc.from('calls').update({ recording_url: '__recording_pending__' } as any).eq('id', call_id);

    return jsonResp({ recording: true, ids_saved: true, call_control_id: resolvedControlId });
  } catch (err) {
    console.error('[start-call-recording] Exception:', err);
    return jsonResp({ recording: false, reason: 'exception', ids_saved: true });
  }
});

/**
 * Look up the call_control_id for an active call on a given connection.
 * Uses Telnyx's list-calls API filtered by connection_id, then matches
 * by the destination phone number.
 */
async function lookupCallControlId(
  apiKey: string,
  connectionId: string,
  contactPhone?: string | null
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ 'filter[connection_id]': connectionId });
    const url = `https://api.telnyx.com/v2/calls?${params}`;
    console.log(`[start-call-recording] Fetching active calls: ${url}`);

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!resp.ok) {
      console.error(`[start-call-recording] List calls failed (${resp.status}):`, await resp.text());
      return null;
    }

    const json = await resp.json();
    const activeCalls: any[] = json?.data || [];
    console.log(`[start-call-recording] Found ${activeCalls.length} active call(s) on connection`);

    if (activeCalls.length === 0) return null;

    // Try to match by phone number
    if (contactPhone) {
      const normalized = contactPhone.replace(/\D/g, '');
      const match = activeCalls.find((c: any) => {
        const to = (c.to || '').replace(/\D/g, '');
        return to === normalized || to.endsWith(normalized) || normalized.endsWith(to);
      });
      if (match) {
        console.log(`[start-call-recording] Matched by phone number: ${match.call_control_id}`);
        return match.call_control_id;
      }
    }

    // If only one active call, use it
    if (activeCalls.length === 1) {
      console.log(`[start-call-recording] Only one active call — using: ${activeCalls[0].call_control_id}`);
      return activeCalls[0].call_control_id;
    }

    // Multiple calls, no phone match — take most recent
    console.log(`[start-call-recording] Multiple active calls, no phone match — using first`);
    return activeCalls[0].call_control_id;
  } catch (err) {
    console.error('[start-call-recording] lookupCallControlId exception:', err);
    return null;
  }
}
