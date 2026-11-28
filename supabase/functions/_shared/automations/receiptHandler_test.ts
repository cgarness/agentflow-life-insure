import assert from "node:assert/strict";
import { handleReceipt } from "./receiptHandler.ts";

const url = "https://example.invalid/functions/v1/automation-provider-receipt";
const id = "00000000-0000-4000-8000-000000000001";
const provider = "00000000-0000-4000-8000-000000000002";
const secret = "whsec_" + btoa("synthetic receipt signing secret");
const body = JSON.stringify({
  type: "email.bounced",
  created_at: new Date().toISOString(),
  data: {
    email_id: provider,
    from: "sender@example.invalid",
    to: ["recipient@example.invalid"],
    tags: { automation_message: id },
  },
});
async function signed(body: string, offset = 0) {
  const stamp = String(Math.floor(Date.now() / 1000) + offset);
  const hmac = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(atob(secret.slice(6))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    hmac,
    new TextEncoder().encode(`fixture.${stamp}.${body}`),
  );
  return new Headers({
    "svix-id": "fixture",
    "svix-timestamp": stamp,
    "svix-signature": "v1," + btoa(String.fromCharCode(...new Uint8Array(mac))),
  });
}
const post = (body: string, headers?: Headers) => new Request(url, { method: "POST", headers, body });
Deno.test("Resend unsigned, tampered and expired receipts fail before any database lookup", async () => {
  const db = {
    rpc: () => {
      throw Error("unexpected database access");
    },
  };
  assert.equal((await handleReceipt(post(body), db, secret)).status, 403);
  assert.equal((await handleReceipt(post(body + " ", await signed(body)), db, secret)).status, 403);
  assert.equal((await handleReceipt(post(body, await signed(body, -600)), db, secret)).status, 403);
});
Deno.test("signed Resend evidence binds organization, address, step and provider id on every replay", async () => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "automation_email_receipt_scope") {
        assert.deepEqual(args, {
          p_message: id,
          p_provider: provider,
          p_recipient: "recipient@example.invalid",
          p_sender: "sender@example.invalid",
        });
        return { error: null, data: { id, organization_id: "org-a" } };
      }
      assert.equal(name, "automation_record_receipt");
      calls.push(args);
      return { error: null };
    },
  };
  const headers = await signed(body);
  for (let i = 0; i < 2; i++) {
    assert.equal((await handleReceipt(post(body, headers), db, secret)).status, 204);
  }
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].p_suppression, "bounce");
  assert.equal(calls[0].p_state, "failed");
  assert.equal(calls[0].p_org, "org-a");
});
Deno.test("signed receipt with mismatched destination or provider reference cannot update history", async () => {
  const db = {
    rpc: (name: string) => {
      assert.equal(name, "automation_email_receipt_scope");
      return { data: null, error: null };
    },
  };
  assert.equal((await handleReceipt(post(body, await signed(body)), db, secret)).status, 403);
  const failure = { rpc: () => ({ error: { code: "unavailable" } }) };
  assert.equal((await handleReceipt(post(body, await signed(body)), failure, secret)).status, 503);
});
Deno.test("unsubscribe GET has no state change; POST invokes only the capability-bound suppression", async () => {
  let writes = 0;
  const db = {
    rpc: (name: string, args: unknown) => {
      assert.equal(name, "automation_unsubscribe");
      assert.deepEqual(args, { p_token: id });
      writes++;
      return { error: null };
    },
  };
  const target = url + "?unsubscribe=" + id;
  assert.equal((await handleReceipt(new Request(target), db, undefined)).status, 200);
  assert.equal(writes, 0);
  assert.equal(
    (await handleReceipt(new Request(target, { method: "POST" }), db, undefined)).status,
    200,
  );
  assert.equal(writes, 1);
});

// Twilio status callbacks. A signed callback's own status and error code reach the reminder record through the
// receipt wrapper; an unsigned or tampered one is refused before any write.
const smsMessage = "00000000-0000-4000-8000-000000000003";
const smsOrg = "00000000-0000-4000-8000-000000000004";
const twilioSid = (prefix: string) => prefix + "1".repeat(32);
const receiptOrigin = "https://isolated.invalid";
Deno.env.set("TWILIO_MASTER_ACCOUNT_SID", twilioSid("AC"));
Deno.env.set("TWILIO_MASTER_AUTH_TOKEN", "synthetic-token");
function twilioDb(writes: Array<[string, Record<string, unknown>]>) {
  const rows: Record<string, Record<string, unknown>> = {
    sms_agency_policies: { organization_id: smsOrg, enforced: true },
    a2p_accounts: { organization_id: smsOrg, account_sid: twilioSid("AC"), account_scope: "master" },
    a2p_registrations: { organization_id: smsOrg, account_sid: twilioSid("AC"), messaging_service_sid: twilioSid("MG") },
  };
  return {
    from: (table: string) => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) };
      return query;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "automation_callback_scope") {
        assert.deepEqual(args, { p_message: smsMessage, p_sender: "+19095550100", p_recipient: "+12025550123" });
        return { data: smsOrg, error: null };
      }
      writes.push([name, args]);
      return { data: null, error: null };
    },
  };
}
const statusCallback = (status: string, extra: Record<string, string> = {}) => ({
  AccountSid: twilioSid("AC"), MessagingServiceSid: twilioSid("MG"), MessageSid: twilioSid("SM"), MessageStatus: status,
  From: "+19095550100", To: "+12025550123", ...extra,
});
async function twilioPost(params: Record<string, string>, signedFor: Record<string, string> | null = params) {
  const url = `${receiptOrigin}/functions/v1/automation-provider-receipt?sms=${smsMessage}`;
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (signedFor) {
    let signing = url;
    for (const key of Object.keys(signedFor).sort()) signing += key + signedFor[key];
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("synthetic-token"), { name: "HMAC", hash: "SHA-1" },
      false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signing)));
    headers.set("X-Twilio-Signature", btoa(String.fromCharCode(...mac)));
  }
  return new Request(url, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}
async function withOrigin<T>(run: () => Promise<T>) {
  const previous = Deno.env.get("SUPABASE_URL");
  Deno.env.set("SUPABASE_URL", receiptOrigin);
  try {
    return await run();
  } finally {
    if (previous === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", previous);
  }
}
Deno.test("signed Twilio failed and undelivered callbacks pass their own status and a digits-only error code", async () => {
  await withOrigin(async () => {
    for (const [status, code, kept] of [
      ["failed", "30003", "30003"], ["undelivered", "30001", "30001"], ["undelivered", " 30008\n", "30008"],
      ["failed", "ERR-21610", "21610"], ["failed", undefined, null], ["undelivered", "", null],
    ] as const) {
      const writes: Array<[string, Record<string, unknown>]> = [];
      const params = statusCallback(status, code === undefined ? {} : { ErrorCode: code });
      assert.equal((await handleReceipt(await twilioPost(params), twilioDb(writes), undefined)).status, 204);
      assert.equal(writes.length, 1);
      const [name, args] = writes[0];
      assert.equal(name, "automation_record_provider_receipt");
      assert.equal(args.p_message, smsMessage);
      assert.equal(args.p_org, smsOrg);
      assert.equal(args.p_provider, twilioSid("SM"));
      assert.equal(args.p_state, "failed");
      assert.equal(args.p_status, status);
      assert.equal(args.p_error_code, kept);
      assert.ok(Number.isFinite(Date.parse(String(args.p_at))));
      assert.equal("p_channel" in args, false);
    }
  });
});
Deno.test("signed Twilio delivered, read, sent and queued callbacks are mapped as before", async () => {
  await withOrigin(async () => {
    for (const [status, state] of [["delivered", "delivered"], ["read", "delivered"], ["sent", "accepted"], ["queued", "accepted"],
        ["accepted", "accepted"]] as const) {
      const writes: Array<[string, Record<string, unknown>]> = [];
      assert.equal((await handleReceipt(await twilioPost(statusCallback(status)), twilioDb(writes), undefined)).status, 204);
      assert.equal(writes.length, 1);
      assert.equal(writes[0][0], "automation_record_provider_receipt");
      assert.equal(writes[0][1].p_state, state);
      assert.equal(writes[0][1].p_status, status);
      assert.equal(writes[0][1].p_error_code, null);
    }
    const ignored: Array<[string, Record<string, unknown>]> = [];
    assert.equal((await handleReceipt(await twilioPost(statusCallback("sending")), twilioDb(ignored), undefined)).status, 204);
    assert.equal(ignored.length, 0);
  });
});
Deno.test("an unsigned or tampered Twilio callback is refused before any database write", async () => {
  await withOrigin(async () => {
    const writes: Array<[string, Record<string, unknown>]> = [];
    const failed = statusCallback("failed", { ErrorCode: "30003" });
    assert.equal((await handleReceipt(await twilioPost(failed, null), twilioDb(writes), undefined)).status, 403);
    assert.equal((await handleReceipt(await twilioPost(failed, statusCallback("failed", { ErrorCode: "30008" })),
      twilioDb(writes), undefined)).status, 403);
    assert.equal(writes.length, 0);
  });
});
