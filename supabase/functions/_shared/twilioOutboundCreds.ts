// Outbound REST + webhook signature creds for Twilio calls placed on the master account.
// AgentFlow numbers and the TwiML App live on master; subaccount REST cannot dial them.

export type OutboundTwilioCreds = {
  accountSid: string;
  authToken: string;
};

export type OutboundTwilioCredsResult =
  | { ok: true; creds: OutboundTwilioCreds }
  | { ok: false; status: number; code: string; error: string };

export function loadOutboundTwilioCreds(): OutboundTwilioCredsResult {
  const accountSid = (
    Deno.env.get("TWILIO_MASTER_ACCOUNT_SID") ??
    Deno.env.get("TWILIO_ACCOUNT_SID") ??
    ""
  ).trim();
  const authToken = (
    Deno.env.get("TWILIO_MASTER_AUTH_TOKEN") ??
    Deno.env.get("TWILIO_AUTH_TOKEN") ??
    ""
  ).trim();

  if (!accountSid || !authToken) {
    return {
      ok: false,
      status: 500,
      code: "TWILIO_OUTBOUND_MISCONFIGURED",
      error: "Twilio outbound credentials are not configured on the server.",
    };
  }

  return { ok: true, creds: { accountSid, authToken } };
}
