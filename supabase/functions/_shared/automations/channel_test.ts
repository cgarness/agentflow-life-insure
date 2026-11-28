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

Deno.test("a text is held without reserving when its earlier refused reservation cannot be released", async () => {
  const sms = { type: "send_sms" as const, config: { body: "Reminder {{first_name}}", purpose: "informational" } };
  for (const answer of [{ data: null, error: { message: "fixture outage" } }, { data: false, error: null }]) {
    const names: string[] = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        names.push(name);
        assert(args.p_run === claim.run_id && args.p_token === claim.lease_token && args.p_node === claim.node_id, "lease scope");
        return name === "automation_message_check" ? { data: null, error: null } : answer;
      },
      from: (table: string) => {
        names.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { organization_id: claim.organization_id, enforced: true }, error: null }),
        };
        return query;
      },
    };
    const result = await dispatchChannel(db, claim, sms, { ...contact, phone: "+12025550123" }, { env: fakeEnv, fetch: noTransport });
    assert(result.status === "held" && result.reason === "Message eligibility could not be verified.", String(result.reason));
    assert(names.join() === "automation_message_check,sms_agency_policies,automation_release_refused_dispatch",
      "nothing was reserved: " + names.join());
  }
});

Deno.test("a text that ends without a handoff cancels its own unsent reservation, in any texting mode", async () => {
  const sms = { type: "send_sms" as const, config: { body: "Reminder {{first_name}}", purpose: "informational" } };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === "automation_message_check") return { data: null, error: null };
      if (name === "automation_release_refused_dispatch") return { data: true, error: null };
      if (name === "sms_cancel_prepared_dispatch") return { data: true, error: null };
      return { data: null, error: { message: "fixture refusal before the handoff" } };
    },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: { organization_id: claim.organization_id, enforced: true }, error: null }),
      };
      return query;
    },
  };
  const result = await dispatchChannel(db, claim, sms, { ...contact, phone: "+12025550123" }, { env: fakeEnv, fetch: noTransport });
  assert(result.status === "held", String(result.status));
  const cancel = calls.find(([name]) => name === "sms_cancel_prepared_dispatch");
  assert(cancel && cancel[1].p_org === claim.organization_id && cancel[1].p_key === `automation:${claim.run_id}:${claim.node_id}`,
    "the step's own reservation is cancelled: " + calls.map(([name]) => name).join());
  assert(!calls.some(([name]) => name === "automation_begin_message"), "nothing was handed off");
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

// The final send check's answers from the reminder record, through the real SMS dispatch: a query double stands in for
// the database (a non-sticky agency on the master account) and the injected transport for the consent service and
// Twilio. The check's answers are scripted in order, and so are the consent service's (dispatch asks it before it
// reserves the request and again after); the last one repeats.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (prefix: string) => prefix + "1".repeat(32);
Deno.env.set("SMS_BRIDGE_SECRET", "synthetic-only-secret-".repeat(3));
Deno.env.set("TWILIO_MASTER_ACCOUNT_SID", sid("AC"));
Deno.env.set("TWILIO_MASTER_AUTH_TOKEN", "synthetic-token");
const smsClaim = { ...claim, organization_id: uuid(1), run_id: uuid(2), lease_token: uuid(3), contact_id: uuid(4) };
const smsStep = { type: "send_sms" as const, config: { body: "Reminder {{first_name}}", purpose: "informational" } };
const smsLead = { first_name: "Alex", phone: "+12025550123" };
type Consent = "allowed" | "suppressed" | "no_grant" | "unavailable";
function smsPath(checks: unknown[], consent: Consent | Consent[] = "allowed", begin: "ok" | "refused" = "ok") {
  const org = smsClaim.organization_id, number = uuid(9), calls: string[] = [], answers = [...checks];
  const consents = Array.isArray(consent) ? [...consent] : [consent];
  let posts = 0;
  const rows: Record<string, Record<string, unknown>[]> = {
    sms_agency_policies: [{
      organization_id: org, enforced: true, send_enabled: true, uv_profile_id: uuid(5), uv_project: "jzdzeevjpootbeuniygx",
      sender_name: "Fixture Agency", selected_phone_ids: [number], active_from: new Date().toISOString(),
    }],
    a2p_registrations: [{
      organization_id: org, account_sid: sid("AC"), brand_sid: sid("BN"), campaign_sid: sid("QE"), brand_status: "APPROVED",
      identity_status: "VERIFIED", campaign_status: "VERIFIED", is_test: false, messaging_service_sid: sid("MG"),
      last_synced_at: new Date().toISOString(),
    }],
    a2p_accounts: [{
      organization_id: org, account_sid: sid("AC"), account_scope: "master", enabled: true, sms_enforced: true,
      resources_reconciled_at: new Date().toISOString(),
    }],
    a2p_numbers: [{
      organization_id: org, phone_number_id: number, phone_sid: sid("PN"), status: "registered", messaging_service_sid: sid("MG"),
    }],
    phone_numbers: [{
      id: number, organization_id: org, phone_number: "+19095550100", twilio_sid: sid("PN"), assignment_type: "agency",
      status: "active", inbounds_only: false, is_default: true,
    }],
    leads: [{ id: smsClaim.contact_id, organization_id: org, phone: smsLead.phone }],
    clients: [],
  };
  const db = {
    from(table: string) {
      calls.push(table);
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let single = false;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (value: unknown) => unknown) => {
          const found = (rows[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
          return Promise.resolve({ data: single ? found[0] ?? null : found, error: null }).then(resolve);
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      switch (name) {
        case "automation_message_check":
          assert(args.p_run === smsClaim.run_id && args.p_token === smsClaim.lease_token && args.p_node === smsClaim.node_id, "check scope");
          return { data: answers.length > 1 ? answers.shift() : answers[0], error: null };
        case "automation_release_refused_dispatch": return { data: true, error: null };
        case "sticky_number_guard": return { data: { voice: "off", sms: "off" }, error: null };
        case "phone_number_setup_managed": return { data: { managed: false }, error: null };
        case "sms_prepare_dispatch": return { data: { state: "prepared", request_key: args.p_key }, error: null };
        case "sms_cancel_prepared_dispatch":
          assert(args.p_org === org && args.p_key === `automation:${smsClaim.run_id}:${smsClaim.node_id}`, "the step's own reservation");
          return { data: true, error: null };
        case "automation_begin_message":
          return begin === "refused"
            ? { data: null, error: { message: "Run no longer permits a provider handoff." } }
            : { data: { id: messageId, from_email: null, reply_to: null, unsubscribe_token: receiptId }, error: null };
        case "sms_finish_dispatch":
          return { data: { state: args.p_state, message_id: uuid(8), provider_sid: args.p_sid, provider_status: args.p_status }, error: null };
        case "automation_record_receipt": return { data: null, error: null };
        default: throw Error("unexpected database call " + name);
      }
    },
  };
  const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("agentflow-consent")) {
      calls.push("consent");
      const answer = consents.length > 1 ? consents.shift()! : consents[0];
      if (answer === "unavailable") throw Error("consent service unavailable");
      const body = JSON.parse(String(init?.body));
      return Response.json({
        organization_id: org, profile_id: uuid(5), phone: body.phone, purpose: body.purpose, checked_at: new Date().toISOString(),
        allowed: answer === "allowed", reason: answer === "suppressed" ? "suppressed" : "no_grant", evidence: [{ id: uuid(6) }],
      });
    }
    if (url.includes("/Messages.json")) {
      posts++;
      calls.push("provider");
      return Response.json({ sid: sid("SM"), status: "queued" });
    }
    // Twilio's number and messaging-service membership lookups.
    return Response.json({
      sid: sid("PN"), account_sid: sid("AC"), service_sid: sid("MG"), capabilities: { sms: true }, phone_number: "+19095550100",
    });
  };
  return { db, transport: transport as typeof fetch, calls, posts: () => posts };
}
async function sendText(path: ReturnType<typeof smsPath>) {
  const original = globalThis.fetch;
  globalThis.fetch = path.transport;
  try {
    return await dispatchChannel(path.db, smsClaim, smsStep, smsLead, { env: fakeEnv, fetch: path.transport });
  } finally {
    globalThis.fetch = original;
  }
}
const count = (calls: string[], name: string) => calls.filter((call) => call === name).length;
function emailPath(checks: unknown[], beginFails: boolean) {
  const calls: string[] = [], answers = [...checks];
  let sends = 0;
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "automation_message_check") return { data: answers.length > 1 ? answers.shift() : answers[0], error: null };
      if (name === "automation_begin_message" && beginFails) {
        return { data: null, error: { message: "Run no longer permits a provider handoff." } };
      }
      return { error: null, data: { id: messageId, from_email: "verified@example.invalid", reply_to: "monitored@example.invalid", unsubscribe_token: receiptId } };
    },
    from: () => { throw Error("no table read expected for email"); },
  };
  const transport = async () => { sends++; return Response.json({ id: receiptId }); };
  return { db, transport: transport as unknown as typeof fetch, calls, sends: () => sends };
}

Deno.test("a 'skip:' answer reserves nothing, calls no provider and is the step's outcome with its reason", async () => {
  const text = smsPath(["skip:Already sent for this appointment time"]);
  const sms = await sendText(text);
  assert(sms.status === "skipped" && sms.reason === "Already sent for this appointment time", JSON.stringify(sms));
  assert(text.calls.join() === "automation_message_check" && text.posts() === 0, "nothing reserved: " + text.calls.join());
  const mail = emailPath(["skip:Stopped by a person for this appointment time"], false);
  const email = await dispatchChannel(mail.db, claim, node, contact, { env: fakeEnv, fetch: mail.transport });
  assert(email.status === "skipped" && email.reason === "Stopped by a person for this appointment time", JSON.stringify(email));
  assert(mail.calls.join() === "automation_message_check" && mail.sends() === 0, "no handoff: " + mail.calls.join());
});

Deno.test("any other answer from the check still holds, unchanged", async () => {
  for (const answer of ["Waiting before retrying a text the provider rate-limited", "The appointment has an outcome recorded"]) {
    const text = smsPath([answer]);
    const held = await sendText(text);
    assert(held.status === "held" && held.reason === answer, JSON.stringify(held));
    assert(text.calls.join() === "automation_message_check" && text.posts() === 0, "nothing reserved: " + text.calls.join());
  }
});

Deno.test("a 'retry:' answer sends the text through the normal path, once", async () => {
  const text = smsPath(["retry:"]);
  const sent = await sendText(text);
  assert(sent.status === "accepted" && text.posts() === 1, JSON.stringify(sent) + " " + text.calls.join());
  for (const step of ["automation_release_refused_dispatch", "consent", "sms_prepare_dispatch", "automation_begin_message",
      "sms_finish_dispatch", "automation_record_receipt"]) {
    assert(text.calls.includes(step), step + " missing: " + text.calls.join());
  }
  assert(count(text.calls, "automation_message_check") === 1 && !text.calls.includes("sms_cancel_prepared_dispatch"),
    "checked once, nothing cancelled: " + text.calls.join());
});

Deno.test("a retry the consent service refuses for good at its first check is skipped before any request is reserved", async () => {
  for (const consent of ["suppressed", "no_grant"] as const) {
    const text = smsPath(["retry:"], consent);
    const result = await sendText(text);
    assert(result.status === "skipped" && result.reason === "Not retried: the lead can no longer receive this message",
      consent + ": " + JSON.stringify(result));
    assert(!text.calls.includes("sms_prepare_dispatch"), consent + ": no request reserved: " + text.calls.join());
    assert(text.calls.includes("sms_cancel_prepared_dispatch"),
      consent + ": the step's request key is still released, with nothing to cancel: " + text.calls.join());
    assert(!text.calls.includes("automation_begin_message") && text.posts() === 0, consent + ": nothing handed off");
    assert(text.calls.includes("consent"), consent + ": refused by the consent service: " + text.calls.join());
    // A first attempt refused the same way holds, as before.
    const first = smsPath([null], consent);
    const held = await sendText(first);
    assert(held.status === "held" && held.reason === (consent === "suppressed"
        ? "This recipient has opted out of agency texts."
        : "This recipient has not granted informational SMS permission."),
      consent + " first: " + JSON.stringify(held));
    assert(first.calls.includes("sms_cancel_prepared_dispatch") && first.posts() === 0, consent + " first: " + first.calls.join());
  }
});

Deno.test("a retry the consent service cannot verify at its first check holds before any request is reserved", async () => {
  const text = smsPath(["retry:"], "unavailable");
  const held = await sendText(text);
  assert(held.status === "held" && held.reason === "Consent could not be verified. Please try again later.", JSON.stringify(held));
  assert(!text.calls.includes("sms_prepare_dispatch") && text.calls.includes("sms_cancel_prepared_dispatch")
    && count(text.calls, "automation_message_check") === 2, "nothing reserved, then asked again: " + text.calls.join());
  assert(text.posts() === 0, "nothing handed off");
});

// The consent service allows the text when dispatch first asks, so the request is reserved, and then refuses it when
// dispatch asks again just before the handoff.
const reservedThenCancelled = (calls: string[]) => {
  const prepared = calls.indexOf("sms_prepare_dispatch"), cancelled = calls.indexOf("sms_cancel_prepared_dispatch");
  return prepared >= 0 && cancelled > prepared && count(calls, "consent") === 2 && calls.lastIndexOf("consent") > prepared;
};

Deno.test("a retry the consent service refuses for good after its request was reserved is skipped and the reservation cancelled", async () => {
  for (const refusal of ["suppressed", "no_grant"] as const) {
    const text = smsPath(["retry:"], ["allowed", refusal]);
    const result = await sendText(text);
    assert(result.status === "skipped" && result.reason === "Not retried: the lead can no longer receive this message",
      refusal + ": " + JSON.stringify(result));
    assert(reservedThenCancelled(text.calls), refusal + ": reserved, refused, then cancelled: " + text.calls.join());
    assert(!text.calls.includes("automation_begin_message") && text.posts() === 0, refusal + ": nothing handed off");
    assert(count(text.calls, "automation_message_check") === 1, refusal + ": skipped without asking again: " + text.calls.join());
    // A first attempt refused the same way holds, as before.
    const first = smsPath([null], ["allowed", refusal]);
    const held = await sendText(first);
    assert(held.status === "held" && held.reason === (refusal === "suppressed"
        ? "This recipient has opted out of agency texts."
        : "This recipient has not granted informational SMS permission."),
      refusal + " first: " + JSON.stringify(held));
    assert(reservedThenCancelled(first.calls) && first.posts() === 0, refusal + " first: " + first.calls.join());
  }
});

Deno.test("a retry the consent service cannot verify after its request was reserved holds and the reservation is cancelled", async () => {
  const text = smsPath(["retry:"], ["allowed", "unavailable"]);
  const held = await sendText(text);
  assert(held.status === "held" && held.reason === "Consent could not be verified. Please try again later.", JSON.stringify(held));
  assert(reservedThenCancelled(text.calls) && count(text.calls, "automation_message_check") === 2,
    "reserved, cancelled, then asked again: " + text.calls.join());
  assert(!text.calls.includes("automation_begin_message") && text.posts() === 0, "nothing handed off");
});

Deno.test("a text whose handoff is refused is skipped when the check now says so (the race loser), and otherwise held", async () => {
  for (const [first, reason] of [
    [null, "Already sent for this appointment time"],
    ["retry:", "Not sent again: already retried once for this appointment time"],
  ] as const) {
    const lost = smsPath([first, "skip:" + reason], "allowed", "refused");
    const skipped = await sendText(lost);
    assert(skipped.status === "skipped" && skipped.reason === reason, JSON.stringify(skipped));
    assert(lost.calls.includes("automation_begin_message") && lost.calls.includes("sms_cancel_prepared_dispatch")
      && count(lost.calls, "automation_message_check") === 2 && lost.posts() === 0, "refused, cancelled, asked again: " + lost.calls.join());
  }
  for (const again of [null, "retry:", "The appointment moved after this message was prepared"]) {
    const refused = smsPath([null, again], "allowed", "refused");
    const held = await sendText(refused);
    assert(held.status === "held" && held.reason === "Run no longer permits a provider handoff.", JSON.stringify(held));
    assert(refused.posts() === 0 && refused.calls.includes("sms_cancel_prepared_dispatch"), "held: " + refused.calls.join());
  }
});

Deno.test("an email whose handoff is refused is skipped when the check now says so, and otherwise held", async () => {
  const lost = emailPath([null, "skip:Already sent for this appointment time"], true);
  const skipped = await dispatchChannel(lost.db, claim, node, contact, { env: fakeEnv, fetch: lost.transport });
  assert(skipped.status === "skipped" && skipped.reason === "Already sent for this appointment time", JSON.stringify(skipped));
  assert(lost.calls.join() === "automation_message_check,automation_begin_message,automation_message_check" && lost.sends() === 0,
    "refused, asked again: " + lost.calls.join());
  const refused = emailPath([null, null], true);
  const held = await dispatchChannel(refused.db, claim, node, contact, { env: fakeEnv, fetch: refused.transport });
  assert(held.status === "held" && held.reason === "Run no longer permits a provider handoff." && refused.sends() === 0,
    JSON.stringify(held));
});
