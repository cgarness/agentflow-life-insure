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

      case 'call.machine.detection.ended':
        await handleAMDResult(supabase, body.data.payload);
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

// Handler: call.initiated
async function handleCallInitiated(supabase: any, payload: any) {
  console.log('Call initiated:', {
    callControlId: payload.call_control_id,
    from: payload.from,
    to: payload.to,
    direction: payload.direction,
  });

  const { error } = await supabase.from('calls').insert({
    telnyx_call_id: payload.call_control_id,
    direction: payload.direction,
    caller_id_used: payload.from,
    status: 'ringing',
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error creating call record:', error);
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

// Handler: call.machine.detection.ended
async function handleAMDResult(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const amdResult = payload.result; // 'human' | 'machine' | 'not_sure'

  console.log('AMD result:', { callControlId, amdResult });

  const { error } = await supabase
    .from('calls')
    .update({ amd_result: amdResult })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating AMD result:', error);
  }

  // If machine detected, check if AMD is enabled in phone_settings
  if (amdResult === 'machine') {
    const { data: settings } = await supabase
      .from('phone_settings')
      .select('amd_enabled')
      .limit(1)
      .single();

    if (settings?.amd_enabled) {
      // The frontend handles the actual hang up via the telnyx.notification event
      // Log that machine was detected — frontend will auto-dispose and advance
      await supabase
        .from('calls')
        .update({ status: 'completed', amd_result: 'machine' })
        .eq('telnyx_call_id', callControlId);
    }
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
