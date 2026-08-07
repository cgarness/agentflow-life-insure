import type { TwilioNumberConfig } from "../_shared/twilioNumberConfig.ts";
import { numberConfigMatches } from "./ownership.ts";

export type TwilioResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

export type RepairStep =
  | "master_lookup"
  | "subaccount_lookup"
  | "transfer"
  | "configure"
  | "verify"
  | "database_update";

export class RepairStepError extends Error {
  constructor(
    public readonly step: RepairStep,
    public readonly httpStatus: number,
    public readonly payload: unknown,
  ) {
    super(`Number repair failed during ${step}`);
    this.name = "RepairStepError";
  }
}

export type RepairTwilioClient = {
  lookup: (
    resourceAccountSid: string,
    phoneNumberSid: string,
  ) => Promise<TwilioResponse>;
  transfer: (
    sourceAccountSid: string,
    phoneNumberSid: string,
    targetAccountSid: string,
  ) => Promise<TwilioResponse>;
  configure: (
    resourceAccountSid: string,
    phoneNumberSid: string,
    config: TwilioNumberConfig,
  ) => Promise<TwilioResponse>;
};

type RepairNumberInput = {
  masterAccountSid: string;
  subaccountSid: string;
  phoneNumberSid: string;
  config: TwilioNumberConfig;
  client: RepairTwilioClient;
  markTrustHubPending: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callTwilio(
  step: RepairStep,
  request: () => Promise<TwilioResponse>,
): Promise<TwilioResponse> {
  try {
    return await request();
  } catch {
    throw new RepairStepError(step, 502, "Twilio network request failed");
  }
}

function requireOk(step: RepairStep, response: TwilioResponse): void {
  if (!response.ok) {
    throw new RepairStepError(step, response.status, response.payload);
  }
}

export async function repairNumberOwnership(
  input: RepairNumberInput,
): Promise<{ status: "repaired" | "already_repaired" }> {
  const masterLookup = await callTwilio(
    "master_lookup",
    () => input.client.lookup(input.masterAccountSid, input.phoneNumberSid),
  );

  let status: "repaired" | "already_repaired" = "already_repaired";
  if (!masterLookup.ok) {
    if (masterLookup.status !== 404) {
      throw new RepairStepError(
        "master_lookup",
        masterLookup.status,
        masterLookup.payload,
      );
    }

    const subaccountLookup = await callTwilio(
      "subaccount_lookup",
      () => input.client.lookup(input.subaccountSid, input.phoneNumberSid),
    );
    requireOk("subaccount_lookup", subaccountLookup);
    if (
      !isRecord(subaccountLookup.payload) ||
      subaccountLookup.payload.account_sid !== input.subaccountSid
    ) {
      throw new RepairStepError(
        "subaccount_lookup",
        502,
        "Twilio returned an unexpected source account",
      );
    }

    const transfer = await callTwilio(
      "transfer",
      () =>
        input.client.transfer(
          input.subaccountSid,
          input.phoneNumberSid,
          input.masterAccountSid,
        ),
    );
    requireOk("transfer", transfer);
    status = "repaired";
  }

  const configured = await callTwilio(
    "configure",
    () =>
      input.client.configure(
        input.masterAccountSid,
        input.phoneNumberSid,
        input.config,
      ),
  );
  requireOk("configure", configured);

  const verification = await callTwilio(
    "verify",
    () => input.client.lookup(input.masterAccountSid, input.phoneNumberSid),
  );
  requireOk("verify", verification);
  if (
    !isRecord(verification.payload) ||
    !numberConfigMatches(
      verification.payload,
      input.masterAccountSid,
      input.config,
    )
  ) {
    throw new RepairStepError(
      "verify",
      502,
      "Twilio did not retain master ownership and callback configuration",
    );
  }

  try {
    await input.markTrustHubPending();
  } catch {
    throw new RepairStepError(
      "database_update",
      500,
      "Database status update failed",
    );
  }

  return { status };
}
