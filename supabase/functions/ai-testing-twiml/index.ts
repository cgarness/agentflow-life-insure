import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  edgeFunctionUrl,
  twilioFormParams,
  validateTwilioSignature,
  xmlEscape,
} from "../_shared/aiTestingTwilio.ts";
import { loadSession } from "../_shared/aiTestingSession.ts";
import { welcomeGreetingFromLead } from "../_shared/aiTestingPrompt.ts";

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
    return new Response(
      '<?xml version="1.0"?><Response><Say>Missing session.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      '<?xml version="1.0"?><Response><Say>Server error.</Say></Response>',
      { headers: twimlHeaders },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const session = await loadSession(supabase, sessionId);
  if (!session) {
    return new Response(
      '<?xml version="1.0"?><Response><Say>Session not found.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) {
    return new Response(
      '<?xml version="1.0"?><Response><Say>Telephony not configured.</Say></Response>',
      { headers: twimlHeaders },
    );
  }

  const params = req.method === "POST"
    ? await twilioFormParams(req.clone())
    : Object.fromEntries(url.searchParams.entries());

  const valid = await validateTwilioSignature(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-twiml",
  );
  if (!valid) {
    console.warn(`${FN} signature validation failed for session ${sessionId}`);
    return new Response("Forbidden", { status: 403 });
  }

  const welcome = welcomeGreetingFromLead(session.lead_context).slice(0, 200);
  const welcomeEscaped = xmlEscape(welcome);

  let inner = "";

  if (session.stack === "twilio_cr") {
    const relayUrl = edgeFunctionUrl(
      "ai-testing-relay-ws",
      `sessionId=${encodeURIComponent(sessionId)}`,
    ).replace("https://", "wss://");
    inner = `<Connect><ConversationRelay url="${xmlEscape(relayUrl)}" welcomeGreeting="${welcomeEscaped}" transcriptionProvider="deepgram" speechModel="nova-2-general" ttsProvider="ElevenLabs" language="en-US" interruptible="any" reportInputDuringAgentSpeech="speech" speechTimeout="1200" ignoreBackchannel="false" /></Connect>`;
  } else {
    const mode = session.stack === "xai_s2s" ? "xai" : "openai";
    const streamUrl = edgeFunctionUrl(
      "ai-testing-stream-ws",
      `sessionId=${encodeURIComponent(sessionId)}&mode=${mode}`,
    ).replace("https://", "wss://");
    inner = `<Connect><Stream url="${xmlEscape(streamUrl)}"><Parameter name="sessionId" value="${xmlEscape(sessionId)}" /><Parameter name="mode" value="${xmlEscape(mode)}" /></Stream></Connect>`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Start><Recording recordingStatusCallback="${xmlEscape(edgeFunctionUrl("ai-testing-recording-status", `sessionId=${encodeURIComponent(sessionId)}`))}" recordingStatusCallbackMethod="POST" /></Start>${inner}</Response>`;

  console.log(`${FN} returning TwiML for stack=${session.stack} session=${sessionId}`);
  return new Response(twiml, { headers: twimlHeaders });
});
