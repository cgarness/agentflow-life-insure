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
