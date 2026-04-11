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

      case 'call.playback.ended':
        await handleInboundPlaybackEnded(supabase, payload);
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
    // No UUID provided.
    // Inbound PSTN calls never carry a client_state — hand off to the inbound router.
    if (payload.direction === 'inbound') {
      // Is this a fork leg we originated? Those use client_state "fork:<parent_call_id>"
      // and are handled by the fork-leg handlers in call.answered / call.hangup.
      const rawCs = typeof payload.client_state === 'string' ? decodeClientState(payload.client_state) : null;
      if (rawCs && rawCs.startsWith('fork:')) {
        console.log(`[call.initiated] Fork leg initiated: ${payload.call_control_id} (${rawCs})`);
        return;
      }
      console.log(`[call.initiated] Inbound PSTN call to ${payload.to} from ${payload.from} — routing`);
      await handleInboundCall(supabase, payload);
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

  // ─── Inbound fork-leg winner: bridge to parent, kill siblings ───
  const winnerForkLeg = await tryHandleForkLegAnswered(supabase, payload);
  if (winnerForkLeg) return;

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

  // ─── Inbound fork-leg losing/failing: mark dead, fall back to voicemail if all legs failed ───
  const wasForkLeg = await tryHandleForkLegHangup(supabase, payload);
  if (wasForkLeg) return;

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

  // ─── Voicemail first: if this recording belongs to a voicemails row, patch it and return ───
  if (callControlId) {
    const durationSeconds = payload?.recording_duration_millis
      ? Math.round(Number(payload.recording_duration_millis) / 1000)
      : (payload?.duration_millis ? Math.round(Number(payload.duration_millis) / 1000) : null);

    const { data: vm, error: vmErr } = await supabase
      .from('voicemails')
      .update({
        recording_url: recordingUrl,
        ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
      })
      .eq('telnyx_call_control_id', callControlId)
      .select('id')
      .maybeSingle();

    if (vmErr) {
      console.error(`[handleRecordingSaved] voicemails patch error for ${callControlId}:`, vmErr);
    } else if (vm?.id) {
      console.log(`[handleRecordingSaved] Voicemail ${vm.id} updated with recording`);
      return;
    }
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

// ════════════════════════════════════════════════════════════════════════════
//   INBOUND CALLING SYSTEM — Server-side Call Control routing
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture: inbound PSTN calls arrive on Telnyx numbers routed to our
// Call Control Application. This webhook answers/transfers/forks to agent
// WebRTC SIP URIs (sip:{profile.sip_username}@sip.telnyx.com). Outbound
// one-legged WebRTC is unaffected — it bypasses this entire section.
//
// Routing priority (matches InboundCallRouting spec):
//   1. Match called number → organization_id (phone_numbers)
//   2. Match caller number → lead (leads, same org)
//   3. Apply contacts_only gate → org voicemail if unknown
//   4. Assigned agent online → single direct transfer
//   5. Assigned agent offline + forwarding on → PSTN forward
//   6. Assigned agent offline + no forwarding → personal voicemail
//   7. No assigned / no lead match → fork to all online agents (race)
//   8. Zero online agents anywhere → org voicemail
//
// Fork implementation: answer parent, originate N outbound legs via POST
// /v2/calls, tag each leg with client_state "fork:<parent_calls_id>", on
// first fork leg answered → bridge to parent + hang up siblings.
// ════════════════════════════════════════════════════════════════════════════

const ONLINE_WINDOW_SECONDS = 300;       // 5 min presence window
const FORK_RING_TIMEOUT_MS = 25000;      // per-fork ring timeout (Telnyx)
const VOICEMAIL_MAX_LENGTH_SEC = 120;    // 2-min voicemail cap
const TELNYX_V2 = 'https://api.telnyx.com/v2';

// ─── Telnyx Call Control helpers (v2) ───

async function telnyxPost(apiKey: string, path: string, body: any): Promise<any | null> {
  try {
    const resp = await fetch(`${TELNYX_V2}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[telnyxPost] ${path} → ${resp.status}: ${errText}`);
      return null;
    }
    return await resp.json().catch(() => ({}));
  } catch (err) {
    console.error(`[telnyxPost] EXCEPTION on ${path}:`, err);
    return null;
  }
}

async function telnyxAnswer(apiKey: string, controlId: string): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${controlId}/actions/answer`, {});
  return r != null;
}

async function telnyxTransferToSip(
  apiKey: string,
  controlId: string,
  sipUri: string,
  timeoutSecs: number,
): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${controlId}/actions/transfer`, {
    to: sipUri,
    timeout_secs: timeoutSecs,
  });
  return r != null;
}

async function telnyxTransferToPstn(
  apiKey: string,
  controlId: string,
  pstnE164: string,
  fromE164: string,
  timeoutSecs: number,
): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${controlId}/actions/transfer`, {
    to: pstnE164,
    from: fromE164,
    timeout_secs: timeoutSecs,
  });
  return r != null;
}

async function telnyxDial(
  apiKey: string,
  connectionId: string,
  to: string,
  from: string,
  clientState: string,
  timeoutSecs: number,
): Promise<string | null> {
  const r = await telnyxPost(apiKey, '/calls', {
    connection_id: connectionId,
    to,
    from,
    client_state: btoa(clientState),
    timeout_secs: timeoutSecs,
  });
  return r?.data?.call_control_id ?? null;
}

async function telnyxBridge(apiKey: string, legA: string, legB: string): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${legA}/actions/bridge`, { call_control_id: legB });
  return r != null;
}

async function telnyxHangup(apiKey: string, controlId: string): Promise<void> {
  await telnyxPost(apiKey, `/calls/${controlId}/actions/hangup`, {});
}

async function telnyxPlaybackStart(apiKey: string, controlId: string, audioUrl: string): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${controlId}/actions/playback_start`, {
    audio_url: audioUrl,
  });
  return r != null;
}

async function telnyxRecordVoicemail(apiKey: string, controlId: string): Promise<boolean> {
  const r = await telnyxPost(apiKey, `/calls/${controlId}/actions/record_start`, {
    format: 'mp3',
    channels: 'single',
    play_beep: true,
    max_length: VOICEMAIL_MAX_LENGTH_SEC,
  });
  return r != null;
}

// ─── Telnyx connection id lookup (for fork dial) ───

async function getTelnyxConnectionId(supabase: any, organizationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('telnyx_settings')
    .select('connection_id')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    console.error(`[getTelnyxConnectionId] org ${organizationId}:`, error);
  }
  if (data?.connection_id) return data.connection_id;
  const { data: global } = await supabase
    .from('telnyx_settings')
    .select('connection_id')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  return global?.connection_id ?? null;
}

// ─── Presence: list online agents for an org ───

async function getOnlineAgents(
  supabase: any,
  organizationId: string,
): Promise<Array<{ id: string; sip_username: string | null; call_forwarding_enabled: boolean; call_forwarding_number: string | null }>> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, sip_username, call_forwarding_enabled, call_forwarding_number, inbound_enabled, last_seen_at')
    .eq('organization_id', organizationId)
    .eq('inbound_enabled', true)
    .gt('last_seen_at', cutoff);
  if (error) {
    console.error(`[getOnlineAgents] org ${organizationId}:`, error);
    return [];
  }
  return (data || []).filter((p: any) => !!p.sip_username);
}

// ─── Main inbound router ───

async function handleInboundCall(supabase: any, payload: any) {
  const to = payload.to;
  const from = payload.from;
  const parentControlId = payload.call_control_id;

  // 1. Organization lookup
  const { data: phoneRow, error: phoneErr } = await supabase
    .from('phone_numbers')
    .select('organization_id, assigned_to')
    .eq('phone_number', to)
    .maybeSingle();
  if (phoneErr) console.error('[handleInboundCall] phone_numbers lookup:', phoneErr);
  const organizationId: string | null = phoneRow?.organization_id ?? null;

  if (!organizationId) {
    console.warn(`[handleInboundCall] No org found for ${to}; inserting bare record and aborting routing`);
    await supabase.from('calls').insert({
      direction: 'inbound',
      caller_id_used: from,
      status: 'ringing',
      telnyx_call_control_id: parentControlId,
      telnyx_call_id: payload.call_session_id,
      created_at: new Date().toISOString(),
    });
    return;
  }

  // 2. Lead lookup by caller number
  const { data: lead } = await supabase
    .from('leads')
    .select('id, assigned_agent_id, first_name, last_name')
    .eq('phone', from)
    .eq('organization_id', organizationId)
    .maybeSingle();

  // 3. Inbound routing settings
  const { data: settings } = await supabase
    .from('inbound_routing_settings')
    .select('contacts_only, voicemail_greeting_url, ring_timeout_seconds')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const ringTimeout = settings?.ring_timeout_seconds ?? 30;

  // 4. Create parent calls row (always — tracks the inbound leg end-to-end)
  const { data: callRow, error: callErr } = await supabase
    .from('calls')
    .insert({
      direction: 'inbound',
      caller_id_used: from,
      status: 'ringing',
      telnyx_call_control_id: parentControlId,
      telnyx_call_id: payload.call_session_id,
      contact_id: lead?.id ?? null,
      organization_id: organizationId,
      agent_id: lead?.assigned_agent_id ?? null,
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();
  if (callErr) {
    console.error('[handleInboundCall] calls insert failed:', callErr);
    return;
  }
  const parentCallId = callRow?.id;
  if (!parentCallId) return;

  const apiKey = await getTelnyxApiKey(supabase, organizationId);
  if (!apiKey) {
    console.error(`[handleInboundCall] no Telnyx API key for org ${organizationId}`);
    return;
  }

  // 5. Contacts-only gate
  if (settings?.contacts_only && !lead) {
    console.log(`[handleInboundCall] contacts_only=true and unknown caller — sending to org voicemail`);
    await startVoicemailFlow(supabase, apiKey, parentControlId, parentCallId, {
      organizationId,
      agentId: null,
      contactId: null,
      callerNumber: from,
      greetingUrl: settings?.voicemail_greeting_url ?? null,
    });
    return;
  }

  // 6. Assigned-agent routing
  if (lead?.assigned_agent_id) {
    const { data: agent } = await supabase
      .from('profiles')
      .select('id, sip_username, last_seen_at, call_forwarding_enabled, call_forwarding_number, inbound_enabled')
      .eq('id', lead.assigned_agent_id)
      .maybeSingle();

    const agentOnline = agent
      && agent.inbound_enabled !== false
      && agent.last_seen_at
      && (Date.now() - new Date(agent.last_seen_at).getTime()) < ONLINE_WINDOW_SECONDS * 1000;

    if (agentOnline && agent?.sip_username) {
      console.log(`[handleInboundCall] direct transfer → agent ${agent.id}`);
      await telnyxTransferToSip(apiKey, parentControlId, `sip:${agent.sip_username}@sip.telnyx.com`, ringTimeout);
      return;
    }

    if (agent?.call_forwarding_enabled && agent.call_forwarding_number) {
      console.log(`[handleInboundCall] agent offline — forwarding to ${agent.call_forwarding_number}`);
      await telnyxTransferToPstn(apiKey, parentControlId, agent.call_forwarding_number, to, ringTimeout);
      return;
    }

    console.log(`[handleInboundCall] agent offline — personal voicemail for ${lead.assigned_agent_id}`);
    await startVoicemailFlow(supabase, apiKey, parentControlId, parentCallId, {
      organizationId,
      agentId: lead.assigned_agent_id,
      contactId: lead.id,
      callerNumber: from,
      greetingUrl: settings?.voicemail_greeting_url ?? null,
    });
    return;
  }

  // 7. Fork to all online agents
  const agents = await getOnlineAgents(supabase, organizationId);
  if (agents.length === 0) {
    console.log('[handleInboundCall] no online agents — org voicemail');
    await startVoicemailFlow(supabase, apiKey, parentControlId, parentCallId, {
      organizationId,
      agentId: null,
      contactId: lead?.id ?? null,
      callerNumber: from,
      greetingUrl: settings?.voicemail_greeting_url ?? null,
    });
    return;
  }

  if (agents.length === 1) {
    const a = agents[0];
    console.log(`[handleInboundCall] single online agent → direct transfer ${a.id}`);
    await telnyxTransferToSip(apiKey, parentControlId, `sip:${a.sip_username}@sip.telnyx.com`, ringTimeout);
    return;
  }

  // Simultaneous fork
  const connectionId = await getTelnyxConnectionId(supabase, organizationId);
  if (!connectionId) {
    console.error('[handleInboundCall] no Telnyx connection_id — falling back to single transfer');
    await telnyxTransferToSip(apiKey, parentControlId, `sip:${agents[0].sip_username}@sip.telnyx.com`, ringTimeout);
    return;
  }

  console.log(`[handleInboundCall] forking to ${agents.length} agents`);
  await telnyxAnswer(apiKey, parentControlId);

  for (const a of agents) {
    const clientState = `fork:${parentCallId}`;
    const legId = await telnyxDial(
      apiKey,
      connectionId,
      `sip:${a.sip_username}@sip.telnyx.com`,
      to,
      clientState,
      Math.min(ringTimeout, Math.floor(FORK_RING_TIMEOUT_MS / 1000)),
    );
    if (!legId) {
      console.warn(`[handleInboundCall] fork dial failed for agent ${a.id}`);
      continue;
    }
    await supabase.from('inbound_fork_legs').insert({
      parent_call_id: parentCallId,
      parent_control_id: parentControlId,
      leg_control_id: legId,
      agent_id: a.id,
      organization_id: organizationId,
      status: 'dialing',
    });
  }
}

// ─── Voicemail flow: playback greeting (optional) → record → insert row ───

interface VoicemailParams {
  organizationId: string;
  agentId: string | null;
  contactId: string | null;
  callerNumber: string;
  greetingUrl: string | null;
}

async function startVoicemailFlow(
  supabase: any,
  apiKey: string,
  parentControlId: string,
  parentCallId: string,
  params: VoicemailParams,
) {
  // Insert voicemails row immediately so handleRecordingSaved can match by control_id.
  const { error: vmInsertErr } = await supabase.from('voicemails').insert({
    organization_id: params.organizationId,
    agent_id: params.agentId,
    contact_id: params.contactId,
    caller_number: params.callerNumber,
    telnyx_call_control_id: parentControlId,
  });
  if (vmInsertErr) {
    console.error('[startVoicemailFlow] voicemails insert error:', vmInsertErr);
  }

  // Mark the parent calls row as routed to voicemail.
  await supabase
    .from('calls')
    .update({ status: 'voicemail', updated_at: new Date().toISOString() })
    .eq('id', parentCallId);

  // Answer the call so we can interact with it (playback/record).
  await telnyxAnswer(apiKey, parentControlId);

  if (params.greetingUrl) {
    // playback_start → wait for call.playback.ended → record_start
    const ok = await telnyxPlaybackStart(apiKey, parentControlId, params.greetingUrl);
    if (ok) return;
    console.warn('[startVoicemailFlow] playback_start failed; recording immediately');
  }

  // No greeting (or playback failed) — start recording right away.
  await telnyxRecordVoicemail(apiKey, parentControlId);
}

// Handler: call.playback.ended — chain into voicemail recording
async function handleInboundPlaybackEnded(supabase: any, payload: any) {
  const controlId = payload.call_control_id;
  if (!controlId) return;

  // Only voicemail flows care about playback.ended.
  const { data: vm } = await supabase
    .from('voicemails')
    .select('id, organization_id')
    .eq('telnyx_call_control_id', controlId)
    .maybeSingle();
  if (!vm) {
    console.log(`[playback.ended] no matching voicemail for ${controlId}; ignoring`);
    return;
  }

  const apiKey = await getTelnyxApiKey(supabase, vm.organization_id);
  if (!apiKey) return;
  await telnyxRecordVoicemail(apiKey, controlId);
}

// ─── Fork-leg: answered → bridge + kill siblings ───

async function tryHandleForkLegAnswered(supabase: any, payload: any): Promise<boolean> {
  const legId = payload.call_control_id;
  if (!legId) return false;

  const { data: leg, error: legErr } = await supabase
    .from('inbound_fork_legs')
    .select('id, parent_call_id, parent_control_id, agent_id, organization_id, status')
    .eq('leg_control_id', legId)
    .maybeSingle();
  if (legErr) {
    console.error('[tryHandleForkLegAnswered] lookup error:', legErr);
    return false;
  }
  if (!leg) return false;

  console.log(`[fork.winner] leg ${legId} answered by agent ${leg.agent_id}`);

  // Mark this leg the winner.
  await supabase
    .from('inbound_fork_legs')
    .update({ status: 'answered' })
    .eq('id', leg.id);

  const apiKey = await getTelnyxApiKey(supabase, leg.organization_id);
  if (!apiKey) return true;

  // Bridge the winning leg to the parent inbound leg.
  await telnyxBridge(apiKey, leg.parent_control_id, legId);

  // Patch parent calls row to "connected" and set the winning agent.
  await supabase
    .from('calls')
    .update({
      status: 'connected',
      agent_id: leg.agent_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leg.parent_call_id);

  // Hang up every other sibling leg that is still dialing/ringing.
  const { data: siblings } = await supabase
    .from('inbound_fork_legs')
    .select('id, leg_control_id')
    .eq('parent_call_id', leg.parent_call_id)
    .neq('id', leg.id)
    .in('status', ['dialing']);

  for (const s of siblings || []) {
    console.log(`[fork.cancel] hanging up sibling leg ${s.leg_control_id}`);
    await telnyxHangup(apiKey, s.leg_control_id);
    await supabase
      .from('inbound_fork_legs')
      .update({ status: 'cancelled' })
      .eq('id', s.id);
  }

  // Start recording the bridged parent leg if org has recording enabled.
  try {
    const recOn = await isRecordingEnabled(supabase, leg.organization_id);
    if (recOn) {
      await telnyxRecordStart(apiKey, leg.parent_control_id);
    }
  } catch (err) {
    console.error('[fork.winner] recording start failed (non-fatal):', err);
  }

  return true;
}

// ─── Fork-leg: hangup (dead leg, no-answer, or timeout) ───
// If every leg has died without a winner, fall back to org voicemail.

async function tryHandleForkLegHangup(supabase: any, payload: any): Promise<boolean> {
  const legId = payload.call_control_id;
  if (!legId) return false;

  const { data: leg } = await supabase
    .from('inbound_fork_legs')
    .select('id, parent_call_id, parent_control_id, organization_id, status')
    .eq('leg_control_id', legId)
    .maybeSingle();
  if (!leg) return false;

  // Winner leg hanging up after a bridge is normal — don't escalate.
  if (leg.status === 'answered') {
    await supabase
      .from('inbound_fork_legs')
      .update({ status: 'completed' })
      .eq('id', leg.id);
    return true;
  }

  await supabase
    .from('inbound_fork_legs')
    .update({ status: 'failed' })
    .eq('id', leg.id);

  // Any sibling still dialing or already answered? If yes, let them play out.
  const { data: survivors } = await supabase
    .from('inbound_fork_legs')
    .select('id, status')
    .eq('parent_call_id', leg.parent_call_id)
    .in('status', ['dialing', 'answered']);

  if (survivors && survivors.length > 0) {
    console.log(`[fork.hangup] leg ${legId} failed; ${survivors.length} siblings still live`);
    return true;
  }

  // All fork legs exhausted — send parent to org voicemail.
  console.log(`[fork.exhausted] all legs failed for parent ${leg.parent_call_id}; routing to org voicemail`);

  const { data: parentCall } = await supabase
    .from('calls')
    .select('id, contact_id, caller_id_used, telnyx_call_control_id, status')
    .eq('id', leg.parent_call_id)
    .maybeSingle();

  if (!parentCall || parentCall.status === 'completed' || parentCall.status === 'voicemail') {
    return true;
  }

  const { data: settings } = await supabase
    .from('inbound_routing_settings')
    .select('voicemail_greeting_url')
    .eq('organization_id', leg.organization_id)
    .maybeSingle();

  const apiKey = await getTelnyxApiKey(supabase, leg.organization_id);
  if (!apiKey) return true;

  await startVoicemailFlow(supabase, apiKey, leg.parent_control_id, leg.parent_call_id, {
    organizationId: leg.organization_id,
    agentId: null,
    contactId: parentCall.contact_id,
    callerNumber: parentCall.caller_id_used,
    greetingUrl: settings?.voicemail_greeting_url ?? null,
  });

  return true;
}
