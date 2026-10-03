import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { loadOutboundTwilioCreds } from "../twilioOutboundCreds.ts";
import { loadSubaccountCreds } from "../twilioSubaccountCreds.ts";
import { TwilioA2p } from "./provider.ts";
import { A2pError, type Account, type Db } from "./types.ts";
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
export function database() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function admin(req: Request, body: Record<string, unknown>, db: Db) {
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new A2pError("UNAUTHORIZED", "Sign in to continue.", 401);
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new A2pError("UNAUTHORIZED", "Sign in to continue.", 401);
  const p = await db.from("profiles").select("id,organization_id,role,status,email").eq("id", user.id).maybeSingle();
  if (p.error) throw new A2pError("AUTH_LOOKUP", "Could not verify account permissions.", 503);
  if (!p.data?.organization_id || p.data.status !== "Active" || !["Admin", "Super Admin"].includes(p.data.role)) {
    throw new A2pError("FORBIDDEN", "Agency administrator access is required.", 403);
  }
  if (body.actor_id !== p.data.id || body.organization_id !== p.data.organization_id || body.view_as === true) {
    throw new A2pError("SCOPE_CHANGED", "Return to your own account and reload this page.", 403);
  }
  return p.data as { id: string; organization_id: string; email: string };
}
export async function credentials(db: Db, a: Account) {
  const result = a.account_scope === "master"
    ? loadOutboundTwilioCreds()
    : await loadSubaccountCreds(db, a.organization_id);
  if (result.ok === false) throw new A2pError(result.code, result.error, result.status);
  if (result.creds.accountSid !== a.account_sid) {
    throw new A2pError(
      "ACCOUNT_MISMATCH",
      "Registration account does not match the verified agency configuration.",
      409,
    );
  }
  return result.creds;
}
export function failure(e: unknown) {
  const x = e instanceof A2pError
    ? e
    : new A2pError("A2P_ERROR", "The operation could not be completed. Refresh status before retrying.", 500);
  return json({ error: x.message, code: x.code }, x.status);
}

/** The ISV primary profile belongs to the platform, including for subaccount brands. */
export async function verifyPlatformProfile(a: Account) {
  const result = loadOutboundTwilioCreds();
  if (result.ok === false) throw new A2pError(result.code, result.error, result.status);
  const primary = await new TwilioA2p(result.creds).call(
    `https://trusthub.twilio.com/v1/CustomerProfiles/${a.primary_profile_sid}`,
  );
  if (primary.account_sid !== result.creds.accountSid || primary.status !== "twilio-approved") {
    throw new A2pError("ISV_PROFILE", "The platform business profile is not approved.", 409);
  }
}

/** Bound memory usage for public callbacks and authenticated JSON actions. */
export async function readBody(req: Request, maxBytes: number): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0, result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new A2pError("TOO_LARGE", "Request is too large.", 413);
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
