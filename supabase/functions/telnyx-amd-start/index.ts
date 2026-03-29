// Trigger Answering Machine Detection on an active call via Telnyx REST API
// Called by the telnyx-webhook handler when a call is initiated and AMD is enabled
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { call_control_id, organization_id } = await req.json();

    if (!call_control_id) {
      return new Response(
        JSON.stringify({ error: 'call_control_id is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch API key from telnyx_settings
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let apiKey: string | null = null;

    // Try org-specific settings first
    if (organization_id) {
      const { data: orgSettings } = await supabase
        .from('telnyx_settings')
        .select('api_key')
        .eq('organization_id', organization_id)
        .maybeSingle();
      apiKey = orgSettings?.api_key || null;
    }

    // Fallback to global settings
    if (!apiKey) {
      const { data: globalSettings } = await supabase
        .from('telnyx_settings')
        .select('api_key')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .maybeSingle();
      apiKey = globalSettings?.api_key || null;
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No Telnyx API key configured' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Send AMD start command to Telnyx
    // Uses the Call Control "answering_machine_detection" action on an existing call
    const telnyxResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/answering_machine_detection`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // "premium" uses ML-based detection for higher accuracy
          // "detect" is faster but less accurate
          answering_machine_detection: 'premium',
        }),
      }
    );

    if (!telnyxResponse.ok) {
      const errorBody = await telnyxResponse.text();
      console.error('Telnyx AMD start failed:', telnyxResponse.status, errorBody);

      // If the endpoint doesn't exist (404), AMD may need to be configured
      // at the connection level instead. Log but don't crash.
      if (telnyxResponse.status === 404 || telnyxResponse.status === 422) {
        console.warn(
          'AMD action endpoint not available. AMD may need to be configured on the Telnyx Connection/Application directly.'
        );
        return new Response(
          JSON.stringify({
            success: false,
            fallback: true,
            message: 'AMD action not available on this call. Configure AMD on your Telnyx Connection.',
          }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Telnyx API error: ${telnyxResponse.status}`, details: errorBody }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const result = await telnyxResponse.json();
    console.log('AMD started successfully for call:', call_control_id);

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AMD start error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
