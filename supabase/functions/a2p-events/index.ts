import { credentials, database, failure, json, readBody } from "../_shared/a2p/auth.ts";
import { enqueueEvent, parseEvents, validateEventSignature } from "../_shared/a2p/events.ts";
import { checked } from "../_shared/a2p/store.ts";
import { A2pError, type Account } from "../_shared/a2p/types.ts";
Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const raw = await readBody(req, 1024 * 1024);
    const u = new URL(req.url);
    const sid = u.searchParams.get("account");
    if (!sid || !/^AC[0-9a-fA-F]{32}$/.test(sid)) throw new A2pError("ACCOUNT_REQUIRED", "Invalid event account.", 403);
    const db = database();
    const configs = checked(await db.from("a2p_accounts").select("*").eq("account_sid", sid).limit(1)) as Account[];
    if (!configs.length) throw new A2pError("ACCOUNT_UNKNOWN", "Unknown event account.", 403);
    const creds = await credentials(db, configs[0]);
    const signedUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/a2p-events${u.search}`;
    if (!await validateEventSignature(signedUrl, raw, req.headers.get("X-Twilio-Signature"), creds.authToken)) {
      throw new A2pError("SIGNATURE_INVALID", "Invalid signature.", 403);
    }
    const events = parseEvents(raw, sid);
    for (const e of events) await enqueueEvent(db, creds, e);
    // Durable inbox committed; scheduled reconciliation owns status and delivery retries.
    return json({ received: true });
  } catch (e) {
    return failure(e);
  }
});
