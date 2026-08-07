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
    statusCallback: `${base}/twilio-voice-status`,
    statusCallbackMethod: "POST",
  };
}
