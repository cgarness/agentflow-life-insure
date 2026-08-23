export type TwilioNumberConfig = {
  voiceUrl: string;
  voiceMethod: "POST";
  smsUrl: string;
  smsMethod: "POST";
  statusCallback: string;
  statusCallbackMethod: "POST";
};

export function canonicalNumberConfig(supabaseUrl: string): TwilioNumberConfig {
  let origin: string;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("SUPABASE_URL must use HTTPS");
    }
    origin = parsed.origin;
  } catch {
    throw new Error("SUPABASE_URL is invalid");
  }

  const base = `${origin}/functions/v1`;
  return {
    voiceUrl: `${base}/twilio-voice-inbound`,
    voiceMethod: "POST",
    smsUrl: `${base}/twilio-sms-webhook`,
    smsMethod: "POST",
    // C7 (plan rev 6): the connection-override retry fragment rides the URL FRAGMENT — never
    // transmitted on the wire, never part of the signed URL — and gives the call status callback a
    // bounded redelivery channel for HTTP 5xx, connect failures and read timeouts. Twilio's DEFAULT
    // policy does not retry 5xx, so without it a transient DB failure in twilio-voice-status would
    // permanently lose the terminal write and its missed-call notification.
    statusCallback: `${base}/twilio-voice-status#rc=3&rp=5xx,ct,rt`,
    statusCallbackMethod: "POST",
  };
}
