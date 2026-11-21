// The preceding channel fixture provides a provider-accepted SMS. All requests below stay inside this process or loopback.
import assert from "node:assert/strict";
import { calls, db, endpoint, id } from "./channel-transport.ts";
import { handleReceipt } from "../../../supabase/functions/_shared/automations/receiptHandler.ts";
Deno.env.set("SUPABASE_URL", endpoint);
const row = await db.from("messages").select("automation_message_id,provider_message_id")
  .eq("contact_id", id(11)).eq("organization_id", id(1)).single();
assert.ifError(row.error);
const url = endpoint + "/functions/v1/automation-provider-receipt?sms=" +
  row.data!.automation_message_id;
const params = {
  AccountSid: "AC000000000000000000000000000000a1",
  MessagingServiceSid: "MG000000000000000000000000000000a1",
  MessageSid: row.data!.provider_message_id,
  MessageStatus: "delivered",
  From: "+12025550141",
  To: "+12025550142",
};
const make = (body: Record<string, string>, signature: string) =>
  new Request(url, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: { "x-twilio-signature": signature },
  });
const sig = async (body: Record<string, string>) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("synthetic-only"),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const raw = url + Object.keys(body).sort().map((k) => k + body[k]).join("");
  const hash = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
};
assert.equal((await handleReceipt(make(params, "invalid"), db, undefined)).status, 403);
assert.equal(
  (await handleReceipt(make({ ...params, To: "+12025550143" }, await sig(params)), db, undefined))
    .status,
  403,
);
for (const state of ["delivered", "delivered", "sent"]) {
  const payload = { ...params, MessageStatus: state };
  assert.equal((await handleReceipt(make(payload, await sig(payload)), db, undefined)).status, 204);
}
const repair = await db.rpc("automation_repair_messages", { p_limit: 5 });
assert.ifError(repair.error);
const visible = await db.from("messages").select("status").eq("contact_id", id(11)).eq(
  "organization_id",
  id(1),
);
assert.ifError(visible.error);
assert.deepEqual(visible.data, [{ status: "delivered" }]);
assert.equal(calls.length, 0);
console.log(
  "Verified signed Twilio status callback, tamper rejection, duplicate and late callbacks, one delivered history row and zero resends.",
);
