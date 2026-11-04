import assert from "node:assert/strict";
import { registeredSender } from "./sending.ts";
import { A2pError } from "./types.ts";
import { dispatch, type Dispatch } from "../sms/dispatch.ts";

const org = "a1000000-0000-4000-8000-000000000001";
const actor = "a2000000-0000-4000-8000-000000000001";
const contact = "a3000000-0000-4000-8000-000000000001";
const numberId = "a4000000-0000-4000-8000-000000000001";
const requestId = "a5000000-0000-4000-8000-000000000001";
const denied = (e: unknown) => e instanceof A2pError && e.code === "TOLL_FREE_SMS_DISABLED" && e.status === 409;

function database(rows: Record<string, unknown>) {
  const reads: string[] = [];
  return {
    reads,
    rpc() { throw new Error("A blocked sender must never prepare or claim a message."); },
    from(table: string) {
      reads.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
      };
      return q;
    },
  };
}

Deno.test("all NANP toll-free prefixes fail before legacy, enforced, or absent A2P settings", async () => {
  let providerRequests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => { providerRequests++; throw new Error("No provider request is permitted."); };
  try {
    for (const prefix of ["800", "833", "844", "855", "866", "877", "888"]) {
      for (const account of [null, { sms_enforced: false }, { sms_enforced: true }]) {
        const db = database({ a2p_accounts: account });
        await assert.rejects(registeredSender(db, org, `+1${prefix}5550100`, actor), denied);
        assert.deepEqual(db.reads, [], "Verification cannot be bypassed by an account flag or lookup failure.");
      }
    }
    assert.equal(providerRequests, 0);
  } finally { globalThis.fetch = original; }
});

Deno.test("formatted US toll-free numbers cannot bypass the voice-only gate", async () => {
  for (const value of ["8005550100", "18005550100", "+1 (800) 555-0100", "1.888.555.0100"]) {
    await assert.rejects(registeredSender(database({}), org, value), denied);
  }
});

Deno.test("local numbers retain legacy A2P behavior and enforced approval checks", async () => {
  for (const account of [null, { sms_enforced: false }]) {
    const db = database({ a2p_accounts: account });
    assert.equal(await registeredSender(db, org, "+14155550100", actor), null);
    assert.deepEqual(db.reads, ["a2p_accounts"]);
  }
  await assert.rejects(
    registeredSender(database({ a2p_accounts: { sms_enforced: true, enabled: true } }), org, "+14155550100", actor),
    (e: unknown) => e instanceof A2pError && e.code === "A2P_NOT_READY",
  );
});

const input: Dispatch = {
  org, actor, key: "workflow:synthetic-only", to: "+14155550100", from: "+18005550100",
  body: "Synthetic verification only; never sent.", purpose: "informational",
};
for (const [entry, extra] of [
  ["workflow", {}],
  ["manual", {
    manual: true, key: `manual:${actor}:${requestId}`, contactId: contact, contactType: "lead",
    verifyRecipient: async () => {},
  }],
  ["confirmation", { confirmation: { id: requestId, purposes: ["informational"], evidence: [] } }],
] as const) {
  Deno.test(`${entry} dispatch rejects a selected toll-free sender before any send or message claim`, async () => {
    const db = database({
      sms_agency_policies: { enforced: true, send_enabled: true, selected_phone_ids: [numberId] },
      phone_numbers: { id: numberId, assignment_type: "agency" },
    });
    let transports = 0;
    await assert.rejects(dispatch(db, { ...input, ...extra } as Dispatch, () => {
      transports++;
      throw new Error("No transport is permitted.");
    }), denied);
    assert.equal(transports, 0);
    assert.equal(db.reads.includes("a2p_accounts"), false);
  });
}
