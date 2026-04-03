import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── CORS ────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Telnyx Typed Wrapper ────────────────────────────────────────────────────
// Types that mirror the Telnyx v2 REST API for outbound calls.

interface TelnyxCallRequest {
  to: string;
  from: string;
  connection_id: string;
  answering_machine_detection: 'premium' | 'detect' | 'detect_beep' | 'detect_words' | 'greeting_end' | 'disabled';
  client_state: string;
  webhook_url: string;
}

interface TelnyxCallResponse {
  data: {
    call_control_id: string;
    call_leg_id: string;
    call_session_id: string;
    is_alive: boolean;
    record_type: string;
  };
}

interface TelnyxErrorDetail {
  code: string;
  title: string;
  detail: string;
}

interface TelnyxErrorResponse {
  errors: TelnyxErrorDetail[];
}

class TelnyxApiError extends Error {
  public readonly statusCode: number;
  public readonly telnyxErrors: TelnyxErrorDetail[];

  constructor(statusCode: number, errors: TelnyxErrorDetail[]) {
    const detail = errors[0]?.detail || `Telnyx API error: ${statusCode}`;
    super(detail);
    this.name = 'TelnyxApiError';
    this.statusCode = statusCode;
    this.telnyxErrors = errors;
  }
}

/**
 * Creates an outbound call via the Telnyx v2 REST API.
 *
 * @param apiKey – Telnyx API key (Bearer token), pulled from DB settings.
 * @param payload – Typed call request payload.
 * @returns The call_control_id from Telnyx.
 */
async function telnyxCreateCall(apiKey: string, payload: TelnyxCallRequest): Promise<string> {
  const response = await fetch('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ errors: [] })) as TelnyxErrorResponse;
    throw new TelnyxApiError(response.status, body.errors || []);
  }

  const body = await response.json() as TelnyxCallResponse;
  return body.data.call_control_id;
}

// ─── Edge Function Handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── JWT Auth Guard ───────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || supabaseServiceKey;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: invalid or expired token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    console.log(`[dialer-start-call] Authenticated user: ${callerUser.id}`);

    // ── Parse & Validate Request Body ────────────────────────────────────────
    const body = await req.json();
    const { destination_number, caller_id, agent_id, call_id, organization_id } = body;

    const missingParams: string[] = [];
    if (!destination_number) missingParams.push('destination_number');
    if (!caller_id) missingParams.push('caller_id');
    if (!agent_id) missingParams.push('agent_id');
    if (!call_id) missingParams.push('call_id');
    if (!organization_id) missingParams.push('organization_id');

    if (missingParams.length > 0) {
      return new Response(JSON.stringify({ error: `Missing required parameters: ${missingParams.join(', ')}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    console.log(`[dialer-start-call] Call ${call_id}: ${caller_id} → ${destination_number} (agent: ${agent_id}, org: ${organization_id})`);

    // ── 1. Fetch Telnyx Settings (org-scoped with platform fallback) ─────────
    let { data: settings, error: settingsError } = await supabase
      .from('telnyx_settings')
      .select('api_key, connection_id')
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (!settings && !settingsError) {
      console.log(`[dialer-start-call] No org settings for ${organization_id}, trying platform defaults...`);
      const { data: defaultSettings, error: defaultError } = await supabase
        .from('telnyx_settings')
        .select('api_key, connection_id')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .maybeSingle();

      if (defaultSettings) {
        settings = defaultSettings;
        settingsError = defaultError;
      }
    }

    if (settingsError || !settings?.api_key || !settings?.connection_id) {
      throw new Error(
        `Telnyx settings incomplete for organization ${organization_id}. ` +
        `Requires api_key and connection_id.`
      );
    }

    // ── 2. Create Outbound Call via Telnyx ───────────────────────────────────
    const callControlId = await telnyxCreateCall(settings.api_key, {
      to: destination_number,
      from: caller_id,
      connection_id: settings.connection_id,
      answering_machine_detection: 'premium',
      client_state: btoa(call_id),
      webhook_url: `${supabaseUrl}/functions/v1/telnyx-webhook`,
    });

    console.log(`[dialer-start-call] Telnyx call created. Control ID: ${callControlId}`);

    // ── 3. Update Call Record ────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('calls')
      .update({
        telnyx_call_control_id: callControlId,
        status: 'ringing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', call_id);

    if (updateError) {
      console.error(`[dialer-start-call] Failed to update call record ${call_id}:`, updateError);
    }

    return new Response(JSON.stringify({ success: true, call_control_id: callControlId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = error instanceof TelnyxApiError ? error.statusCode : 400;
    console.error('[dialer-start-call] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  }
});
