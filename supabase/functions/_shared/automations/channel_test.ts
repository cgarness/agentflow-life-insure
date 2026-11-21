import { dispatchChannel } from "./channel.ts";

const claim = {
  organization_id: "org-a",
  workflow_id: "workflow-a",
  version_id: "version-a",
  run_id: "run-a",
  node_id: "step",
  lease_token: "worker-token",
  contact_id: "lead-a",
  contact_type: "lead",
  stop_on_reply: true,
};
const contact = { first_name: "Alex", email: "alex@example.invalid" };
const node = {
  type: "send_email" as const,
  config: { subject: "Hello {{first_name}}", body: "Edited copy", sender_id: "sender-a" },
};
const messageId = "00000000-0000-4000-8000-000000000001";
const receiptId = "00000000-0000-4000-8000-000000000002";
const fakeEnv = (name: string) => name === "SUPABASE_URL" ? "https://isolated.invalid" : "fixture-only";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function database(onCall: (name: string, args: Record<string, unknown>) => void, fail?: string) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      onCall(name, args);
      if (name === fail) return { data: null, error: { message: "fixture hold" } };
      return {
        error: null,
        data: {
          id: messageId,
          from_email: "verified@example.invalid",
          reply_to: "monitored@example.invalid",
          unsubscribe_token: receiptId,
        },
      };
    },
  };
}

Deno.test("email uses edited content, scoped sender, stable intent and one evidence-backed receipt", async () => {
  const names: string[] = [];
  let sends = 0;
  const db = database((name, args) => {
    names.push(name);
    if (name === "automation_begin_message") {
      assert(
        args.p_token === claim.lease_token && args.p_body === "Edited copy",
        "missing authorization",
      );
    }
    if (name === "automation_record_receipt") {
      assert(args.p_org === claim.organization_id && args.p_provider === receiptId, "invalid receipt");
    }
  });
  const result = await dispatchChannel(db, claim, node, contact, {
    env: fakeEnv,
    fetch: async (_url, init) => {
      sends++;
      assert(names.join() === "automation_begin_message", "provider reached before admission");
      const body = JSON.parse(String(init?.body));
      assert(body.subject === "Hello Alex" && body.text === "Edited copy", "authored content changed");
      assert(
        body.from === "verified@example.invalid" && body.reply_to === "monitored@example.invalid",
        "sender changed",
      );
      assert(new Headers(init?.headers).get("Idempotency-Key") === messageId, "unstable intent");
      assert(
        body.headers["List-Unsubscribe"].includes("automation-provider-receipt"),
        "missing unsubscribe",
      );
      return Response.json({ id: receiptId });
    },
  });
  assert(
    result.status === "accepted" && sends === 1 && names.length === 2,
    "did not persist accepted receipt",
  );
});

Deno.test("held eligibility and missing provider config cause zero provider calls", async () => {
  let sends = 0;
  const transport = async () => {
    sends++;
    throw Error("no provider traffic expected");
  };
  const db = database(() => {}, "automation_begin_message");
  const denied = await dispatchChannel(db, claim, node, contact, { env: fakeEnv, fetch: transport });
  const unavailable = await dispatchChannel(db, claim, node, contact, {
    env: (name) => name === "RESEND_API_KEY" ? undefined : fakeEnv(name),
    fetch: transport,
  });
  assert(sends === 0 && denied.status === "held" && unavailable.status === "held", "hold bypass");
});

Deno.test("timeout and receipt persistence error retain uncertainty without sending again", async () => {
  for (const timeout of [true, false]) {
    let sends = 0;
    const db = database(() => {}, "automation_record_receipt");
    const result = await dispatchChannel(db, claim, node, contact, {
      env: fakeEnv,
      fetch: async () => {
        sends++;
        if (timeout) throw Error("timeout");
        return Response.json({ id: receiptId });
      },
    });
    assert(result.status === "unknown" && sends === 1, "ambiguous handoff retried");
  }
});
