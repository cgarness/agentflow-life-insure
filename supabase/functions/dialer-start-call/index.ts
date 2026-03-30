import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { destination_number, caller_id, agent_id, call_id, organization_id } = body;

    console.log(`[dialer-start-call] Received outbound request for Call ID: ${call_id}`, { 
      destination: destination_number, 
      from: caller_id, 
      agent: agent_id, 
      org: organization_id 
    });

    const missingParams = [];
    if (!destination_number) missingParams.push('destination_number');
    if (!caller_id) missingParams.push('caller_id');
    if (!agent_id) missingParams.push('agent_id');
    if (!call_id) missingParams.push('call_id');
    if (!organization_id) missingParams.push('organization_id');

    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    console.log(`[dialer-start-call] Initiating call from ${caller_id} to ${destination_number} for agent ${agent_id}`);

    // 1. Fetch Telnyx Settings for Organization (with fallback to platform default)
    let { data: settings, error: settingsError } = await supabase
      .from('telnyx_settings')
      .select('api_key, connection_id')
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (!settings && !settingsError) {
      console.log(`[dialer-start-call] Settings NOT found for org ${organization_id}. Trying platform defaults...`);
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
      throw new Error(`Telnyx settings not found or incomplete for organization ${organization_id} or platform defaults.`);
    }

    // 2. Prepare Telnyx REST API Call
    // We use Premium AMD to ensure we only bridge to the agent when a human is detected.
    const telnyxPayload = {
      to: destination_number,
      from: caller_id,
      connection_id: settings.connection_id,
      answering_machine_detection: 'premium',
      // client_state is typically used for tracking. We'll store the call_id here.
      // Telnyx expects a string; we'll base64 encode the UUID to be safe and standard.
      client_state: btoa(call_id),
      // Ensure the control leg sends events to our main webhook
      webhook_url: `${supabaseUrl}/functions/v1/telnyx-webhook`,
    };

    console.log(`[dialer-start-call] Calling Telnyx API with payload (UUID: ${call_id}):`, JSON.stringify(telnyxPayload, null, 2));
    const telnyxResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telnyxPayload),
    });

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.json().catch(() => ({}));
      console.error(`[dialer-start-call] Telnyx API error [${telnyxResponse.status}]:`, JSON.stringify(errorData, null, 2));
      throw new Error(errorData.errors?.[0]?.detail || `Telnyx API error: ${telnyxResponse.status}`);
    }

    const telnyxData = await telnyxResponse.json();
    const callControlId = telnyxData.data.call_control_id;

    console.log(`[dialer-start-call] Call authorized by Telnyx. Control ID: ${callControlId}`);

    // 3. Update Call Record in DB with the control ID
    const { error: updateError } = await supabase
      .from('calls')
      .update({
        telnyx_call_control_id: callControlId,
        status: 'ringing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', call_id);

    if (updateError) {
      console.error(`[dialer-start-call] Error updating call record ${call_id}:`, updateError);
    }

    return new Response(JSON.stringify({ success: true, call_control_id: callControlId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('[dialer-start-call] Critical Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
