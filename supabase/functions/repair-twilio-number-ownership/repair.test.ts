import { canonicalNumberConfig } from "../_shared/twilioNumberConfig.ts";
import {
  repairNumberOwnership,
  type RepairStep,
  RepairStepError,
  type RepairTwilioClient,
  type TwilioResponse,
} from "./repair.ts";

const MASTER = `AC${"1".repeat(32)}`;
const SUBACCOUNT = `AC${"2".repeat(32)}`;
const NUMBER = `PN${"3".repeat(32)}`;
const CONFIG = canonicalNumberConfig("https://example.supabase.co");

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

async function assertRejectsAt(
  promise: Promise<unknown>,
  step: RepairStep,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RepairStepError && error.step === step) return;
    throw error;
  }
  throw new Error(`Expected repair to reject at ${step}`);
}

function verifiedPayload(): Record<string, unknown> {
  return {
    account_sid: MASTER,
    voice_url: CONFIG.voiceUrl,
    voice_method: CONFIG.voiceMethod,
    sms_url: CONFIG.smsUrl,
    sms_method: CONFIG.smsMethod,
    status_callback: CONFIG.statusCallback,
    status_callback_method: CONFIG.statusCallbackMethod,
  };
}

function response(
  ok: boolean,
  status: number,
  payload: unknown = {},
): TwilioResponse {
  return { ok, status, payload };
}

Deno.test("transfers a subaccount number, configures it, verifies it, then updates DB status", async () => {
  const events: string[] = [];
  let masterLookups = 0;
  const client: RepairTwilioClient = {
    lookup: async (accountSid) => {
      events.push(`lookup:${accountSid}`);
      if (accountSid === SUBACCOUNT) {
        return response(true, 200, { account_sid: SUBACCOUNT });
      }
      masterLookups += 1;
      return masterLookups === 1
        ? response(false, 404, { code: 20404 })
        : response(true, 200, verifiedPayload());
    },
    transfer: async (source, _number, target) => {
      events.push(`transfer:${source}:${target}`);
      return response(true, 200);
    },
    configure: async (accountSid) => {
      events.push(`configure:${accountSid}`);
      return response(true, 200);
    },
  };

  const result = await repairNumberOwnership({
    masterAccountSid: MASTER,
    subaccountSid: SUBACCOUNT,
    phoneNumberSid: NUMBER,
    config: CONFIG,
    client,
    markTrustHubPending: async () => {
      events.push("database");
    },
  });

  assertEquals(result, { status: "repaired" });
  assertEquals(events, [
    `lookup:${MASTER}`,
    `lookup:${SUBACCOUNT}`,
    `transfer:${SUBACCOUNT}:${MASTER}`,
    `configure:${MASTER}`,
    `lookup:${MASTER}`,
    "database",
  ]);
});

Deno.test("an already-master-owned number is idempotently reconfigured without transfer", async () => {
  let transfers = 0;
  let configurations = 0;
  let databaseUpdates = 0;
  const client: RepairTwilioClient = {
    lookup: async () => response(true, 200, verifiedPayload()),
    transfer: async () => {
      transfers += 1;
      return response(true, 200);
    },
    configure: async () => {
      configurations += 1;
      return response(true, 200);
    },
  };

  const result = await repairNumberOwnership({
    masterAccountSid: MASTER,
    subaccountSid: SUBACCOUNT,
    phoneNumberSid: NUMBER,
    config: CONFIG,
    client,
    markTrustHubPending: async () => {
      databaseUpdates += 1;
    },
  });

  assertEquals(result, { status: "already_repaired" });
  assertEquals(transfers, 0);
  assertEquals(configurations, 1);
  assertEquals(databaseUpdates, 1);
});

Deno.test("a transfer failure stops before configuration and database update", async () => {
  let configured = false;
  let databaseUpdated = false;
  const client: RepairTwilioClient = {
    lookup: async (accountSid) =>
      accountSid === MASTER
        ? response(false, 404)
        : response(true, 200, { account_sid: SUBACCOUNT }),
    transfer: async () => response(false, 400, { code: 21452 }),
    configure: async () => {
      configured = true;
      return response(true, 200);
    },
  };

  await assertRejectsAt(
    repairNumberOwnership({
      masterAccountSid: MASTER,
      subaccountSid: SUBACCOUNT,
      phoneNumberSid: NUMBER,
      config: CONFIG,
      client,
      markTrustHubPending: async () => {
        databaseUpdated = true;
      },
    }),
    "transfer",
  );
  assertEquals(configured, false);
  assertEquals(databaseUpdated, false);
});

Deno.test("configuration or verification failure never updates DB status", async () => {
  for (const failingStep of ["configure", "verify"] as const) {
    let lookups = 0;
    let databaseUpdated = false;
    const client: RepairTwilioClient = {
      lookup: async () => {
        lookups += 1;
        return lookups === 1
          ? response(true, 200, verifiedPayload())
          : response(true, 200, {
            ...verifiedPayload(),
            sms_url: "https://wrong.example",
          });
      },
      transfer: async () => response(true, 200),
      configure: async () =>
        failingStep === "configure"
          ? response(false, 400, { code: 21602 })
          : response(true, 200),
    };

    await assertRejectsAt(
      repairNumberOwnership({
        masterAccountSid: MASTER,
        subaccountSid: SUBACCOUNT,
        phoneNumberSid: NUMBER,
        config: CONFIG,
        client,
        markTrustHubPending: async () => {
          databaseUpdated = true;
        },
      }),
      failingStep,
    );
    assertEquals(databaseUpdated, false);
  }
});

Deno.test("a database failure is explicit after Twilio verification", async () => {
  const client: RepairTwilioClient = {
    lookup: async () => response(true, 200, verifiedPayload()),
    transfer: async () => response(true, 200),
    configure: async () => response(true, 200),
  };

  await assertRejectsAt(
    repairNumberOwnership({
      masterAccountSid: MASTER,
      subaccountSid: SUBACCOUNT,
      phoneNumberSid: NUMBER,
      config: CONFIG,
      client,
      markTrustHubPending: async () => {
        throw new Error("database unavailable");
      },
    }),
    "database_update",
  );
});
