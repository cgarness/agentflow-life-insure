// Rev 7 C10 — fleet-wide canonical-callback reconciliation (pure, dependency-free, Deno-free so it
// is unit-tested under vitest: src/lib/__tests__/numberReconciliation.test.ts).
//
// Why this exists: canonicalNumberConfig() only reaches a number when it is purchased or repaired,
// so every number already provisioned keeps whatever callback URL it was created with. After
// rev 6 C7 the status callback carries the connection-override retry fragment
// (#rc=3&rp=5xx,ct,rt) WITHOUT which twilio-voice-status' new 5xx responses are never redelivered
// and the terminal write + missed-call notification are lost. This reconciliation brings the
// existing fleet up to the canonical configuration, and is the deployment gate for that behavior.
//
// Contract (reusing the repair function's proven shape): per number — look up, skip when already
// canonical (idempotent, zero writes), otherwise configure, then READ BACK and verify the persisted
// Twilio configuration. Cross-account numbers are never configured. Any failure marks the whole run
// not-ok (fail closed on partial completion); every number is reported by phone-number SID AND
// database row id so an operator can act on the exact rows that did not converge.

import type { TwilioNumberConfig } from "../_shared/twilioNumberConfig.ts";
import { numberConfigMatches, sanitizeTwilioFailure } from "./ownership.ts";
import type { TwilioResponse } from "./repair.ts";

export type FleetNumberRow = {
  id: string;
  organization_id: string;
  phone_number: string;
  twilio_sid: string | null;
  status: string | null;
};

export type ReconcileTwilioClient = {
  lookup: (accountSid: string, phoneNumberSid: string) => Promise<TwilioResponse>;
  configure: (
    accountSid: string,
    phoneNumberSid: string,
    config: TwilioNumberConfig,
  ) => Promise<TwilioResponse>;
};

export type ReconcileStep =
  | "missing_sid"
  | "lookup"
  | "cross_account"
  | "configure"
  | "verify";

export type ReconcileNumberStatus = "reconciled" | "already_current" | "failed";

export type ReconcileNumberResult = {
  rowId: string;
  organizationId: string;
  phoneNumber: string;
  phoneNumberSid: string | null;
  status: ReconcileNumberStatus;
  step?: ReconcileStep;
  reason?: string;
  httpStatus?: number;
};

export type ReconcileReport = {
  ok: boolean;
  total: number;
  reconciled: number;
  alreadyCurrent: number;
  results: ReconcileNumberResult[];
  failures: ReconcileNumberResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  row: FleetNumberRow,
  step: ReconcileStep,
  reason: string,
  httpStatus?: number,
): ReconcileNumberResult {
  return {
    rowId: row.id,
    organizationId: row.organization_id,
    phoneNumber: row.phone_number,
    phoneNumberSid: row.twilio_sid,
    status: "failed",
    step,
    reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

async function reconcileOne(
  row: FleetNumberRow,
  masterAccountSid: string,
  config: TwilioNumberConfig,
  client: ReconcileTwilioClient,
): Promise<ReconcileNumberResult> {
  const sid = (row.twilio_sid || "").trim();
  if (!sid) {
    // Never guessed at from the phone number — an operator resolves it explicitly.
    return failure(row, "missing_sid", "Row has no twilio_sid");
  }

  let current: TwilioResponse;
  try {
    current = await client.lookup(masterAccountSid, sid);
  } catch {
    return failure(row, "lookup", "Twilio network request failed", 502);
  }
  if (!current.ok) {
    const s = sanitizeTwilioFailure(current.status, current.payload);
    return failure(row, "lookup", s.message, s.httpStatus);
  }
  if (!isRecord(current.payload)) {
    return failure(row, "lookup", "Twilio returned an unexpected payload", 502);
  }

  // Cross-account protection: this reconciliation only ever writes to numbers that already live in
  // the master account. A number owned elsewhere is reported for a targeted ownership repair.
  if (current.payload.account_sid !== masterAccountSid) {
    return failure(
      row,
      "cross_account",
      "Number is not owned by the master Twilio account — run the ownership repair first",
    );
  }

  // Idempotent: an already-canonical number is left completely untouched (no Twilio write).
  if (numberConfigMatches(current.payload, masterAccountSid, config)) {
    return {
      rowId: row.id,
      organizationId: row.organization_id,
      phoneNumber: row.phone_number,
      phoneNumberSid: sid,
      status: "already_current",
    };
  }

  let configured: TwilioResponse;
  try {
    configured = await client.configure(masterAccountSid, sid, config);
  } catch {
    return failure(row, "configure", "Twilio network request failed", 502);
  }
  if (!configured.ok) {
    const s = sanitizeTwilioFailure(configured.status, configured.payload);
    return failure(row, "configure", s.message, s.httpStatus);
  }

  // READ BACK: Twilio accepting the write is not proof it persisted the exact URLs (a normalized or
  // stripped fragment would silently leave the number without its retry policy).
  let verification: TwilioResponse;
  try {
    verification = await client.lookup(masterAccountSid, sid);
  } catch {
    return failure(row, "verify", "Twilio network request failed", 502);
  }
  if (!verification.ok) {
    const s = sanitizeTwilioFailure(verification.status, verification.payload);
    return failure(row, "verify", s.message, s.httpStatus);
  }
  if (
    !isRecord(verification.payload) ||
    !numberConfigMatches(verification.payload, masterAccountSid, config)
  ) {
    return failure(
      row,
      "verify",
      "Twilio did not retain the canonical voice/SMS/status callback configuration",
      502,
    );
  }

  return {
    rowId: row.id,
    organizationId: row.organization_id,
    phoneNumber: row.phone_number,
    phoneNumberSid: sid,
    status: "reconciled",
  };
}

/**
 * Reconcile every supplied number to the canonical configuration, sequentially (bounded Twilio API
 * pressure and deterministic reporting order). FAILS CLOSED: `ok` is true only when every number
 * ends the run verified-canonical.
 */
export async function reconcileNumberCallbacks(input: {
  rows: FleetNumberRow[];
  masterAccountSid: string;
  config: TwilioNumberConfig;
  client: ReconcileTwilioClient;
}): Promise<ReconcileReport> {
  const results: ReconcileNumberResult[] = [];
  for (const row of input.rows) {
    results.push(
      await reconcileOne(row, input.masterAccountSid, input.config, input.client),
    );
  }
  const failures = results.filter((r) => r.status === "failed");
  return {
    ok: failures.length === 0,
    total: results.length,
    reconciled: results.filter((r) => r.status === "reconciled").length,
    alreadyCurrent: results.filter((r) => r.status === "already_current").length,
    results,
    failures,
  };
}
