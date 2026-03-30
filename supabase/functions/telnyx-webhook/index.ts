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

      // Greeting detection (often indicates machine voicemail box ready)
      case 'call.machine.greeting.ended':
      case 'call.machine.premium.greeting.ended':
        await handleGreetingEnded(supabase, body.data.payload);
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

// ─── Helper: start AMD via Telnyx REST API ───
async function telnyxStartAmd(apiKey: string, callControlId: string): Promise<void> {
  try {
    const resp = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answering_machine_detection`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          total_analysis_time_millis: 15000,
          initial_silence_millis: 3500,
          greeting_silence_millis: 2000,
          silence_after_greeting_millis: 1500,
          // Premium AMD results: 'human_residence' | 'human_business' | 'machine' | 'silence' | 'fax_detected' | 'not_sure'
          // We stick to standard parameters to avoid false positives as requested.
        }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Telnyx AMD start failed:', resp.status, errText);
    }
  } catch (err) {
    console.error('Telnyx AMD start error:', err);
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
async function getCallOrgId(supabase: any, callSessionId: string): Promise<string | null> {
  // We search for ANY record with this session ID that has an organization_id.
  // This ensures that even if one leg (e.g. PSTN) is missing the client_state,
  // we can still find the org context from the other leg (e.g. WebRTC).
  const { data } = await supabase
    .from('calls')
    .select('organization_id')
    .eq('telnyx_call_id', callSessionId)
    .not('organization_id', 'is', null)
    .maybeSingle();
    
  return data?.organization_id || null;
}

// Handler: call.initiated
async function handleCallInitiated(supabase: any, payload: any) {
  const rawClientState = payload.client_state;

  // TelnyxRTC SDK base64-encodes the clientState before sending to Telnyx.
  // We must decode it to recover the original UUID we passed from the frontend.
  let decodedClientState: string | null = null;
  if (rawClientState) {
    try {
      // Telnyx standardizes client_state as base64
      decodedClientState = new TextDecoder().decode(
        Uint8Array.from(atob(rawClientState), (c) => c.charCodeAt(0))
      );
      console.log('Decoded client_state:', decodedClientState);
    } catch (err) {
      console.warn('Failed to decode client_state as base64, using raw:', rawClientState);
      decodedClientState = rawClientState;
    }
  }

  console.log('Call initiated:', {
    callSessionId: payload.call_session_id,
    callControlId: payload.call_control_id,
    from: payload.from,
    to: payload.to,
    direction: payload.direction,
    hasClientState: !!rawClientState,
    decodedClientState,
  });

  const callData: any = {
    telnyx_call_id: payload.call_session_id, // Map using shared session ID
    direction: payload.direction,
    caller_id_used: payload.from,
    status: 'ringing',
    updated_at: new Date().toISOString(),
  };

  if (decodedClientState && decodedClientState.length === 36) {
    // If clientState is a valid UUID, update the existing record
    const { data: existing, error: fetchError } = await supabase
      .from('calls')
      .select('id')
      .eq('id', decodedClientState)
      .maybeSingle();

    if (existing) {
      console.log('Linking telnyx_call_id to existing call record:', decodedClientState);
      const { error } = await supabase
        .from('calls')
        .update(callData)
        .eq('id', decodedClientState);
      if (error) console.error('Error updating existing call record:', error);
    } else {
      console.warn('client_state UUID not found in calls table:', decodedClientState);
      // Insert new if not found (fallback)
      const { error } = await supabase.from('calls').insert({
        ...callData,
        id: decodedClientState,
        created_at: new Date().toISOString(),
      });
      if (error) console.error('Error inserting call record with missing UUID:', error);
    }
  } else {
    // No UUID provided — insert a new record
    console.log('No valid client_state UUID provided, inserting new record');
    const { error } = await supabase.from('calls').insert({
      ...callData,
      created_at: new Date().toISOString(),
    });
    if (error) console.error('Error creating new call record:', error);
  }

  // Note: AMD trigger moved to handleCallAnswered to avoid analyzing ringback
}

// Handler: call.answered
async function handleCallAnswered(supabase: any, payload: any) {
  console.log('Call answered:', payload.call_session_id);

  const { error } = await supabase
    .from('calls')
    .update({ status: 'connected' })
    .eq('telnyx_call_id', payload.call_session_id);

  if (error) {
    console.error('Error updating call to connected:', error);
  }

  // ── Trigger AMD if enabled ──
  // We trigger AMD on 'answered' rather than 'initiated' to ensure
  // we don't analyze ringback tones or carrier announcements.
  if (payload.direction === 'outbound') {
    const orgId = await getCallOrgId(supabase, payload.call_session_id);
    const amdEnabled = await isAmdEnabled(supabase, orgId || undefined);

    if (amdEnabled) {
      console.log('AMD enabled — triggering AMD start via REST for call:', payload.call_session_id);
      const apiKey = await getTelnyxApiKey(supabase, orgId || undefined);
      if (apiKey) {
        // Trigger AMD directly from webhook to minimize latency
        await telnyxStartAmd(apiKey, payload.call_control_id);
      } else {
        console.warn('Cannot start AMD: No Telnyx API key found for org:', orgId);
      }
    }
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
    callSessionId: payload.call_session_id,
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
    .eq('telnyx_call_id', payload.call_session_id);

  if (error) {
    console.error('Error updating call on hangup:', error);
  }

  // Look up the call record to get contact_id, duration, disposition_name
  const { data: callRecord } = await supabase
    .from('calls')
    .select('contact_id, duration, disposition_name, direction, caller_id_used')
    .eq('telnyx_call_id', payload.call_session_id)
    .single();

  if (callRecord?.contact_id) {
    const durationFormatted = callRecord.duration
      ? `${Math.floor(callRecord.duration / 60)}m ${callRecord.duration % 60}s`
      : 'No answer';
    const directionLabel = callRecord.direction === 'inbound' ? 'Inbound' : 'Outbound';
    const dispositionLabel = callRecord.disposition_name
      ? ` — ${callRecord.disposition_name}`
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
  const callSessionId = payload.call_session_id;
  const amdResult = payload.result; // 'human' | 'machine' | 'not_sure'

  console.log('AMD standard result:', { callSessionId, amdResult });

  // Normalize: 'not_sure' → treat as 'human' (better to connect agent than skip a prospect)
  const normalizedResult = amdResult === 'not_sure' ? 'human' : amdResult;

  const { error } = await supabase
    .from('calls')
    .update({ amd_result: normalizedResult })
    .eq('telnyx_call_id', callSessionId);

  if (error) {
    console.error('Error updating AMD result:', error);
  }

  await handleMachineDetected(supabase, callControlId, callSessionId, normalizedResult);
}

// Handler: call.machine.premium.detection.ended (Premium AMD)
async function handlePremiumAMDResult(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;
  const rawResult = payload.result;
  // Premium results: 'human_residence' | 'human_business' | 'machine' | 'silence' | 'fax_detected' | 'not_sure'

  console.log('AMD premium result:', { callSessionId, rawResult });

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
    .eq('telnyx_call_id', callSessionId);

  if (error) {
    console.error('Error updating premium AMD result:', error);
  }

  await handleMachineDetected(supabase, callControlId, callSessionId, normalizedResult);
}

// Handler: call.machine.greeting.ended / call.machine.premium.greeting.ended
async function handleGreetingEnded(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;

  console.log('AMD greeting ended (beep/machine most likely):', { callSessionId });

  // If the greeting ended, we almost certainly want to treat this as a machine
  // so we can trigger the auto-hangup if that's what's configured.
  await handleMachineDetected(supabase, callControlId, callSessionId, 'machine');
}

// ─── Shared: handle machine detection ───
async function handleMachineDetected(supabase: any, callControlId: string, callSessionId: string, result: string) {
  console.log(`[AMD-Handler] Processing result: ${result} for session: ${callSessionId}`);
  
  if (result !== 'machine') {
    console.log(`[AMD-Handler] Result is '${result}', no auto-action required.`);
    return;
  }

  // Check if AMD auto-action is enabled
  const orgId = await getCallOrgId(supabase, callSessionId);
  const amdEnabled = await isAmdEnabled(supabase, orgId || undefined);

  console.log(`[AMD-Handler] OrgID: ${orgId}, AMD Enabled: ${amdEnabled}`);

  if (!amdEnabled) {
    console.log('[AMD-Handler] Machine detected but AMD auto-action is disabled in settings.');
    // We still update the call record result for the UI (scoped by org if available)
    let updateQuery = supabase.from('calls').update({ amd_result: 'machine' }).eq('telnyx_call_id', callSessionId);
    if (orgId) updateQuery = updateQuery.eq('organization_id', orgId);
    await updateQuery;
    return;
  }

  if (!orgId) {
    console.warn('[AMD-Handler] Cannot execute auto-action: No organization_id found for call.');
    return;
  }

  console.log('[AMD-Handler] MACHINE DETECTED — Proceeding with auto-hangup and disposition update.');

  // 1. Get call record to find campaign_lead_id
  const { data: callRecord, error: callFetchError } = await supabase
    .from('calls')
    .select('id, contact_id, campaign_lead_id, organization_id')
    .eq('telnyx_call_id', callSessionId)
    .eq('organization_id', orgId) // RLS Safety
    .maybeSingle();

  if (callFetchError) console.error('[AMD-Handler] Error fetching call record:', callFetchError);
  
  console.log('[AMD-Handler] Call record lookup:', { 
    found: !!callRecord, 
    campaignLeadId: callRecord?.campaign_lead_id,
  });

  // 2. Lookup "No Answer" disposition ID for this organization
  const { data: disposition } = await supabase
    .from('dispositions')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', 'No Answer')
    .maybeSingle();

  const dispositionId = disposition?.id || null;

  // 3. Update campaign_leads if applicable
  if (callRecord?.campaign_lead_id) {
    console.log(`[AMD-Handler] Updating campaign_lead ${callRecord.campaign_lead_id} to No Answer`);
    const { data: lead } = await supabase
      .from('campaign_leads')
      .select('call_attempts')
      .eq('id', callRecord.campaign_lead_id)
      .eq('organization_id', orgId) // RLS Safety
      .maybeSingle();

    const { error: leadUpdateError } = await supabase
      .from('campaign_leads')
      .update({
        status: 'Called',
        disposition: 'No Answer', // Textual disposition
        disposition_id: dispositionId, // Linked ID
        call_attempts: (lead?.call_attempts || 0) + 1,
        last_called_at: new Date().toISOString(),
      })
      .eq('id', callRecord.campaign_lead_id)
      .eq('organization_id', orgId); // RLS Safety
    
    if (leadUpdateError) console.error('[AMD-Handler] Error updating campaign_lead:', leadUpdateError);
  }

  // 4. Update call record with disposition and status
  const { error: callUpdateError } = await supabase
    .from('calls')
    .update({
      status: 'completed',
      amd_result: 'machine',
      disposition_name: 'No Answer',
      disposition_id: dispositionId,
      updated_at: new Date().toISOString(),
    })
    .eq('telnyx_call_id', callSessionId)
    .eq('organization_id', orgId); // RLS Safety

  if (callUpdateError) console.error('[AMD-Handler] Error updating call record:', callUpdateError);

  // 5. Auto-hangup via Telnyx REST API
  const apiKey = await getTelnyxApiKey(supabase, orgId);
  if (apiKey) {
    console.log(`[AMD-Handler] Initiating Telnyx REST hangup for control_id: ${callControlId}`);
    await telnyxHangup(apiKey, callControlId);
    console.log('[AMD-Handler] Hangup command sent.');
  } else {
    console.warn('[AMD-Handler] Cannot auto-hangup: No Telnyx API key found.');
  }
}

// Handler: call.recording.saved
async function handleRecordingSaved(supabase: any, payload: any) {
  const callSessionId = payload.call_session_id;
  const recordingUrl = payload.recording_urls?.mp3 || payload.recording_urls?.wav || null;

  console.log('Recording saved:', { callSessionId, recordingUrl });

  if (recordingUrl) {
    const { error } = await supabase
      .from('calls')
      .update({ recording_url: recordingUrl })
      .eq('telnyx_call_id', callSessionId);

    if (error) {
      console.error('Error saving recording URL:', error);
    }
  }
}
