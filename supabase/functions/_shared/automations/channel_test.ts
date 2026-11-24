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
      if (name === "automation_message_check") return { data: null, error: null };
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
      assert(names.join() === "automation_message_check,automation_begin_message", "provider reached before admission");
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
    result.status === "accepted" && sends === 1 && names.length === 3,
    "did not persist accepted receipt",
  );
});

Deno.test("a change after the lease holds the message before any provider request is reserved", async () => {
  const sms = { type: "send_sms" as const, config: { body: "Reminder {{first_name}}", purpose: "informational" } };
  for (const [step, answer, reason] of [
    [node, { data: "Appointment was cancelled", error: null }, "Appointment was cancelled"],
    [sms, { data: "The appointment moved after this message was prepared", error: null }, "The appointment moved after this message was prepared"],
    [sms, { data: null, error: { message: "fixture outage" } }, "Message eligibility could not be verified."],
  ] as const) {
    const names: string[] = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        names.push(name);
        assert(args.p_run === claim.run_id && args.p_token === claim.lease_token && args.p_node === claim.node_id, "check scope");
        return answer;
      },
      from: () => { names.push("from"); throw Error("no table read expected"); },
    };
    const result = await dispatchChannel(db, claim, step, { ...contact, phone: "+12025550123" }, { env: fakeEnv, fetch: noTransport });
    assert(result.status === "held" && result.reason === reason, String(result.reason));
    assert(names.join() === "automation_message_check", "nothing else was asked or reserved: " + names.join());
  }
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

function smsDatabase(calls: string[]) {
  return {
    rpc: async (name: string) => {
      calls.push(name);
      return { data: null, error: { message: "fixture stop" } };
    },
    from: () => { calls.push("from"); throw Error("no table read expected"); },
  };
}
const noTransport = async () => { throw Error("no provider traffic expected"); };

Deno.test("a version 2 SMS step without a pinned purpose is held before any lookup or provider call", async () => {
  const calls: string[] = [];
  const v2 = { type: "send_sms" as const, version: 2, config: { body: "Hello {{first_name}}" } };
  const unpinned = await dispatchChannel(smsDatabase(calls), claim, v2, { ...contact, phone: "+12025550123" }, {
    env: fakeEnv, fetch: noTransport,
  });
  assert(unpinned.status === "held" && /purpose could not be established/i.test(unpinned.reason ?? ""), "unpinned purpose");
  const forged = await dispatchChannel(smsDatabase(calls), { ...claim, context: { sms_purpose: "manual" } }, {
    ...v2, config: { body: "Hello", purpose: "informational" },
  }, { ...contact, phone: "+12025550123" }, { env: fakeEnv, fetch: noTransport });
  assert(forged.status === "held", "an author-supplied purpose on a version 2 step is ignored");
  assert(calls.length === 0, "held before any database or provider request");
});

Deno.test("messages are never attempted for clients, recruits or runs without a contact", async () => {
  const calls: string[] = [];
  for (const scope of [{ contact_type: "client" }, { contact_type: "recruit" }, { contact_id: null, contact_type: null }]) {
    const result = await dispatchChannel(smsDatabase(calls), { ...claim, ...scope }, node, contact, {
      env: fakeEnv, fetch: noTransport,
    });
    assert(result.status === "held" && calls.length === 0, "non-lead contact reached a provider path");
  }
});

Deno.test("appointment wording uses the recipient's verified time zone and holds without one", async () => {
  const appointmentNode = {
    type: "send_email" as const,
    config: { subject: "{{appointment_date}} at {{appointment_time}}", body: "See you then, {{first_name}}", sender_id: "sender-a" },
  };
  const scheduled = { ...claim, context: { appointment_start: "2026-12-05T20:00:00Z" } };
  let sends = 0;
  const names: string[] = [];
  const zoned = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      names.push(name);
      if (name === "automation_message_timezone") {
        assert(args.p_run === claim.run_id && args.p_channel === "email" && args.p_recipient === "alex@example.invalid", "scope");
        return { data: "America/Los_Angeles", error: null };
      }
      if (name === "automation_message_check") return { data: null, error: null };
      return { error: null, data: { id: messageId, from_email: "verified@example.invalid", reply_to: "monitored@example.invalid", unsubscribe_token: receiptId } };
    },
  };
  const sent = await dispatchChannel(zoned, scheduled, appointmentNode, contact, {
    env: fakeEnv,
    fetch: async (_url, init) => {
      sends++;
      const body = JSON.parse(String(init?.body));
      assert(body.subject === "Saturday, December 5 at 12:00 PM PST" && body.text === "See you then, Alex", body.subject);
      return Response.json({ id: receiptId });
    },
  });
  assert(sent.status === "accepted" && sends === 1 && names[0] === "automation_message_timezone", "rendered in the verified zone");

  const unverified = { rpc: async () => ({ data: null, error: null }) };
  const held = await dispatchChannel(unverified, scheduled, appointmentNode, contact, { env: fakeEnv, fetch: noTransport });
  assert(held.status === "held" && /verified timezone/i.test(held.reason ?? ""), "missing time zone holds");
  const noStart = await dispatchChannel(zoned, claim, appointmentNode, contact, { env: fakeEnv, fetch: noTransport });
  assert(noStart.status === "held" && /could not be filled in/i.test(noStart.reason ?? ""), "missing appointment holds");
});
