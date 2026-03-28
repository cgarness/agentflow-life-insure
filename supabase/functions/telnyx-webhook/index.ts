// verify_jwt: false — Telnyx sends unsigned webhooks
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore
Deno.serve(async (req: Request) => {
  // CORS headers for preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const eventType = body?.data?.event_type;

    console.log('Telnyx webhook received:', eventType);

    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, body.data.payload);
        break;

      case 'call.answered':
        await handleCallAnswered(supabase, body.data.payload);
        break;

      case 'call.hangup':
        await handleCallHangup(supabase, body.data.payload);
        break;

      // Standard AMD
      case 'call.machine.detection.ended':
        await handleAMDResult(supabase, body.data.payload);
        break;

      // Premium AMD (more granular: human_residence, human_business, machine, silence, fax_detected)
      case 'call.machine.premium.detection.ended':
        await handlePremiumAMDResult(supabase, body.data.payload);
        break;

      case 'call.recording.saved':
        await handleRecordingSaved(supabase, body.data.payload);
        break;

      default:
        console.log('Unhandled event type:', eventType);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// ─── Helper: get Telnyx API key for a call ───
async function getTelnyxApiKey(supabase: any, organizationId?: string): Promise<string | null> {
  if (organizationId) {
    const { data } = await supabase
      .from('telnyx_settings')
      .select('api_key')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (data?.api_key) return data.api_key;
  }
  // Fallback to global
  const { data: global } = await supabase
    .from('telnyx_settings')
    .select('api_key')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  return global?.api_key || null;
}

// ─── Helper: hangup a call via Telnyx REST API ───
async function telnyxHangup(apiKey: string, callControlId: string): Promise<void> {
  try {
    const resp = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );
    if (!resp.ok) {
      console.error('Telnyx hangup failed:', resp.status, await resp.text());
    }
  } catch (err) {
    console.error('Telnyx hangup error:', err);
  }
}

// ─── Helper: check if AMD is enabled ───
async function isAmdEnabled(supabase: any, organizationId?: string): Promise<boolean> {
  try {
    let query = supabase.from('phone_settings').select('amd_enabled');
    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }
    const { data } = await query.limit(1).maybeSingle();
    return data?.amd_enabled === true;
  } catch {
    return false;
  }
}

// ─── Helper: get organization_id from a call record ───
async function getCallOrgId(supabase: any, callControlId: string): Promise<string | null> {
  const { data } = await supabase
    .from('calls')
    .select('organization_id')
    .eq('telnyx_call_id', callControlId)
    .maybeSingle();
  return data?.organization_id || null;
}

// Handler: call.initiated
async function handleCallInitiated(supabase: any, payload: any) {
  const clientState = payload.client_state;
  console.log('Call initiated:', {
    callControlId: payload.call_control_id,
    from: payload.from,
    to: payload.to,
    direction: payload.direction,
    clientState,
  });

  const callData: any = {
    telnyx_call_id: payload.call_control_id,
    direction: payload.direction,
    caller_id_used: payload.from,
    status: 'ringing',
    updated_at: new Date().toISOString(),
  };

  if (clientState) {
    // If clientState is provided, it's our internal call UUID
    const { error } = await supabase
      .from('calls')
      .update(callData)
      .eq('id', clientState);
    if (error) console.error('Error updating call with client_state:', error);
  } else {
    // Otherwise insert a new record
    const { error } = await supabase.from('calls').insert({
      ...callData,
      created_at: new Date().toISOString(),
    });
    if (error) console.error('Error creating call record:', error);
  }

  // ── Trigger AMD if enabled ──
  // After call is initiated, send AMD start command so detection begins
  // when the call is answered. Agent is already connected via WebRTC
  // so there's zero delay for human-answered calls.
  if (payload.direction === 'outbound') {
    const orgId = clientState
      ? (await getCallOrgId(supabase, payload.call_control_id)) || undefined
      : undefined;
    const amdEnabled = await isAmdEnabled(supabase, orgId);

    if (amdEnabled) {
      console.log('AMD enabled — triggering AMD start for call:', payload.call_control_id);
      try {
        // Invoke the telnyx-amd-start edge function
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const resp = await fetch(`${supabaseUrl}/functions/v1/telnyx-amd-start`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            call_control_id: payload.call_control_id,
            organization_id: orgId,
          }),
        });
        const result = await resp.json();
        console.log('AMD start result:', result);
      } catch (err) {
        console.error('Failed to trigger AMD start:', err);
      }
    }
  }
}

// Handler: call.answered
async function handleCallAnswered(supabase: any, payload: any) {
  console.log('Call answered:', payload.call_control_id);

  const { error } = await supabase
    .from('calls')
    .update({ status: 'connected' })
    .eq('telnyx_call_id', payload.call_control_id);

  if (error) {
    console.error('Error updating call to connected:', error);
  }
}

// Handler: call.hangup
async function handleCallHangup(supabase: any, payload: any) {
  const hangupCause = payload.hangup_cause || '';
  const duration = payload.end_time && payload.start_time
    ? Math.round((new Date(payload.end_time).getTime() - new Date(payload.start_time).getTime()) / 1000)
    : 0;
  const status = ['call_rejected', 'normal_clearing'].includes(hangupCause) ? 'completed' : 'failed';

  console.log('Call hangup:', {
    callControlId: payload.call_control_id,
    hangupCause,
    duration,
    status,
  });

  const { error } = await supabase
    .from('calls')
    .update({
      status,
      duration,
      hangup_details: hangupCause,
      updated_at: new Date().toISOString(),
    })
    .eq('telnyx_call_id', payload.call_control_id);

  if (error) {
    console.error('Error updating call on hangup:', error);
  }

  // Look up the call record to get contact_id, duration, disposition
  const { data: callRecord } = await supabase
    .from('calls')
    .select('contact_id, duration, disposition, direction, caller_id_used')
    .eq('telnyx_call_id', payload.call_control_id)
    .single();

  if (callRecord?.contact_id) {
    const durationFormatted = callRecord.duration
      ? `${Math.floor(callRecord.duration / 60)}m ${callRecord.duration % 60}s`
      : 'No answer';
    const directionLabel = callRecord.direction === 'inbound' ? 'Inbound' : 'Outbound';
    const dispositionLabel = callRecord.disposition
      ? ` — ${callRecord.disposition}`
      : '';

    await supabase.from('contact_activities').insert({
      contact_id: callRecord.contact_id,
      contact_type: 'lead',
      type: 'call',
      description: `${directionLabel} call — ${durationFormatted}${dispositionLabel}`,
      created_at: new Date().toISOString()
    });
  }
}

// Handler: call.machine.detection.ended (Standard AMD)
async function handleAMDResult(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const amdResult = payload.result; // 'human' | 'machine' | 'not_sure'

  console.log('AMD standard result:', { callControlId, amdResult });

  // Normalize: 'not_sure' → treat as 'human' (better to connect agent than skip a prospect)
  const normalizedResult = amdResult === 'not_sure' ? 'human' : amdResult;

  const { error } = await supabase
    .from('calls')
    .update({ amd_result: normalizedResult })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating AMD result:', error);
  }

  await handleMachineDetected(supabase, callControlId, normalizedResult);
}

// Handler: call.machine.premium.detection.ended (Premium AMD)
async function handlePremiumAMDResult(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const rawResult = payload.result;
  // Premium results: 'human_residence' | 'human_business' | 'machine' | 'silence' | 'fax_detected' | 'not_sure'

  console.log('AMD premium result:', { callControlId, rawResult });

  // Normalize to simple 'human' or 'machine'
  let normalizedResult: string;
  if (rawResult === 'human_residence' || rawResult === 'human_business' || rawResult === 'not_sure') {
    normalizedResult = 'human';
  } else {
    // machine, silence, fax_detected → all treated as "machine" (skip)
    normalizedResult = 'machine';
  }

  const { error } = await supabase
    .from('calls')
    .update({ amd_result: normalizedResult })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating premium AMD result:', error);
  }

  await handleMachineDetected(supabase, callControlId, normalizedResult);
}

// ─── Shared: handle machine detection ───
async function handleMachineDetected(supabase: any, callControlId: string, result: string) {
  if (result !== 'machine') return;

  // Check if AMD auto-action is enabled
  const orgId = await getCallOrgId(supabase, callControlId);
  const amdEnabled = await isAmdEnabled(supabase, orgId || undefined);

  if (!amdEnabled) {
    console.log('AMD detected machine but AMD auto-action is disabled');
    return;
  }

  console.log('Machine detected with AMD enabled — auto-hanging up and disposing as No Answer');

  // 1. Update call record with disposition and status
  await supabase
    .from('calls')
    .update({
      status: 'completed',
      amd_result: 'machine',
      disposition_name: 'No Answer',
      updated_at: new Date().toISOString(),
    })
    .eq('telnyx_call_id', callControlId);

  // 2. Auto-hangup via Telnyx REST API (server-side hangup — agent never needs to act)
  const apiKey = await getTelnyxApiKey(supabase, orgId || undefined);
  if (apiKey) {
    await telnyxHangup(apiKey, callControlId);
  } else {
    console.warn('Cannot auto-hangup: no API key found');
  }
}

// Handler: call.recording.saved
async function handleRecordingSaved(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const recordingUrl = payload.recording_urls?.mp3 || payload.recording_urls?.wav || null;

  console.log('Recording saved:', { callControlId, recordingUrl });

  if (recordingUrl) {
    const { error } = await supabase
      .from('calls')
      .update({ recording_url: recordingUrl })
      .eq('telnyx_call_id', callControlId);

    if (error) {
      console.error('Error saving recording URL:', error);
    }
  }
}
