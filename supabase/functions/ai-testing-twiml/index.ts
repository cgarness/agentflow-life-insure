import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  edgeFunctionUrl,
  twilioFormParams,
  validateTwilioSignatureDebug,
  xmlEscape,
} from "../_shared/aiTestingTwilio.ts";
import {
  buildHypercheapStreamUrl,
  buildInworldStreamUrl,
  buildPipelineStreamUrl,
  buildMonitorStreamUrl,
} from "../_shared/aiTestingBridgeToken.ts";
import { appendDebugLog, loadSession } from "../_shared/aiTestingSession.ts";
import { welcomeGreetingFromLead } from "../_shared/aiTestingPrompt.ts";
import { openaiSipUri } from "../_shared/openaiRealtimeSip.ts";

const FN = "[ai-testing-twiml]";
const twimlHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "text/xml",
};

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response('<?xml version="1.0"?><Response></Response>', { status: 405, headers: twimlHeaders });
  }

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) {
    console.warn(`${FN} missing sessionId on ${req.method} ${req.url}`);
    return new Response(
      '<?xml version="1.0"?><Response><Say>Missing session.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    console.error(`${FN} supabase env missing`);
    return new Response(
      '<?xml version="1.0"?><Response><Say>Server error.</Say></Response>',
      { headers: twimlHeaders },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  await appendDebugLog(supabase, sessionId, "info", "twiml.received", {
    method: req.method,
    url: req.url,
    xForwardedHost: req.headers.get("x-forwarded-host"),
    xForwardedProto: req.headers.get("x-forwarded-proto"),
    host: req.headers.get("host"),
    hasSignature: Boolean(req.headers.get("x-twilio-signature")),
    userAgent: req.headers.get("user-agent"),
  });

  const session = await loadSession(supabase, sessionId);
  if (!session) {
    await appendDebugLog(supabase, sessionId, "error", "twiml.session_not_found", { sessionId });
    return new Response(
      '<?xml version="1.0"?><Response><Say>Session not found.</Say></Response>',
      { headers: twimlHeaders },
    );
  }
  await appendDebugLog(supabase, sessionId, "info", "twiml.session_loaded", {
    stack: session.stack,
    status: session.status,
    twilio_call_sid: session.twilio_call_sid,
  });

  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) {
    await appendDebugLog(supabase, sessionId, "error", "twiml.creds_missing", {
      code: credsResult.code,
    });
    return new Response(
      '<?xml version="1.0"?><Response><Say>Telephony not configured.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const params = req.method === "POST"
    ? await twilioFormParams(req.clone())
    : Object.fromEntries(url.searchParams.entries());

  const sigDebug = await validateTwilioSignatureDebug(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-twiml",
  );
  await appendDebugLog(
    supabase,
    sessionId,
    sigDebug.valid ? "info" : "error",
    "twiml.signature_check",
    {
      valid: sigDebug.valid,
      signingUrl: sigDebug.signingUrl,
      paramKeys: sigDebug.paramKeys,
      receivedSignature: sigDebug.receivedSignature,
      expectedSignature: sigDebug.expectedSignature,
      reason: sigDebug.reason,
      CallSid: params.CallSid,
      CallStatus: params.CallStatus,
    },
  );
  if (!sigDebug.valid) {
    console.warn(`${FN} signature validation failed for session ${sessionId}: ${sigDebug.reason}`);
    return new Response("Forbidden", { status: 403 });
  }

  // Generic greeting fallback when no first_name in lead context — CR with an
  // empty welcomeGreeting waits silently for the caller to speak first, which
  // is wrong on an outbound call.
  const greetingFromLead = welcomeGreetingFromLead(session.lead_context);
  const welcome = (greetingFromLead && greetingFromLead.trim().length > 0
    ? greetingFromLead
    : "Hi, this is your AI agent — how can I help you today?").slice(0, 200);
  const welcomeEscaped = xmlEscape(welcome);

  const interruptibleAttr = (() => {
    switch (session.interruption_sensitivity) {
      case "low": return "none";
      case "high": return "any";
      case "medium":
      default: return "speech";
    }
  })();
  const speechTimeoutMs = session.interruption_sensitivity === "low"
    ? "2000"
    : session.interruption_sensitivity === "high"
    ? "600"
    : "1200";

  let inner = "";

  if (session.stack === "twilio_cr") {
    const relayUrl = edgeFunctionUrl(
      "ai-testing-relay-ws",
      `sessionId=${encodeURIComponent(sessionId)}`,
    ).replace("https://", "wss://");
    const voiceAttr = session.voice_id ? ` voice="${xmlEscape(session.voice_id)}"` : "";
    inner = `<Connect><ConversationRelay url="${xmlEscape(relayUrl)}" welcomeGreeting="${welcomeEscaped}" transcriptionProvider="deepgram" speechModel="nova-2-general" ttsProvider="ElevenLabs"${voiceAttr} language="en-US" interruptible="${interruptibleAttr}" reportInputDuringAgentSpeech="speech" speechTimeout="${speechTimeoutMs}" ignoreBackchannel="false" /></Connect>`;
  } else if (session.stack === "openai_sip") {
    const sipUri = openaiSipUri();
    if (!sipUri) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.openai_project_missing", {});
      return new Response(
        '<?xml version="1.0"?><Response><Say>OpenAI SIP is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    const dialAction = edgeFunctionUrl(
      "ai-testing-status",
      `sessionId=${encodeURIComponent(sessionId)}&dialPhase=1`,
    );
    inner = `<Dial answerOnBridge="true" action="${xmlEscape(dialAction)}" method="POST"><Sip>${xmlEscape(sipUri)}</Sip></Dial>`;
  } else if (session.stack === "openai_realtime") {
    const streamUrl = buildMonitorStreamUrl("/twilio", sessionId);
    if (!streamUrl || !session.bridge_token) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.bridge_url_missing", {
        hasStreamUrl: Boolean(streamUrl),
        hasBridgeToken: Boolean(session.bridge_token),
      });
      return new Response(
        '<?xml version="1.0"?><Response><Say>Voice bridge is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}" track="inbound_track"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="bridgeToken" value="${xmlEscape(session.bridge_token)}" /></Stream></Connect>`;
  } else if (session.stack === "deepgram_voice_agent") {
    const streamUrl = buildMonitorStreamUrl("/twilio/deepgram", sessionId);
    if (!streamUrl || !session.bridge_token) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.bridge_url_missing", {
        hasStreamUrl: Boolean(streamUrl),
        hasBridgeToken: Boolean(session.bridge_token),
      });
      return new Response(
        '<?xml version="1.0"?><Response><Say>Voice bridge is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}" track="inbound_track"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="bridgeToken" value="${xmlEscape(session.bridge_token)}" /></Stream></Connect>`;
  } else if (session.stack === "hypercheap_voice_agent") {
    const streamUrl = buildHypercheapStreamUrl(sessionId);
    if (!streamUrl || !session.bridge_token) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.bridge_url_missing", {
        hasStreamUrl: Boolean(streamUrl),
        hasBridgeToken: Boolean(session.bridge_token),
      });
      return new Response(
        '<?xml version="1.0"?><Response><Say>Voice bridge is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}" track="inbound_track"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="bridgeToken" value="${xmlEscape(session.bridge_token)}" /></Stream></Connect>`;
  } else if (session.stack === "pipeline_voice_agent") {
    const streamUrl = buildPipelineStreamUrl(sessionId);
    if (!streamUrl || !session.bridge_token) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.bridge_url_missing", {
        hasStreamUrl: Boolean(streamUrl),
        hasBridgeToken: Boolean(session.bridge_token),
      });
      return new Response(
        '<?xml version="1.0"?><Response><Say>Voice bridge is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}" track="inbound_track"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="bridgeToken" value="${xmlEscape(session.bridge_token)}" /></Stream></Connect>`;
  } else if (session.stack === "inworld_realtime_agent") {
    const streamUrl = buildInworldStreamUrl(sessionId);
    if (!streamUrl || !session.bridge_token) {
      await appendDebugLog(supabase, sessionId, "error", "twiml.bridge_url_missing", {
        hasStreamUrl: Boolean(streamUrl),
        hasBridgeToken: Boolean(session.bridge_token),
      });
      return new Response(
        '<?xml version="1.0"?><Response><Say>Voice bridge is not configured.</Say></Response>',
        { headers: twimlHeaders },
      );
    }
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}" track="inbound_track"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="bridgeToken" value="${xmlEscape(session.bridge_token)}" /></Stream></Connect>`;
  } else if (session.stack === "xai_s2s") {
    const streamUrl = edgeFunctionUrl(
      "ai-testing-stream-ws",
      `sessionId=${encodeURIComponent(sessionId)}&mode=xai`,
    ).replace("https://", "wss://");
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="mode" value="xai" /></Stream></Connect>`;
  } else {
    await appendDebugLog(supabase, sessionId, "error", "twiml.unknown_stack", {
      stack: session.stack,
    });
    return new Response(
      '<?xml version="1.0"?><Response><Say>Unknown voice stack.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Start><Recording recordingStatusCallback="${xmlEscape(edgeFunctionUrl("ai-testing-recording-status", `sessionId=${encodeURIComponent(sessionId)}`))}" recordingStatusCallbackMethod="POST" /></Start>${inner}</Response>`;

  const twimlReturnEvent = session.stack === "deepgram_voice_agent"
    ? "twiml.returning_deepgram_stream"
    : session.stack === "hypercheap_voice_agent"
    ? "twiml.returning_hypercheap_stream"
    : session.stack === "pipeline_voice_agent"
    ? "twiml.returning_pipeline_stream"
    : session.stack === "inworld_realtime_agent"
    ? "twiml.returning_inworld_stream"
    : "twiml.returning";
  const bridgeStack = session.stack === "deepgram_voice_agent" ||
    session.stack === "hypercheap_voice_agent" ||
    session.stack === "pipeline_voice_agent" ||
    session.stack === "inworld_realtime_agent";
  await appendDebugLog(supabase, sessionId, "info", twimlReturnEvent, {
    stack: session.stack,
    welcomeGreetingLength: bridgeStack ? undefined : welcome.length,
    twimlPreview: twiml.slice(0, 400),
  });
  console.log(`${FN} returning TwiML for stack=${session.stack} session=${sessionId}`);
  return new Response(twiml, { headers: twimlHeaders });
});
