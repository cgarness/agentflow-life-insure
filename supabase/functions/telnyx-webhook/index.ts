import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
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
    // Initialize Supabase client with service role key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse webhook payload
    const payload = await req.json();
    const eventType = payload.data?.event_type;

    console.log('Telnyx webhook received:', eventType);

    // Handle different event types
    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, payload.data.payload);
        break;

      case 'call.answered':
        await handleCallAnswered(supabase, payload.data.payload);
        break;

      case 'call.hangup':
        await handleCallHangup(supabase, payload.data.payload);
        break;

      case 'call.machine.detection.ended':
        await handleAMDResult(supabase, payload.data.payload);
        break;

      case 'call.recording.saved':
        await handleRecordingSaved(supabase, payload.data.payload);
        break;

      default:
        console.log('Unhandled event type:', eventType);
    }

    // Always return 200 OK to Telnyx
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent Telnyx retries
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});

// Handler: call.initiated
async function handleCallInitiated(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const toNumber = payload.to;
  const fromNumber = payload.from;
  const clientState = payload.client_state; // Contains agent_id

  console.log('Call initiated:', { callControlId, toNumber, fromNumber });

  // Create call record with status = 'ringing'
  const { error } = await supabase
    .from('calls')
    .insert({
      telnyx_call_id: callControlId,
      contact_phone: toNumber,
      agent_id: clientState, // agent_id passed via client_state
      direction: 'outbound',
      status: 'ringing',
      caller_id_used: fromNumber,
      started_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Error creating call record:', error);
  }
}

// Handler: call.answered
async function handleCallAnswered(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;

  console.log('Call answered:', callControlId);

  // Update call status to 'connected'
  const { error } = await supabase
    .from('calls')
    .update({ status: 'connected' })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating call to connected:', error);
  }
}

// Handler: call.hangup
async function handleCallHangup(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const hangupCause = payload.hangup_cause;
  const durationSeconds = payload.duration_seconds || 0;

  console.log('Call hangup:', { callControlId, hangupCause, durationSeconds });

  // Determine final status
  const finalStatus = hangupCause === 'normal_clearing' ? 'completed' : 'failed';

  // Update call record
  const { error } = await supabase
    .from('calls')
    .update({
      status: finalStatus,
      ended_at: new Date().toISOString(),
      duration: durationSeconds,
    })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating call on hangup:', error);
  }
}

// Handler: call.machine.detection.ended
async function handleAMDResult(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const amdResult = payload.result; // 'human' or 'machine'

  console.log('AMD result:', { callControlId, amdResult });

  // Update call with AMD result
  const { error } = await supabase
    .from('calls')
    .update({ amd_result: amdResult })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error updating AMD result:', error);
  }

  // If machine detected, auto-disposition as "No Answer - Voicemail"
  // (This will be enhanced later to trigger auto-hang and advance to next lead)
  if (amdResult === 'machine') {
    console.log('Machine detected - will auto-disposition');
    // Future: Call Telnyx API to hang up the call
    // Future: Update disposition in database
    // Future: Emit event to frontend to advance to next lead
  }
}

// Handler: call.recording.saved
async function handleRecordingSaved(supabase: any, payload: any) {
  const callControlId = payload.call_control_id;
  const recordingUrl = payload.recording_urls?.mp3;

  console.log('Recording saved:', { callControlId, recordingUrl });

  if (!recordingUrl) {
    console.warn('No recording URL in payload');
    return;
  }

  // Update call with recording URL
  const { error } = await supabase
    .from('calls')
    .update({ recording_url: recordingUrl })
    .eq('telnyx_call_id', callControlId);

  if (error) {
    console.error('Error saving recording URL:', error);
  }
}
