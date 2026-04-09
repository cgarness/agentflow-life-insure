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

/** Our `calls.id` is a UUID passed via WebRTC `clientState` (often base64). */
function isLikelyCallsRowId(s: string | null): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function decodeCallsRowIdFromPayload(payload: any): string | null {
  const raw = payload?.client_state;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const decoded = decodeClientState(raw);
    if (decoded && isLikelyCallsRowId(decoded)) return decoded;
    if (isLikelyCallsRowId(raw)) return raw;
  }
  return null;
}

/** Telnyx varies: recording_urls vs public_recording_urls; mp3/wav keys; nested objects. */
function extractRecordingDownloadUrl(payload: any): string | null {
  const tryObj = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null;
    for (const v of Object.values(o as Record<string, unknown>)) {
      if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) return v;
    }
    return null;
  };
  const direct =
    payload?.recording_urls?.mp3 ||
    payload?.recording_urls?.wav ||
    payload?.public_recording_urls?.mp3 ||
    payload?.public_recording_urls?.wav ||
    (typeof payload?.recording_urls === 'string' ? payload.recording_urls : null) ||
    payload?.recording_url_mp3 ||
    payload?.recording_url ||
    null;
  if (typeof direct === 'string' && direct.startsWith('http')) return direct;
  const fromNested =
    tryObj(payload?.recording_urls) ||
    tryObj(payload?.public_recording_urls) ||
    tryObj(payload?.recording_files);
  return fromNested;
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
        if (typeof eventType === 'string' && eventType.includes('recording')) {
          console.log(`[telnyx-webhook] Unhandled recording-related event: ${eventType}`);
        } else {
          console.log('Unhandled event type:', eventType);
        }
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

// telnyxTransfer removed — one-legged WebRTC calling means the agent's SDK IS the call.
// No SIP transfer needed; audio flows natively through the WebRTC channel.

// ─── Helper: check if recording is enabled ───
async function isRecordingEnabled(supabase: any, organizationId?: string): Promise<boolean> {
  try {
    if (organizationId) {
      const { data, error } = await supabase
        .from('phone_settings')
        .select('recording_enabled')
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) {
        console.error(`Error checking recording status for org ${organizationId}:`, error);
        return true;
      }
      if (data == null) {
        return true;
      }
      return data.recording_enabled !== false;
    }
    const { data, error } = await supabase
      .from('phone_settings')
      .select('recording_enabled')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('Error checking global recording status:', error);
      return true;
    }
    return data?.recording_enabled !== false;
  } catch (err) {
    console.error('EXCEPTION in isRecordingEnabled:', err);
    return true;
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
    // No UUID provided — this is likely a transfer/bridge leg created by our webhook.
    // Only insert if it looks like a genuine inbound or manually-initiated call.
    // Transfer legs from telnyxTransfer() don't carry client_state, so we skip
    // inserting orphan records that would pollute the calls table.
    if (payload.direction === 'inbound') {
      console.log('Inbound call without client_state UUID — inserting new record');
      const { error } = await supabase.from('calls').insert({
        ...callData,
        created_at: new Date().toISOString(),
      });
      if (error) console.error('Error creating new call record:', error, 'Data:', callData);
    } else {
      console.log(`[call.initiated] Outbound call without client_state — likely a transfer leg. Skipping record creation. control_id: ${payload.call_control_id}`);
    }
  }
}

// Handler: call.answered
// With one-legged WebRTC calling, the agent's SDK is the call itself — no transfer needed.
// We just update the DB status and optionally start recording.
async function handleCallAnswered(supabase: any, payload: any) {
  console.log('Call answered:', payload.call_control_id, { direction: payload.direction });

  let updatedRow: { id: string; organization_id: string | null } | null = null;

  const { data: byControlId, error } = await supabase
    .from('calls')
    .update({ status: 'connected', updated_at: new Date().toISOString() })
    .eq('telnyx_call_control_id', payload.call_control_id)
    .select('id, organization_id')
    .maybeSingle();

  if (error) {
    console.error(`Error updating call ${payload.call_control_id} to connected:`, error);
  }
  if (byControlId) updatedRow = byControlId;

  // WebRTC: call.initiated may arrive late or omit client_state; row may exist without telnyx_call_control_id yet.
  if (!updatedRow) {
    const rowId = decodeCallsRowIdFromPayload(payload);
    if (rowId) {
      const linkPatch: Record<string, unknown> = {
        status: 'connected',
        telnyx_call_control_id: payload.call_control_id,
        updated_at: new Date().toISOString(),
      };
      if (payload.call_session_id) linkPatch.telnyx_call_id = payload.call_session_id;

      const { data: linked, error: linkErr } = await supabase
        .from('calls')
        .update(linkPatch)
        .eq('id', rowId)
        .select('id, organization_id')
        .maybeSingle();

      if (linkErr) {
        console.error(`[call.answered] client_state link failed for row ${rowId}:`, linkErr);
      } else if (linked) {
        console.log(`[call.answered] Linked call_control_id to row ${rowId} via client_state`);
        updatedRow = linked;
      }
    }
  }

  if (!updatedRow) {
    console.log(`[call.answered] No matching calls row for control_id ${payload.call_control_id}. Skipping.`);
    return;
  }

  // Start recording if enabled for this organization
  try {
    const orgId = updatedRow.organization_id;
    const apiKey = await getTelnyxApiKey(supabase, orgId || undefined);
    if (apiKey) {
      const recordingEnabled = await isRecordingEnabled(supabase, orgId || undefined);
      if (recordingEnabled) {
        await telnyxRecordStart(apiKey, payload.call_control_id);
      }
    }
  } catch (err) {
    console.error(`[call.answered] Recording start failed (non-fatal) for [${payload.call_control_id}]:`, err);
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

  const hangPatch = {
    status,
    duration,
    hangup_details: hangupCause,
    updated_at: new Date().toISOString(),
  };

  const { data: hangByControl, error: hangErr } = await supabase
    .from('calls')
    .update(hangPatch)
    .eq('telnyx_call_control_id', payload.call_control_id)
    .select('contact_id, duration, disposition_name, direction, caller_id_used, organization_id, agent_id')
    .maybeSingle();

  if (hangErr) {
    console.error(`Error updating call ${payload.call_control_id} on hangup:`, hangErr);
  }

  let callRecord = hangByControl;

  if (!callRecord) {
    const rowId = decodeCallsRowIdFromPayload(payload);
    if (rowId) {
      const linkHang = {
        ...hangPatch,
        telnyx_call_control_id: payload.call_control_id,
        ...(payload.call_session_id ? { telnyx_call_id: payload.call_session_id } : {}),
      };
      const { data: linkedHang, error: lhErr } = await supabase
        .from('calls')
        .update(linkHang)
        .eq('id', rowId)
        .select('contact_id, duration, disposition_name, direction, caller_id_used, organization_id, agent_id')
        .maybeSingle();
      if (lhErr) {
        console.error(`[handleCallHangup] client_state hangup link failed for ${rowId}:`, lhErr);
      } else {
        callRecord = linkedHang;
        if (linkedHang) console.log(`[handleCallHangup] Applied hangup via client_state row ${rowId}`);
      }
    }
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
      activity_type: 'call',
      description: `${directionLabel} call — ${durationFormatted}${dispositionLabel}`,
      organization_id: callRecord.organization_id ?? null,
      agent_id: callRecord.agent_id ?? null,
      created_at: new Date().toISOString(),
    };

    const { error: activityError } = await supabase.from('contact_activities').insert(activityData);
    if (activityError) {
      console.error(`Error inserting activity for contact ${callRecord.contact_id}:`, activityError, 'Payload:', activityData);
    }
  }
}

// handleHumanDetected removed — one-legged WebRTC calling eliminates the need for
// server-side agent bridging. Recording is now started directly in handleCallAnswered.

// Handler: call.recording.saved
async function handleRecordingSaved(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;
  const recordingUrl = extractRecordingDownloadUrl(payload);

  console.log('Recording saved:', { callControlId, callSessionId, recordingUrl: recordingUrl ?? null });

  if (!recordingUrl) {
    console.warn('[handleRecordingSaved] No downloadable recording URL in payload keys:', Object.keys(payload || {}));
    return;
  }

  const patch = { recording_url: recordingUrl, updated_at: new Date().toISOString() };

  if (callControlId) {
    const { data: byControl, error: errControl } = await supabase
      .from('calls')
      .update(patch)
      .eq('telnyx_call_control_id', callControlId)
      .select('id')
      .maybeSingle();

    if (errControl) {
      console.error(`Error saving recording URL for control_id ${callControlId}:`, errControl);
    } else if (byControl?.id) {
      return;
    }
  }

  const rowId = decodeCallsRowIdFromPayload(payload);
  if (rowId) {
    const { data: byRow, error: errRow } = await supabase
      .from('calls')
      .update(patch)
      .eq('id', rowId)
      .select('id')
      .maybeSingle();
    if (errRow) {
      console.error(`Error saving recording URL for calls.id ${rowId}:`, errRow);
    } else if (byRow?.id) {
      return;
    }
  }

  if (callSessionId) {
    const { error: errSession } = await supabase
      .from('calls')
      .update(patch)
      .eq('telnyx_call_id', callSessionId);

    if (errSession) {
      console.error(`Error saving recording URL for session_id ${callSessionId}:`, errSession);
    }
  } else if (!callControlId && !rowId) {
    console.warn('[handleRecordingSaved] No call_control_id, client_state row id, or call_session_id; cannot attach recording.');
  }
}
