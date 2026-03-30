// verify_jwt: false — Telnyx sends unsigned webhooks
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Helper: Decode Telnyx client_state (Base64) ───
function decodeClientState(rawClientState: string | null): string | null {
  if (!rawClientState) return null;
  try {
    // Telnyx standardizes client_state as base64
    return new TextDecoder().decode(
      Uint8Array.from(atob(rawClientState), (c) => c.charCodeAt(0))
    );
  } catch (err) {
    console.warn('Failed to decode client_state as base64, using raw:', rawClientState);
    return rawClientState;
  }
}

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    console.log(`Received event: [${eventType}]`);

    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, payload);
        break;

      case 'call.answered':
        await handleCallAnswered(supabase, payload);
        break;

      case 'call.hangup':
        await handleCallHangup(supabase, payload);
        break;

      // Standard AMD
      case 'call.machine.detection.ended':
        await handleAMDResult(supabase, payload);
        break;

      // Premium AMD (more granular: human_residence, human_business, machine, silence, fax_detected)
      case 'call.machine.premium.detection.ended':
        await handlePremiumAMDResult(supabase, payload);
        break;

      // Greeting detection (often indicates machine voicemail box ready)
      case 'call.machine.greeting.ended':
      case 'call.machine.premium.greeting.ended':
        await handleGreetingEnded(supabase, payload);
        break;

      case 'call.recording.saved':
        await handleRecordingSaved(supabase, payload);
        break;

      default:
        console.log('Unhandled event type:', eventType);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('CRITICAL Webhook error catch-all:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// ─── Helper: get Telnyx API key for a call ───
async function getTelnyxApiKey(supabase: any, organizationId?: string): Promise<string | null> {
  if (organizationId) {
    const { data, error } = await supabase
      .from('telnyx_settings')
      .select('api_key')
      .eq('organization_id', organizationId)
      .maybeSingle();
    
    if (error) {
      console.error(`Error fetching Telnyx API key for org ${organizationId}:`, error);
      return null;
    }
    if (data?.api_key) return data.api_key;
  }
  // Fallback to global
  const { data: global, error: globalError } = await supabase
    .from('telnyx_settings')
    .select('api_key')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  
  if (globalError) {
    console.error('Error fetching global Telnyx API key:', globalError);
  }
  return global?.api_key || null;
}

// ─── Helper: hangup a call via Telnyx REST API ───
async function telnyxHangup(apiKey: string, callControlId: string): Promise<void> {
  try {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Telnyx hangup failed for [${callControlId}]. Status: ${resp.status}, Payload:`, errText);
    } else {
      console.log(`Telnyx hangup success for [${callControlId}]`);
    }
  } catch (err) {
    console.error(`EXCEPTION in telnyxHangup for [${callControlId}]:`, err);
  }
}

// ─── Helper: start AMD via Telnyx REST API ───
async function telnyxStartAmd(apiKey: string, callControlId: string): Promise<void> {
  console.log(`Attempting AMD start for call: [${callControlId}]`);
  const payload = {
    total_analysis_time_millis: 15000,
    initial_silence_millis: 3500,
    greeting_silence_millis: 2000,
    silence_after_greeting_millis: 1500,
  };

  try {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/answering_machine_detection`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Telnyx AMD start failed for [${callControlId}]. Status: ${resp.status}, Payload:`, errText, 'Request Payload:', payload);
    } else {
      console.log(`Telnyx AMD start success for [${callControlId}]`);
    }
  } catch (err) {
    console.error(`EXCEPTION in telnyxStartAmd for [${callControlId}]:`, err, 'Request Payload:', payload);
  }
}

// ─── Helper: check if AMD is enabled ───
async function isAmdEnabled(supabase: any, organizationId?: string): Promise<boolean> {
  try {
    let query = supabase.from('phone_settings').select('amd_enabled');
    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      console.error(`Error checking AMD status for org ${organizationId}:`, error);
    }
    return data?.amd_enabled === true;
  } catch (err) {
    console.error('EXCEPTION in isAmdEnabled:', err);
    return false;
  }
}

// ─── Helper: get organization_id from a call record ───
async function getCallOrgId(supabase: any, payload: any): Promise<string | null> {
  const callSessionId = payload.call_session_id;
  const decodedClientState = decodeClientState(payload.client_state);

  // 1. Try to use client_state (UUID from frontend) as primary lookup
  if (decodedClientState && decodedClientState.length === 36) {
    console.log(`[getCallOrgId] Looking up orgId via client_state (id): ${decodedClientState}`);
    const { data, error } = await supabase
      .from('calls')
      .select('organization_id')
      .eq('id', decodedClientState)
      .maybeSingle();
    
    if (error) console.error(`[getCallOrgId] Error fetching orgId via id ${decodedClientState}:`, error);
    if (data?.organization_id) return data.organization_id;
  }

  // 2. Fallback: Search for any record with this session ID that has an organization_id
  console.log(`[getCallOrgId] Falling back to session ID lookup: ${callSessionId}`);
  const { data, error } = await supabase
    .from('calls')
    .select('organization_id')
    .eq('telnyx_call_id', callSessionId)
    .not('organization_id', 'is', null)
    .maybeSingle();
    
  if (error) console.error(`[getCallOrgId] Error fetching orgId via session ${callSessionId}:`, error);
  return data?.organization_id || null;
}

// Handler: call.initiated
async function handleCallInitiated(supabase: any, payload: any) {
  const decodedClientState = decodeClientState(payload.client_state);

  console.log('Call initiated details:', {
    callSessionId: payload.call_session_id,
    callControlId: payload.call_control_id,
    direction: payload.direction,
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

    if (fetchError) console.error(`Error fetching existing call record for ${decodedClientState}:`, fetchError);

    if (existing) {
      console.log('Linking telnyx_call_id to existing call record:', decodedClientState);
      const { error } = await supabase
        .from('calls')
        .update(callData)
        .eq('id', decodedClientState);
      if (error) console.error(`Error updating existing call record ${decodedClientState}:`, error, 'Data:', callData);
    } else {
      console.warn('client_state UUID not found in calls table:', decodedClientState);
      // Insert new if not found (fallback)
      const { error } = await supabase.from('calls').insert({
        ...callData,
        id: decodedClientState,
        created_at: new Date().toISOString(),
      });
      if (error) console.error(`Error inserting call record for ${decodedClientState}:`, error, 'Data:', callData);
    }
  } else {
    // No UUID provided — insert a new record
    console.log('No valid client_state UUID provided, inserting new record');
    const { error } = await supabase.from('calls').insert({
      ...callData,
      created_at: new Date().toISOString(),
    });
    if (error) console.error('Error creating new call record:', error, 'Data:', callData);
  }
}

// Handler: call.answered
async function handleCallAnswered(supabase: any, payload: any) {
  console.log('Call answered:', payload.call_session_id);

  const { error } = await supabase
    .from('calls')
    .update({ status: 'connected' })
    .eq('telnyx_call_id', payload.call_session_id);

  if (error) {
    console.error(`Error updating call ${payload.call_session_id} to connected:`, error);
  }

  // ── Trigger AMD if enabled ──
  if (payload.direction === 'outbound') {
    const orgId = await getCallOrgId(supabase, payload);
    const amdEnabled = await isAmdEnabled(supabase, orgId || undefined);

    if (amdEnabled) {
      const apiKey = await getTelnyxApiKey(supabase, orgId || undefined);
      if (apiKey) {
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
    console.error(`Error updating call ${payload.call_session_id} on hangup:`, error);
  }

  // Look up the call record to get contact_id, duration, disposition_name
  const { data: callRecord, error: fetchError } = await supabase
    .from('calls')
    .select('contact_id, duration, disposition_name, direction, caller_id_used')
    .eq('telnyx_call_id', payload.call_session_id)
    .single();

  if (fetchError) {
    console.warn(`Could not fetch call record for activity log: ${payload.call_session_id}`, fetchError);
  }

  if (callRecord?.contact_id) {
    const durationFormatted = callRecord.duration
      ? `${Math.floor(callRecord.duration / 60)}m ${callRecord.duration % 60}s`
      : 'No answer';
    const directionLabel = callRecord.direction === 'inbound' ? 'Inbound' : 'Outbound';
    const dispositionLabel = callRecord.disposition_name
      ? ` — ${callRecord.disposition_name}`
      : '';

    const activityData = {
      contact_id: callRecord.contact_id,
      contact_type: 'lead',
      type: 'call',
      description: `${directionLabel} call — ${durationFormatted}${dispositionLabel}`,
      created_at: new Date().toISOString()
    };

    const { error: activityError } = await supabase.from('contact_activities').insert(activityData);
    if (activityError) {
      console.error(`Error inserting activity for contact ${callRecord.contact_id}:`, activityError, 'Payload:', activityData);
    }
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
    console.error(`Error updating AMD result for session ${callSessionId}:`, error);
  }

  await handleMachineDetected(supabase, payload, normalizedResult);
}

// Handler: call.machine.premium.detection.ended (Premium AMD)
async function handlePremiumAMDResult(supabase: any, payload: any) {
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
    console.error(`Error updating premium AMD result for session ${callSessionId}:`, error);
  }

  await handleMachineDetected(supabase, payload, normalizedResult);
}

// Handler: call.machine.greeting.ended / call.machine.premium.greeting.ended
async function handleGreetingEnded(supabase: any, payload: any) {
  const callSessionId = payload.call_session_id;
  console.log('AMD greeting ended (beep/machine most likely):', { callSessionId });

  // If the greeting ended, we almost certainly want to treat this as a machine
  // so we can trigger the auto-hangup if that's what's configured.
  await handleMachineDetected(supabase, payload, 'machine');
}

// ─── Shared: handle machine detection ───
async function handleMachineDetected(supabase: any, payload: any, result: string) {
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;

  console.log(`[AMD-Handler] Processing result: ${result} for session: ${callSessionId}`);
  
  if (result !== 'machine') {
    console.log(`[AMD-Handler] Result is '${result}', no auto-action required.`);
    return;
  }

  // Check if AMD auto-action is enabled
  const orgId = await getCallOrgId(supabase, payload);
  if (!orgId) {
    console.warn(`[AMD-Handler] Cannot execute auto-action for session ${callSessionId}: No organization_id found.`);
    return;
  }

  const amdEnabled = await isAmdEnabled(supabase, orgId);
  console.log(`[AMD-Handler] OrgID: ${orgId}, AMD Enabled: ${amdEnabled}`);

  if (!amdEnabled) {
    console.log('[AMD-Handler] Machine detected but AMD auto-action is disabled in settings.');
    // We still update the call record result result.
    const { error } = await supabase.from('calls').update({ amd_result: 'machine' }).eq('telnyx_call_id', callSessionId).eq('organization_id', orgId);
    if (error) console.error(`[AMD-Handler] Error updating amd_result to machine for ${callSessionId}:`, error);
    return;
  }

  console.log('[AMD-Handler] MACHINE DETECTED — Proceeding with auto-hangup and disposition update.');

  // 1. Get call record to find campaign_lead_id
  const { data: callRecord, error: callFetchError } = await supabase
    .from('calls')
    .select('id, contact_id, campaign_lead_id, organization_id')
    .eq('telnyx_call_id', callSessionId)
    .eq('organization_id', orgId) // Master key bypasses RLS, but keep filter for correctness
    .maybeSingle();

  if (callFetchError) {
    console.error('[AMD-Handler] Error fetching call record:', callFetchError, 'for session:', callSessionId, 'org:', orgId);
  }
  
  console.log('[AMD-Handler] Call record lookup:', { 
    found: !!callRecord, 
    campaignLeadId: callRecord?.campaign_lead_id,
  });

  // 2. Lookup "No Answer" disposition ID for this organization
  const { data: disposition, error: dispError } = await supabase
    .from('dispositions')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', 'No Answer')
    .maybeSingle();

  if (dispError) console.error(`[AMD-Handler] Error fetching "No Answer" disposition for org ${orgId}:`, dispError);

  const dispositionId = disposition?.id || null;

  // 3. Update campaign_leads if applicable
  if (callRecord?.campaign_lead_id) {
    console.log(`[AMD-Handler] Updating campaign_lead ${callRecord.campaign_lead_id} to No Answer`);
    const { data: lead, error: leadFetchError } = await supabase
      .from('campaign_leads')
      .select('call_attempts')
      .eq('id', callRecord.campaign_lead_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (leadFetchError) console.error(`[AMD-Handler] Error fetching campaign_lead ${callRecord.campaign_lead_id}:`, leadFetchError);

    const leadUpdateData = {
      status: 'Called',
      disposition: 'No Answer', // Textual disposition
      disposition_id: dispositionId, // Linked ID
      call_attempts: (lead?.call_attempts || 0) + 1,
      last_called_at: new Date().toISOString(),
    };

    const { error: leadUpdateError } = await supabase
      .from('campaign_leads')
      .update(leadUpdateData)
      .eq('id', callRecord.campaign_lead_id)
      .eq('organization_id', orgId);
    
    if (leadUpdateError) {
      console.error('[AMD-Handler] Error updating campaign_lead:', leadUpdateError, 'Lead ID:', callRecord.campaign_lead_id, 'Data:', leadUpdateData);
    } else {
      console.log(`[AMD-Handler] campaign_lead ${callRecord.campaign_lead_id} updated successfully.`);
    }
  }

  // 4. Update call record with disposition and status
  const callUpdateData = {
    status: 'completed',
    amd_result: 'machine',
    disposition_name: 'No Answer',
    disposition_id: dispositionId,
    updated_at: new Date().toISOString(),
  };

  const { error: callUpdateError } = await supabase
    .from('calls')
    .update(callUpdateData)
    .eq('telnyx_call_id', callSessionId)
    .eq('organization_id', orgId);

  if (callUpdateError) {
    console.error('[AMD-Handler] Error updating call record:', callUpdateError, 'Session:', callSessionId, 'Data:', callUpdateData);
  } else {
    console.log(`[AMD-Handler] call record ${callSessionId} updated successfully.`);
  }

  // 5. Auto-hangup via Telnyx REST API
  const apiKey = await getTelnyxApiKey(supabase, orgId);
  if (apiKey) {
    console.log(`[AMD-Handler] Initiating Telnyx REST hangup for control_id: ${callControlId}`);
    await telnyxHangup(apiKey, callControlId);
    console.log('[AMD-Handler] Hangup command sent.');
  } else {
    console.warn('[AMD-Handler] Cannot auto-hangup: No Telnyx API key found for org:', orgId);
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
      console.error(`Error saving recording URL for session ${callSessionId}:`, error);
    }
  }
}
