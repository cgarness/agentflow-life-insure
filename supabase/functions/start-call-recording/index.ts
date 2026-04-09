import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const anon = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { call_id, call_control_id, call_session_id } = body || {};
  if (!call_id || !call_control_id) {
    return new Response(JSON.stringify({ error: 'call_id and call_control_id required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const svc = createClient(supabaseUrl, serviceKey);

  // Update the calls row with the Telnyx IDs the SDK gave us
  const patch: Record<string, unknown> = {
    telnyx_call_control_id: call_control_id,
    status: 'connected',
    updated_at: new Date().toISOString(),
  };
  if (call_session_id) patch.telnyx_call_id = call_session_id;

  const { data: callRow, error: updateErr } = await svc
    .from('calls')
    .update(patch)
    .eq('id', call_id)
    .select('organization_id')
    .maybeSingle();

  if (updateErr) {
    console.error(`[start-call-recording] DB update failed for ${call_id}:`, updateErr);
  }

  const orgId = callRow?.organization_id || user.app_metadata?.organization_id;

  // Get Telnyx API key
  let apiKey: string | null = null;
  if (orgId) {
    const { data } = await svc.from('telnyx_settings').select('api_key').eq('organization_id', orgId).maybeSingle();
    if (data?.api_key) apiKey = data.api_key;
  }
  if (!apiKey) {
    const { data } = await svc.from('telnyx_settings').select('api_key').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle();
    apiKey = data?.api_key || null;
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No Telnyx API key', ids_saved: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
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
    return new Response(JSON.stringify({ recording: false, reason: 'disabled', ids_saved: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Start recording via Telnyx Call Control API
  try {
    const url = `https://api.telnyx.com/v2/calls/${call_control_id}/actions/record_start`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'mp3', channels: 'dual', play_beep: false }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[start-call-recording] record_start failed (${resp.status}):`, errText);
      return new Response(JSON.stringify({ recording: false, reason: 'record_start_failed', status: resp.status, ids_saved: true }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[start-call-recording] Recording started for call ${call_id} / ${call_control_id}`);

    // Mark in DB that recording was started
    await svc.from('calls').update({ recording_url: '__recording_pending__' } as any).eq('id', call_id);

    return new Response(JSON.stringify({ recording: true, ids_saved: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[start-call-recording] Exception:', err);
    return new Response(JSON.stringify({ recording: false, reason: 'exception', ids_saved: true }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
