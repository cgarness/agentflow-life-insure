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

/** Telnyx uses `incoming`/`outgoing` in some webhooks; we store `inbound`/`outbound` for RLS + `inbound-call-claim`. */
function normalizeStoredCallDirection(payload: { direction?: unknown }): 'inbound' | 'outbound' {
  const d = payload?.direction;
  if (d === 'inbound' || d === 'incoming') return 'inbound';
  if (d === 'outbound' || d === 'outgoing') return 'outbound';
  return 'outbound';
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

/** Raw Ed25519 public key is 32 bytes. Mission Control may show hex (64 chars) or base64. */
function decodeTelnyxEd25519PublicKey(raw: string): Uint8Array | null {
  let s = raw.trim().replace(/\s+/g, '').replace(/:/g, '');
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  if (/^[0-9a-fA-F]+$/.test(s) && s.length === 64) {
    try {
      return new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    } catch {
      return null;
    }
  }
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
    if (bin.length === 32) return bin;
  } catch {
    /* ignore */
  }
  return null;
}

// ─── Helper: Verify Telnyx Ed25519 webhook signature ───
async function verifyTelnyxSignature(req: Request, rawBody: string): Promise<boolean> {
  const telnyxPublicKey = Deno.env.get('TELNYX_PUBLIC_KEY');
  if (!telnyxPublicKey) {
    console.warn('[SECURITY] TELNYX_PUBLIC_KEY not configured — skipping signature verification. Set this secret ASAP.');
    return true; // Fail-open during initial deployment; close once key is set
  }

  const signature =
    req.headers.get('telnyx-signature-ed25519') ||
    req.headers.get('Telnyx-Signature-Ed25519');
  const timestamp = req.headers.get('telnyx-timestamp') || req.headers.get('Telnyx-Timestamp');

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

    const publicKeyBytes = decodeTelnyxEd25519PublicKey(telnyxPublicKey);
    if (!publicKeyBytes) {
      console.error(
        '[SECURITY] TELNYX_PUBLIC_KEY invalid format (expect 64 hex chars or base64 of 32 raw bytes). Skipping verification like an unset key — fix or remove this secret.',
      );
      return true;
    }

    // Import the Ed25519 public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    // Decode the base64-encoded signature
    const signatureBytes = Uint8Array.from(atob(signature.trim()), (c) => c.charCodeAt(0));

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

/**
 * Map Telnyx `connection_id` on call.initiated to our org.
 * Mission Control often sends the **Call Control Application** id (stored as `call_control_app_id`)
 * rather than the WebRTC **Credential Connection** id (`connection_id`) — match either.
 */
async function resolveOrganizationIdFromConnection(supabase: any, connectionId: unknown): Promise<string | null> {
  if (!connectionId || typeof connectionId !== 'string') return null;
  const cid = connectionId.trim();
  if (!cid) return null;

  const { data, error } = await supabase
    .from('telnyx_settings')
    .select('organization_id')
    .or(`connection_id.eq.${cid},call_control_app_id.eq.${cid}`)
    .maybeSingle();

  if (error) {
    console.warn('[call.initiated] connection_id / call_control_app_id org lookup failed:', error.message);
    return null;
  }
  return data?.organization_id ?? null;
}

/** Inbound DID → org via `phone_numbers` (webhook uses service role — not subject to RLS). */
async function resolveOrganizationIdFromInboundTo(supabase: any, toField: unknown): Promise<string | null> {
  if (!toField || typeof toField !== 'string') return null;
  const raw = toField.trim();
  if (!raw) return null;

  const candidates = new Set<string>([raw]);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    candidates.add(`+1${digits}`);
    candidates.add(`1${digits}`);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    candidates.add(`+${digits}`);
  }

  for (const num of candidates) {
    const { data, error } = await supabase
      .from('phone_numbers')
      .select('organization_id')
      .eq('phone_number', num)
      .maybeSingle();
    if (error) {
      console.warn('[call.initiated] phone_numbers org lookup failed:', num, error.message);
      continue;
    }
    if (data?.organization_id) return data.organization_id as string;
  }
  return null;
}

// ─── Helper: start call recording via Telnyx REST API ───
/**
 * Inbound → WebRTC: `POST /v2/calls` to `sip:{user}@sip.telnyx.com` must use the **same**
 * SIP Connection UUID the browser registers with (Credential Connection / `connection_id`).
 * Using `call_control_app_id` here often yields “answered” legs with **no audio**.
 * @see https://developers.telnyx.com/docs/voice/webrtc/architecture
 */
async function getTelnyxSipBridgeSettings(
  supabase: any,
  organizationId?: string | null,
): Promise<{
  api_key: string;
  /** WebRTC Credential Connection UUID — preferred for Dial to sip:user@sip.telnyx.com */
  credential_connection_id: string | null;
  /** Call Control Application UUID — retry if Dial fails with credential id */
  call_control_connection_id: string | null;
  settings_sip_username: string | null;
} | null> {
  const pick = (data: any) => {
    if (!data?.api_key) return null;
    const app = typeof data.call_control_app_id === 'string' ? data.call_control_app_id.trim() : '';
    const cred = typeof data.connection_id === 'string' ? data.connection_id.trim() : '';
    if (!cred && app) {
      console.warn(
        '[inbound-bridge] `connection_id` (WebRTC credential UUID) is empty — Dial will try Call Control app id only. Set telnyx_settings.connection_id to match telnyx-token.',
      );
    }
    if (!cred && !app) return null;
    const su = typeof data.sip_username === 'string' ? data.sip_username.trim() : '';
    return {
      api_key: data.api_key as string,
      credential_connection_id: cred || null,
      call_control_connection_id: app || null,
      settings_sip_username: su || null,
    };
  };

  if (organizationId) {
    const { data, error } = await supabase
      .from('telnyx_settings')
      .select('api_key, sip_username, connection_id, call_control_app_id')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) {
      console.warn('[inbound-bridge] org telnyx_settings lookup failed:', error.message);
    }
    const row = pick(data);
    if (row) return row;
  }
  const { data: global, error: globalError } = await supabase
    .from('telnyx_settings')
    .select('api_key, sip_username, connection_id, call_control_app_id')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();
  if (globalError) {
    console.warn('[inbound-bridge] global telnyx_settings lookup failed:', globalError.message);
  }
  return pick(global) ?? null;
}

/**
 * SIP user the browser actually registers as (from `telnyx-token` → `profiles.sip_username`, e.g. gencred…).
 * When several agents exist, the old “ambiguous → telnyx_settings.sip_username” path dialed the WRONG user
 * (no INVITE in browser, PSTN answered + silence).
 */
async function resolveInboundWebRtcSipTarget(
  supabase: any,
  organizationId: string | null,
  settingsSipHint: string | null,
): Promise<string | null> {
  if (!organizationId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('sip_username, updated_at')
    .eq('organization_id', organizationId)
    .not('sip_username', 'is', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(40);
  if (error) {
    console.warn('[inbound-bridge] profiles sip_username lookup failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as { sip_username?: string }[];
  const ordered = rows
    .map((r) => (typeof r.sip_username === 'string' ? r.sip_username.trim() : ''))
    .filter(Boolean);
  const seen = new Set<string>();
  const uniqueOrdered: string[] = [];
  for (const u of ordered) {
    if (seen.has(u)) continue;
    seen.add(u);
    uniqueOrdered.push(u);
  }
  if (uniqueOrdered.length === 0) return null;
  if (uniqueOrdered.length === 1) {
    console.log('[inbound-bridge] Single WebRTC sip target:', uniqueOrdered[0]);
    return uniqueOrdered[0];
  }
  const hint = typeof settingsSipHint === 'string' ? settingsSipHint.trim() : '';
  if (hint && uniqueOrdered.includes(hint)) {
    console.log('[inbound-bridge] Multi-agent org — using telnyx_settings.sip_username hint:', hint);
    return hint;
  }
  const chosen = uniqueOrdered[0];
  console.warn(
    `[inbound-bridge] Multi-agent org (${uniqueOrdered.length} sip_username values) — dialing most recently updated profile credential: ${chosen}. Others:`,
    uniqueOrdered.slice(1).join(', '),
  );
  return chosen;
}

/**
 * Telnyx requires answering the inbound PSTN leg before other Call Control commands on that leg.
 * Without this, Dial + link_to often never rings the WebRTC client (caller waits then hangs up).
 * @see https://developers.telnyx.com/api-reference/call-commands/answer-call
 */
async function telnyxAnswerInboundLeg(apiKey: string, inboundCallControlId: string): Promise<boolean> {
  const id = encodeURIComponent(inboundCallControlId);
  const url = `https://api.telnyx.com/v2/calls/${id}/actions/answer`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[inbound-bridge] Telnyx answer failed: ${resp.status}`, errText);
      return false;
    }
    console.log('[inbound-bridge] Inbound PSTN leg answered via API; dialing WebRTC SIP next.');
    return true;
  } catch (err) {
    console.error('[inbound-bridge] Telnyx answer exception:', err);
    return false;
  }
}

/**
 * MVP: Telnyx Call Control **Dial** is `POST /v2/calls` (see Telnyx Voice API).
 * Dials the WebRTC SIP URI and links to the inbound PSTN leg via `link_to` + `bridge_on_answer`.
 */
async function telnyxDialBridgeToSipUri(
  apiKey: string,
  inboundCallControlId: string,
  sipUri: string,
  connectionId: string,
  fromE164: string,
  commandId: string,
): Promise<boolean> {
  const url = 'https://api.telnyx.com/v2/calls';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: connectionId,
      to: sipUri,
      from: fromE164,
      link_to: inboundCallControlId,
      bridge_on_answer: true,
      command_id: commandId,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(
      `[inbound-bridge] Telnyx Dial failed (${connectionId.slice(0, 8)}…): ${resp.status}`,
      errText,
    );
    return false;
  }
  try {
    const j = await resp.json();
    const id = j?.data?.call_control_id ?? j?.data?.id;
    console.log('[inbound-bridge] Dial OK → WebRTC leg', { sipUri, connectionSlice: connectionId.slice(0, 8), callControlId: id });
  } catch {
    console.log('[inbound-bridge] Dial OK (no JSON body)', inboundCallControlId);
  }
  return true;
}

async function mvpBridgeInboundToWebRtcSip(
  supabase: any,
  opts: {
    organizationId: string | null | undefined;
    inboundCallControlId: string;
    callSessionId: string | null | undefined;
    agencyDid: string | null | undefined;
  },
): Promise<void> {
  const { organizationId, inboundCallControlId, callSessionId, agencyDid } = opts;
  if (!agencyDid) {
    console.warn('[inbound-bridge] Missing payload.to (agency DID); skip bridge.');
    return;
  }
  const settings = await getTelnyxSipBridgeSettings(supabase, organizationId ?? null);
  if (!settings) {
    console.warn('[inbound-bridge] No telnyx_settings with api_key + at least one connection id; skip bridge.');
    return;
  }

  const fromProfile = await resolveInboundWebRtcSipTarget(
    supabase,
    organizationId ?? null,
    settings.settings_sip_username,
  );
  const sipLocalPart = fromProfile ?? settings.settings_sip_username ?? null;

  if (!sipLocalPart) {
    console.warn(
      '[inbound-bridge] No SIP target — profiles.sip_username empty and telnyx_settings.sip_username empty. Open AgentFlow once so telnyx-token can save your gencred sip_username to your profile.',
    );
    return;
  }
  if (!fromProfile && settings.settings_sip_username) {
    console.warn(
      '[inbound-bridge] Using telnyx_settings.sip_username only (no profile rows). Prefer logging in once so profile.sip_username matches your WebRTC credential.',
    );
  }

  const sipUri = `sip:${sipLocalPart}@sip.telnyx.com`;
  const commandId = `agentflow-mvp-bridge-${callSessionId || inboundCallControlId}`;

  const answered = await telnyxAnswerInboundLeg(settings.api_key, inboundCallControlId);
  if (!answered) {
    console.warn('[inbound-bridge] Skipping WebRTC dial — inbound answer failed (Telnyx prerequisite).');
    return;
  }

  const connectionAttempts = [
    settings.call_control_connection_id, // MUST be first for POST /v2/calls
    settings.credential_connection_id,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  const uniqueConnections = [...new Set(connectionAttempts)];

  if (uniqueConnections.length === 0) {
    console.warn('[inbound-bridge] No connection_id / call_control_app_id to originate Dial; skip.');
    return;
  }

  let dialOk = false;
  for (const conn of uniqueConnections) {
    dialOk = await telnyxDialBridgeToSipUri(
      settings.api_key,
      inboundCallControlId,
      sipUri,
      conn,
      agencyDid,
      `${commandId}-${conn.slice(0, 8)}`,
    );
    if (dialOk) break;
  }
  if (!dialOk) {
    console.error('[inbound-bridge] All Dial attempts failed — browser will not ring.', { sipUri });
  }
}

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

  const direction = normalizeStoredCallDirection(payload);

  console.log('Call initiated details:', {
    callSessionId: payload.call_session_id,
    callControlId: payload.call_control_id,
    directionRaw: payload.direction,
    directionStored: direction,
    decodedClientState,
  });

  const callData: any = {
    telnyx_call_id: payload.call_session_id, // Session ID
    telnyx_call_control_id: payload.call_control_id, // Granular Control ID
    direction,
    caller_id_used: payload.from,
    status: 'ringing',
    updated_at: new Date().toISOString(),
  };

  // Inbound rows often had null started_at → Recent / timelines sorted wrong or looked "empty".
  if (direction === 'inbound') {
    const st = typeof payload.start_time === 'string' ? payload.start_time.trim() : '';
    callData.started_at = st || new Date().toISOString();
  }

  let orgFromConnection = await resolveOrganizationIdFromConnection(supabase, payload.connection_id);
  if (!orgFromConnection && direction === 'inbound') {
    orgFromConnection = await resolveOrganizationIdFromInboundTo(supabase, payload.to);
  }
  if (orgFromConnection) {
    callData.organization_id = orgFromConnection;
  }
  if (direction === 'inbound' && payload.from) {
    callData.contact_phone = payload.from;
  }

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
    if (direction === 'inbound') {
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

  // MVP: PSTN inbound → dial WebRTC SIP leg and bridge when the agent answers (Telnyx POST /v2/calls).
  if (direction === 'inbound' && payload.call_control_id) {
    void mvpBridgeInboundToWebRtcSip(supabase, {
      organizationId: callData.organization_id,
      inboundCallControlId: payload.call_control_id,
      callSessionId: payload.call_session_id,
      agencyDid: typeof payload.to === 'string' ? payload.to.trim() : null,
    });
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

  // WebRTC / ordering: control_id may not match the row yet; session id is stable on call.initiated.
  if (!callRecord && payload.call_session_id) {
    const { data: bySession, error: sessErr } = await supabase
      .from('calls')
      .update(hangPatch)
      .eq('telnyx_call_id', payload.call_session_id)
      .select('contact_id, duration, disposition_name, direction, caller_id_used, organization_id, agent_id')
      .maybeSingle();
    if (sessErr) {
      console.error(`[handleCallHangup] session_id hangup failed:`, sessErr);
    } else if (bySession) {
      callRecord = bySession;
      console.log(`[handleCallHangup] Applied hangup via telnyx_call_id ${payload.call_session_id}`);
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
    const directionLabel =
      callRecord.direction === 'inbound' || callRecord.direction === 'incoming' ? 'Inbound' : 'Outbound';
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
