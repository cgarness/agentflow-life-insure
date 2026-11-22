// Run after channel-fixture.sql on a disposable local AgentFlow database, with Deno network limited to loopback.
import assert from "node:assert/strict";
import { dispatchChannel } from "../../../supabase/functions/_shared/automations/channel.ts";
import { allowConsent, calls, db, endpoint, id, testFetch } from "./channel-transport.ts";
allowConsent(false);
const send = (n: number) =>
  dispatchChannel(
    db,
    {
      organization_id: id(1),
      workflow_id: id(4),
      version_id: id(5),
      run_id: id(20 + n),
      node_id: "message",
      contact_id: id(10 + n),
      contact_type: "lead",
      lease_token: id(30 + n),
      stop_on_reply: true,
    },
    { type: "send_sms", config: { body: "Fixture {{first_name}}", purpose: "informational" } },
    { first_name: "Alex", phone: "+1202555014" + (n + 1) },
    { env: (name) => name === "SUPABASE_URL" ? endpoint : undefined, fetch: testFetch },
  );
const held = await send(2);
assert.equal(held.status, "held");
assert.match(held.reason ?? "", /not granted informational SMS permission/i);
assert.equal(calls.length, 0);
allowConsent(true);
const accepted = await send(1);
assert.equal(accepted.status, "accepted", accepted.reason);
assert.equal(calls.length, 1);
assert.equal(calls[0].get("From"), "+12025550141");
assert.equal(calls[0].get("To"), "+12025550142");
assert.equal(calls[0].get("Body"), "Fixture Alex");
assert.ok(
  calls[0].get("StatusCallback")?.startsWith(
    endpoint + "/functions/v1/automation-provider-receipt?sms=",
  ),
);
const replay = await send(1);
assert.equal(replay.status, "accepted", replay.reason);
assert.equal(calls.length, 1);
const { error: repairError } = await db.rpc("automation_repair_messages", { p_limit: 10 });
assert.ifError(repairError);
const history = await db.from("messages").select(
  "body,status,automation_message_id,created_by,provider_message_id",
)
  .eq("organization_id", id(1)).eq("contact_id", id(11)).maybeSingle();
assert.ifError(history.error);
assert.ok(history.data?.automation_message_id);
assert.equal(history.data?.created_by, null);
assert.equal(history.data?.body, "Fixture Alex");
assert.match(history.data?.provider_message_id ?? "", /^SM[0-9a-f]{32}$/);
console.log(
  "Verified native Automation SMS consent hold, sticky eligibility, one synthetic provider request, replay and attributed history.",
);
