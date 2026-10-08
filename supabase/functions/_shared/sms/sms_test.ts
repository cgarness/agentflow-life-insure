import assert from "node:assert/strict";
import {
  boundedBody,
  phone,
  purpose,
  signedHeaders,
  verifyRequest,
} from "./wire.ts";
import { dispatch } from "./dispatch.ts";
import { inboundCredential, isStop, recordInboundStop } from "./webhook.ts";
import { confirmationBody } from "./confirmations.ts";
import { eligibility } from "./consent.ts";
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sid = (p: string) => p + "1".repeat(32),
  secret = "synthetic-only-secret-".repeat(3),
  org = id(1),
  profile = id(2),
  num = id(3);
Deno.env.set("SMS_BRIDGE_SECRET", secret);
Deno.env.set("TWILIO_MASTER_ACCOUNT_SID", sid("AC"));
Deno.env.set("TWILIO_MASTER_AUTH_TOKEN", "synthetic-token");
const p = {
  organization_id: org,
  uv_profile_id: profile,
  uv_project: "jzdzeevjpootbeuniygx",
  enforced: true,
  send_enabled: true,
  selected_phone_ids: [num],
  sender_name: "CG Financial",
  active_from: new Date().toISOString(),
};
Deno.test("bridge authenticates exact body, method, path, timestamp; bounded payload", async () => {
  const path = "/functions/v1/test",
    body = '{"action":"test"}',
    headers = await signedHeaders(secret, path, body);
  assert.ok(
    await verifyRequest(
      new Request(`https://example.test${path}`, { method: "POST", headers }),
      body,
      secret,
      path,
    ),
  );
  for (
    const [url, method, raw, now] of [
      [path, "POST", body + " ", Date.now()],
      [path + "?x=1", "POST", body, Date.now()],
      [path, "GET", body, Date.now()],
      [path, "POST", body, Date.now() + 120000],
    ] as [string, string, string, number][]
  ) {
    await assert.rejects(() =>
      verifyRequest(
        new Request(`https://example.test${url}`, { method, headers }),
        raw,
        secret,
        path,
        Number(now),
      )
    );
  }
  await assert.rejects(() =>
    boundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: "a".repeat(100),
      }),
      50,
    )
  );
  assert.equal(phone("(909) 555-1001"), "+19095551001");
  assert.throws(() => phone("+449095551001"));
  assert.throws(() => purpose(undefined));
});
Deno.test("confirmation wording follows exact enrolled purposes", () => {
  assert.match(
    confirmationBody("CG Financial", ["informational"]),
    /informational texts/,
  );
  assert.doesNotMatch(
    confirmationBody("CG Financial", ["informational"]),
    /marketing/,
  );
  assert.match(
    confirmationBody("CG Financial", ["marketing"]),
    /marketing texts/,
  );
  assert.match(
    confirmationBody("CG Financial", ["informational", "marketing"]),
    /informational and marketing/,
  );
  assert.throws(() => confirmationBody("Other", ["marketing"]));
});
// Query double only for Edge boundary. SQL harness exercises real transactions, constraints and privileges.
function fixture() {
  const rows: Record<string, any[]> = {
    sms_agency_policies: [structuredClone(p)],
    phone_numbers: [{
      id: num,
      organization_id: org,
      phone_number: "+19095550100",
      twilio_sid: sid("PN"),
      assignment_type: "agency",
      status: "active",
    }],
    a2p_accounts: [{
      organization_id: org,
      account_sid: sid("AC"),
      account_scope: "master",
      enabled: true,
      sms_enforced: true,
    }],
    a2p_registrations: [{
      organization_id: org,
      account_sid: sid("AC"),
      brand_status: "APPROVED",
      identity_status: "VERIFIED",
      campaign_status: "VERIFIED",
      is_test: false,
      messaging_service_sid: sid("MG"),
      last_synced_at: new Date().toISOString(),
    }],
    a2p_numbers: [{
      organization_id: org,
      phone_number_id: num,
      phone_sid: sid("PN"),
      status: "registered",
      messaging_service_sid: sid("MG"),
    }],
    profiles: [{ id: profile, organization_id: org, status: "Active" }],
  };
  let receipt: any = null, blocked = false, posts = 0, mode = "ok", checks = 0;
  const db = {
    from: (table: string) => {
      let columns = "*";
      let single = false, patch: any;
      const filters: ((r: any) => boolean)[] = [];
      const q: any = {
        select: (fields = "*") => {
          columns = fields;
          return q;
        },
        limit: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        update: (v: any) => {
          patch = v;
          return q;
        },
        then: (resolve: any) => {
          const all = table === "sms_dispatches" && receipt
            ? [receipt]
            : rows[table] ?? [];
          const found = all.filter((r) => filters.every((f) => f(r)));
          if (patch) found.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({
            data: single
              ? (found[0]
                ? (columns === "*" ? found[0] : Object.fromEntries(
                  columns.split(",").map((k) => [k, found[0][k]]),
                ))
                : null)
              : found,
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      if (name === "sms_prepare_dispatch") {
        receipt ??= {
          state: "prepared",
          organization_id: org,
          request_key: args.p_key,
          purpose: args.p_purpose,
          evidence_ids: args.p_evidence,
          actor_id: args.p_actor,
          contact_id: args.p_contact,
          contact_type: args.p_type,
          confirmation_id: args.p_confirmation,
        };
        return { data: structuredClone(receipt), error: null };
      }
      if (name === "sms_start_dispatch") {
        if (blocked) return { data: null, error: { message: "suppressed" } };
        const started = receipt.state === "prepared";
        if (started) receipt.state = "attempting";
        return { data: started, error: null };
      }
      if (name === "sms_finish_dispatch") {
        if (mode === "persist-fail" && args.p_state === "accepted") {
          return {
            data: null,
            error: {},
          };
        }
        Object.assign(receipt, {
          state: args.p_state,
          provider_sid: args.p_sid,
          provider_status: args.p_status,
          message_id: id(9),
        });
        return { data: structuredClone(receipt), error: null };
      }
      if (name === "sms_record_suppression") {
        blocked = true;
        return { data: null, error: null };
      }
      throw Error(name);
    },
  };
  const transport = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.includes("agentflow-consent")) {
      checks++;
      if (mode === "consent-unavailable") throw Error("UV unavailable");
      const b = JSON.parse(String(init?.body));
      if (mode === "stop-race" && checks === 2) blocked = true;
      return Response.json({
        organization_id: org,
        profile_id: profile,
        phone: b.phone,
        purpose: b.purpose,
        checked_at: new Date().toISOString(),
        allowed: mode !== "no-consent",
        reason: "no_grant",
        evidence: [{ id: id(5) }],
      });
    }
    if (url.includes("/Messages.json")) {
      posts++;
      if (mode === "timeout") throw Error("timeout");
      if (mode === "21610") {
        return Response.json({ code: 21610 }, { status: 400 });
      }
      return Response.json({ sid: sid("SM"), status: "queued" });
    }
    return Response.json({
      sid: sid("PN"),
      account_sid: sid("AC"),
      service_sid: sid("MG"),
      capabilities: { sms: true },
    });
  };
  return {
    db,
    rows,
    transport,
    mode: (v: string) => {
      mode = v;
    },
    posts: () => posts,
    checks: () => checks,
    receipt: () => receipt,
    blocked: () => blocked,
  };
}
const input = {
  org,
  key: "synthetic-intent",
  to: "+19095551001",
  from: "+19095550100",
  body: "Synthetic only",
  purpose: "informational",
};
for (
  const mode of [
    "ok",
    "no-consent",
    "stop-race",
    "timeout",
    "21610",
    "persist-fail",
  ]
) {
  Deno.test(`dispatch ${mode}: no unintended retry`, async () => {
    const f = fixture();
    f.mode(mode);
    const original = globalThis.fetch;
    globalThis.fetch = f.transport;
    try {
      if (mode === "ok") {
        assert.ok(await dispatch(f.db, input, f.transport));
        assert.equal(
          (await dispatch(f.db, input, f.transport))?.replayed,
          true,
        );
        assert.equal(f.posts(), 1);
      } else {
        await assert.rejects(() => dispatch(f.db, input, f.transport));
        if (["timeout", "21610", "persist-fail"].includes(mode)) {
          await assert.rejects(() => dispatch(f.db, input, f.transport));
          assert.equal(f.posts(), 1);
        } else assert.equal(f.posts(), 0);
      }
      if (mode === "21610") assert.ok(f.blocked());
      if (mode === "timeout" || mode === "persist-fail") {
        assert.equal(f.receipt().state, "uncertain");
      }
    } finally {
      globalThis.fetch = original;
    }
  });
}
Deno.test("independent enforcement: missing registration or disabled A2P cannot fall back", async () => {
  const f = fixture();
  f.rows.a2p_accounts[0].sms_enforced = false;
  await assert.rejects(() => dispatch(f.db, input, f.transport));
  assert.equal(f.posts(), 0);
  f.rows.sms_agency_policies[0].send_enabled = false;
  await assert.rejects(() => dispatch(f.db, input, f.transport));
  f.rows.sms_agency_policies = [];
  assert.equal(await dispatch(f.db, input, f.transport), null);
});

const manualInput = {
  ...input,
  manual: true,
  key: `manual:${profile}:${id(90)}`,
  actor: profile,
  contactId: id(6),
  contactType: "lead",
  purpose: undefined,
  verifyRecipient: async () => {},
};
for (const mode of ["no-consent", "consent-unavailable"]) {
  Deno.test(`manual dispatch works with ${mode}, records no grant and sends once`, async () => {
    const f = fixture(), original = globalThis.fetch;
    f.mode(mode);
    globalThis.fetch = f.transport;
    let verified = 0;
    const request = {
      ...manualInput,
      verifyRecipient: async () => {
        verified++;
      },
    };
    try {
      assert.ok(await dispatch(f.db, request, f.transport));
      assert.equal(
        (await dispatch(f.db, request, f.transport))?.replayed,
        true,
      );
      assert.equal(f.posts(), 1);
      assert.equal(f.checks(), 0);
      assert.equal(verified, 1);
      assert.equal(f.receipt().purpose, "manual");
      assert.deepEqual(f.receipt().evidence_ids, []);
      assert.equal(f.receipt().confirmation_id, null);
      assert.equal(f.receipt().actor_id, profile);
      assert.equal(f.receipt().contact_id, id(6));
    } finally {
      globalThis.fetch = original;
    }
  });
}
Deno.test("manual mode requires actor, contact, actor-bound intent and recipient recheck", async () => {
  const f = fixture();
  for (
    const patch of [
      { actor: undefined },
      { actor: "bad" },
      { contactId: undefined },
      { contactType: "other" },
      { key: `manual:${id(77)}:${id(90)}` },
      { key: `manual:${profile}:workflow` },
      { verifyRecipient: undefined },
      {
        confirmation: {
          id: id(10),
          purposes: ["informational"],
          evidence: [id(5)],
        },
      },
      { manual: false, purpose: "manual" },
    ]
  ) {
    await assert.rejects(() =>
      dispatch(f.db, { ...manualInput, ...patch }, f.transport)
    );
  }
  assert.equal(f.posts(), 0);
  assert.equal(f.checks(), 0);
});
Deno.test("manual dispatch retains STOP at final handoff and active actor checks", async () => {
  const f = fixture(), original = globalThis.fetch;
  globalThis.fetch = f.transport;
  try {
    f.rows.profiles[0].status = "Inactive";
    await assert.rejects(
      () => dispatch(f.db, manualInput, f.transport),
      /account cannot send/,
    );
    f.rows.profiles[0].status = "Active";
    await assert.rejects(() =>
      dispatch(f.db, {
        ...manualInput,
        verifyRecipient: async () => {
          await recordInboundStop(f.db, org, {
            Body: "STOP",
            From: input.to,
            MessageSid: sid("SM"),
          });
        },
      }, f.transport)
    );
    assert.equal(f.posts(), 0);
    assert.ok(f.blocked());
    assert.equal(f.checks(), 0);
  } finally {
    globalThis.fetch = original;
  }
});
for (const mode of ["timeout", "21610", "persist-fail"]) {
  Deno.test(`manual dispatch ${mode} preserves suppression or uncertain receipt without retry`, async () => {
    const f = fixture(), original = globalThis.fetch;
    f.mode(mode);
    globalThis.fetch = f.transport;
    try {
      await assert.rejects(() => dispatch(f.db, manualInput, f.transport));
      await assert.rejects(() => dispatch(f.db, manualInput, f.transport));
      assert.equal(f.posts(), 1);
      assert.equal(f.checks(), 0);
      if (mode === "21610") assert.ok(f.blocked());
      else assert.equal(f.receipt().state, "uncertain");
    } finally {
      globalThis.fetch = original;
    }
  });
}
Deno.test("wrong sender, purpose, agency and consent response fail closed", async () => {
  const f = fixture();
  await assert.rejects(() =>
    dispatch(f.db, { ...input, from: "+19095550199" }, f.transport)
  );
  await assert.rejects(() =>
    dispatch(f.db, { ...input, purpose: undefined }, f.transport)
  );
  for (
    const patch of [{ organization_id: id(8) }, { phone: "+19095559999" }, {
      purpose: "marketing",
    }, { checked_at: "2020-01-01" }]
  ) {
    await assert.rejects(() =>
      eligibility(p, input.to, "informational", async () =>
        Response.json({
          organization_id: org,
          profile_id: profile,
          phone: input.to,
          purpose: "informational",
          allowed: true,
          checked_at: new Date().toISOString(),
          evidence: [{ id: id(5) }],
          ...patch,
        }))
    );
  }
  assert.equal(f.posts(), 0);
});
Deno.test("STOP variants and OptOutType persist for unmatched contacts; HELP/START never clear", async () => {
  for (
    const word of [
      "STOP",
      "stopall",
      "unsubscribe",
      "cancel",
      "end",
      "quit",
      "revoke",
      "optout",
    ]
  ) assert.ok(isStop({ Body: word }));
  assert.ok(isStop({ OptOutType: "STOP", Body: "custom" }));
  assert.ok(!isStop({ OptOutType: "HELP", Body: "HELP" }));
  assert.ok(!isStop({ OptOutType: "START", Body: "START" }));
  const f = fixture();
  await recordInboundStop(f.db, org, {
    Body: "STOP",
    From: input.to,
    MessageSid: sid("SM"),
  });
  assert.ok(f.blocked());
  await recordInboundStop(f.db, org, { Body: "START", From: input.to });
  assert.ok(f.blocked());
  await assert.rejects(() =>
    inboundCredential(f.db, org, {
      AccountSid: sid("AC"),
      MessagingServiceSid: "MGwrong",
      MessageSid: sid("SM"),
    })
  );
  assert.equal(
    await inboundCredential(f.db, org, {
      AccountSid: sid("AC"),
      MessagingServiceSid: sid("MG"),
      MessageSid: sid("SM"),
    }),
    "synthetic-token",
  );
});

Deno.test("changed recipient access at final handoff blocks provider submission", async () => {
  const f = fixture(), original = globalThis.fetch;
  globalThis.fetch = f.transport;
  try {
    await assert.rejects(() =>
      dispatch(f.db, {
        ...input,
        verifyRecipient: async () => {
          throw Error("contact changed");
        },
      }, f.transport)
    );
    assert.equal(f.posts(), 0);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("converted lead and a sender reassigned to personal cannot dispatch", async () => {
  const f = fixture(), original = globalThis.fetch;
  globalThis.fetch = f.transport;
  try {
    f.rows.clients = [{ id: id(7), organization_id: org, lead_id: id(6) }];
    await assert.rejects(
      () =>
        dispatch(
          f.db,
          { ...input, contactId: id(6), contactType: "lead" },
          f.transport,
        ),
      /converted client/,
    );
    assert.equal(f.posts(), 0);
    f.rows.phone_numbers[0].assignment_type = "personal";
    await assert.rejects(
      () => dispatch(f.db, input, f.transport),
      /approved texting/,
    );
    assert.equal(f.posts(), 0);
  } finally {
    globalThis.fetch = original;
  }
});
