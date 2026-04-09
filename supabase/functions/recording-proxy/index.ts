import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Authenticate the caller via their JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const userOrgId = user.app_metadata?.organization_id;

  let callId: string | null = null;
  try {
    const body = await req.json();
    callId = body.call_id;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!callId) {
    return new Response(JSON.stringify({ error: 'call_id required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  // Look up the call row
  const { data: callRow, error: callErr } = await serviceClient
    .from('calls')
    .select('id, telnyx_call_control_id, organization_id, recording_url')
    .eq('id', callId)
    .maybeSingle();

  if (callErr || !callRow) {
    return new Response(JSON.stringify({ error: 'Call not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Org-level access check
  if (callRow.organization_id && userOrgId && callRow.organization_id !== userOrgId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Get Telnyx API key for the org
  const apiKey = await getTelnyxApiKey(serviceClient, callRow.organization_id);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Telnyx API key not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Strategy 1: use call_control_id to list recordings from Telnyx API
  const controlId = callRow.telnyx_call_control_id;
  if (!controlId) {
    return new Response(JSON.stringify({ error: 'No Telnyx call control ID on record' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const listUrl = `https://api.telnyx.com/v2/recordings?filter[call_control_id]=${encodeURIComponent(controlId)}`;
    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!listResp.ok) {
      console.error(`Telnyx recordings list failed: ${listResp.status}`);
      return new Response(JSON.stringify({ error: 'Failed to list recordings from Telnyx' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const listBody = await listResp.json();
    const recordings = listBody?.data;
    if (!recordings || recordings.length === 0) {
      return new Response(JSON.stringify({ error: 'No recordings found for this call' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Pick the first recording's download URL
    const rec = recordings[0];
    const downloadUrl =
      rec?.download_urls?.mp3 ||
      rec?.download_urls?.wav ||
      rec?.recording_urls?.mp3 ||
      rec?.recording_urls?.wav ||
      null;

    if (!downloadUrl) {
      console.error('Recording found but no download URL:', JSON.stringify(rec));
      return new Response(JSON.stringify({ error: 'Recording has no download URL' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the actual audio binary from Telnyx
    const audioResp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!audioResp.ok) {
      // Download URLs from the recordings API may be pre-signed (no auth needed) — retry without
      const retryResp = await fetch(downloadUrl);
      if (!retryResp.ok) {
        console.error(`Audio download failed: ${audioResp.status} / retry ${retryResp.status}`);
        return new Response(JSON.stringify({ error: 'Failed to download recording audio' }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      const audioBody = await retryResp.arrayBuffer();
      return new Response(audioBody, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(audioBody.byteLength),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    const audioBody = await audioResp.arrayBuffer();
    return new Response(audioBody, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBody.byteLength),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('Recording proxy error:', err);
    return new Response(JSON.stringify({ error: 'Internal error fetching recording' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

async function getTelnyxApiKey(supabase: any, organizationId?: string | null): Promise<string | null> {
  if (organizationId) {
    const { data, error } = await supabase
      .from('telnyx_settings')
      .select('api_key')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!error && data?.api_key) return data.api_key;
  }
  const { data: global } = await supabase
    .from('telnyx_settings')
    .select('api_key')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  return global?.api_key || null;
}
