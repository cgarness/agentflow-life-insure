// verify_jwt: false — Telnyx sends webhooks with Ed25519 signatures, not JWTs
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

// ─── Helper: Verify Telnyx Ed25519 webhook signature ───
async function verifyTelnyxSignature(req: Request, rawBody: string): Promise<boolean> {
  const telnyxPublicKey = Deno.env.get('TELNYX_PUBLIC_KEY');
  if (!telnyxPublicKey) {
    console.warn('[SECURITY] TELNYX_PUBLIC_KEY not configured — skipping signature verification. Set this secret ASAP.');
    return true; // Fail-open during initial deployment; close once key is set
  }

  const signature = req.headers.get('telnyx-signature-ed25519');
  const timestamp = req.headers.get('telnyx-timestamp');

  if (!signature || !timestamp) {
    console.error('[SECURITY] Missing telnyx-signature-ed25519 or telnyx-timestamp headers. Rejecting.');
    return false;
  }

  // Replay protection: reject if timestamp is more than 5 minutes old
  const timestampAge = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (timestampAge > 300) {
    console.error(`[SECURITY] Webhook timestamp too old (${timestampAge}s). Possible replay attack. Rejecting.`);
    return false;
  }

  try {
    // Telnyx signs: timestamp + '|' + rawBody
    const signedPayload = `${timestamp}|${rawBody}`;
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(signedPayload);

    // Decode the hex-encoded public key into raw bytes
    const publicKeyBytes = new Uint8Array(
      telnyxPublicKey.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
    );

    // Import the Ed25519 public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    // Decode the base64-encoded signature
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    // Verify the signature
    const isValid = await crypto.subtle.verify('Ed25519', cryptoKey, signatureBytes, messageBytes);

    if (!isValid) {
      console.error('[SECURITY] Ed25519 signature verification FAILED. Forged webhook rejected.');
    }

    return isValid;
  } catch (err) {
    console.error('[SECURITY] Signature verification threw an error:', err);
    return false;
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

  // ─── Read raw body FIRST (needed for signature verification before JSON parsing) ───
  const rawBody = await req.text();

  // ─── Verify Telnyx webhook signature ───
  const signatureValid = await verifyTelnyxSignature(req, rawBody);
  if (!signatureValid) {
    // Return 200 to prevent Telnyx from retrying, but process nothing
    console.error('[SECURITY] Webhook rejected — invalid signature. No events processed.');
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = JSON.parse(rawBody);
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

      // Legacy AMD events (Telnyx connection may still emit if enabled in portal) — intentionally ignored
      case 'call.machine.detection.ended':
      case 'call.machine.premium.detection.ended':
      case 'call.machine.greeting.ended':
      case 'call.machine.premium.greeting.ended':
        console.log(`[telnyx-webhook] Ignoring AMD event (feature removed): ${eventType}`);
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

// ─── Helper: transfer call to an agent's SIP endpoint ───
async function telnyxTransfer(
  apiKey: string,
  callControlId: string,
  sipUsername: string,
  fromE164?: string | null,
): Promise<void> {
  const sipUri = `sip:${sipUsername}@sip.telnyx.com`;
  const payload: Record<string, string> = { to: sipUri };
  // Present a valid E.164 on the new SIP leg (outbound CLI from the PSTN leg).
  if (fromE164 && typeof fromE164 === 'string' && fromE164.trim().length > 0) {
    payload.from = fromE164.startsWith('+') ? fromE164 : `+${fromE164.replace(/\D/g, '')}`;
  }
  console.log(`Attempting transfer to agent: [${sipUri}] for call: [${callControlId}]`, {
    from: payload.from ?? '(default)',
  });

  try {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`;
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
      console.error(`Telnyx transfer failed for [${callControlId}]. Status: ${resp.status}, Payload:`, errText);
    } else {
      console.log(`Telnyx transfer success for [${callControlId}] to [${sipUri}]`);
    }
  } catch (err) {
    console.error(`EXCEPTION in telnyxTransfer for [${callControlId}]:`, err);
  }
}

// ─── Helper: check if recording is enabled ───
async function isRecordingEnabled(supabase: any, organizationId?: string): Promise<boolean> {
  try {
    let query = supabase.from('phone_settings').select('recording_enabled');
    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      console.error(`Error checking recording status for org ${organizationId}:`, error);
    }
    return data?.recording_enabled === true;
  } catch (err) {
    console.error('EXCEPTION in isRecordingEnabled:', err);
    return false;
  }
}

// ─── Helper: start call recording via Telnyx REST API ───
async function telnyxRecordStart(apiKey: string, callControlId: string): Promise<void> {
  console.log(`Attempting record_start for call: [${callControlId}]`);
  try {
    const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ format: 'mp3', channels: 'dual', play_beep: false }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Telnyx record_start failed for [${callControlId}]. Status: ${resp.status}, Payload:`, errText);
    } else {
      console.log(`Telnyx record_start success for [${callControlId}]`);
    }
  } catch (err) {
    console.error(`EXCEPTION in telnyxRecordStart for [${callControlId}]:`, err);
  }
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
    telnyx_call_id: payload.call_session_id, // Session ID
    telnyx_call_control_id: payload.call_control_id, // Granular Control ID
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
      .maybeSingle(); // FIX: PGRST116

    if (fetchError) console.error(`Error fetching existing call record for ${decodedClientState}:`, fetchError);

    if (existing) {
      console.log('Linking IDs to existing call record:', decodedClientState);
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
  console.log('Call answered:', payload.call_control_id);

  const { error } = await supabase
    .from('calls')
    .update({ status: 'connected' })
    .eq('telnyx_call_control_id', payload.call_control_id);

  if (error) {
    console.error(`Error updating call ${payload.call_control_id} to connected:`, error);
  }

  // ── Bridge agent immediately on outbound answer (AMD removed) ──
  if (payload.direction === 'outbound') {
    await handleHumanDetected(supabase, payload);
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
    .eq('telnyx_call_control_id', payload.call_control_id);

  if (error) {
    console.error(`Error updating call ${payload.call_control_id} on hangup:`, error);
  }

  // Look up the call record to get contact_id, duration, disposition_name
  const { data: callRecord, error: fetchError } = await supabase
    .from('calls')
    .select('contact_id, duration, disposition_name, direction, caller_id_used')
    .eq('telnyx_call_control_id', payload.call_control_id)
    .maybeSingle(); // FIX: STOP THE CRASH (PGRST116)

  if (fetchError) {
    console.warn(`Error searching for call record for activity log: ${payload.call_control_id}`, fetchError);
  }

  if (!callRecord) {
    console.warn(`[handleCallHangup] Call record not found for [${payload.call_control_id}]. Skipping activity log.`);
    return;
  }

  if (callRecord.contact_id) {
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

// ─── Outbound answer: bridge agent to callee (SIP transfer + optional recording) ───
async function handleHumanDetected(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const decodedClientState = decodeClientState(payload.client_state);

  console.log(`[Bridge] Outbound answered for control_id: ${callControlId}. Initiating agent bridge.`);

  let agentId: string | null = null;
  let orgId: string | null = null;

  if (decodedClientState && decodedClientState.length === 36) {
    const { data, error } = await supabase
      .from('calls')
      .select('agent_id, organization_id')
      .eq('id', decodedClientState)
      .maybeSingle();
    
    if (error) console.error(`[Bridge] Error fetching agent_id for ${decodedClientState}:`, error);
    agentId = data?.agent_id;
    orgId = data?.organization_id;
  }

  // call.answered may omit client_state; we still have telnyx_call_control_id on the row.
  if (!agentId) {
    const { data: byCtrl, error: ctrlErr } = await supabase
      .from('calls')
      .select('agent_id, organization_id')
      .eq('telnyx_call_control_id', callControlId)
      .maybeSingle();
    if (ctrlErr) console.error('[Bridge] Fallback lookup by call_control_id failed:', ctrlErr);
    agentId = byCtrl?.agent_id ?? null;
    orgId = byCtrl?.organization_id ?? orgId;
  }

  if (!agentId) {
    console.warn(
      `[Bridge] Cannot bridge: No agent_id for [${callControlId}] (client_state + control_id lookup failed).`,
    );
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('sip_username')
    .eq('id', agentId)
    .maybeSingle();

  if (profileError || !profile?.sip_username) {
    console.error(`[Bridge] CRITICAL: SIP username not found for agent ${agentId}. Profile error:`, profileError);
    return;
  }

  const apiKey = await getTelnyxApiKey(supabase, orgId || undefined);
  if (apiKey) {
    await telnyxTransfer(apiKey, callControlId, profile.sip_username, payload.from);

    try {
      const recordingEnabled = await isRecordingEnabled(supabase, orgId || undefined);
      if (recordingEnabled) {
        await telnyxRecordStart(apiKey, callControlId);
      }
    } catch (err) {
      console.error(`[Bridge] Recording start failed (non-fatal) for [${callControlId}]:`, err);
    }
  } else {
    console.warn(`[Bridge] Cannot bridge: No Telnyx API key found for org ${orgId}.`);
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
      .eq('telnyx_call_control_id', callControlId);

    if (error) {
      console.error(`Error saving recording URL for control_id ${callControlId}:`, error);
    }
  }
}
