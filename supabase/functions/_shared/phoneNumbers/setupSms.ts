import { credentials } from "../a2p/auth.ts";
import { attachNumber } from "../a2p/numberAttachment.ts";
import { TwilioA2p } from "../a2p/provider.ts";
import { account, registration } from "../a2p/store.ts";
import { A2pError, type Account, campaignReady, type Db } from "../a2p/types.ts";
import type { SetupJob, SetupOutcome } from "./setupTypes.ts";

const waiting: SetupOutcome = {
  state: "waiting",
  code: "waiting_agency",
  retrySeconds: 900,
};

function outcome(error: unknown, attempts: number): SetupOutcome {
  if (!(error instanceof A2pError)) throw error;
  if (error.code === "CAMPAIGN_NOT_READY") return waiting;
  if (error.code === "INTENT_UNCONFIRMED") {
    return attempts < 4
      ? { state: "retry", code: "provider_retry", retrySeconds: 120 }
      : { state: "review", code: "provider_review" };
  }
  if (error.code === "SENDER_LIMIT" || [30125, 21714].includes(error.providerCode ?? 0)) {
    return { state: "review", code: "sender_limit" };
  }
  if (["ACCOUNT_MISMATCH", "ACCOUNT_CHANGED"].includes(error.code)) {
    return { state: "review", code: "account_mismatch" };
  }
  if (error.code === "NUMBER_MAPPING_CHANGED" || error.providerCode === 21712) {
    return { state: "review", code: "mapping_conflict" };
  }
  if (error.code === "REGISTRATION_FAILED") {
    return { state: "review", code: "registration_failed" };
  }
  if (error.code === "SERVICE_CONFIGURATION") {
    return { state: "review", code: "service_configuration" };
  }
  if (error.code === "NUMBER_UNAVAILABLE") {
    return { state: "review", code: "inactive_number" };
  }
  if (error.code === "VOICE_ONLY" || error.code === "NUMBER_NO_SMS" || error.providerCode === 21715) {
    return { state: "review", code: "voice_only" };
  }
  if (error.code === "NUMBER_ACCOUNT") {
    return { state: "review", code: "account_mismatch" };
  }
  if (
    error.code === "PROVIDER_429" || error.providerCode === 21710 ||
    error.status >= 500 ||
    ["OPERATION_PENDING", "SYNC_BUSY", "OPERATION_LOST"].includes(error.code)
  ) {
    return { state: "retry", code: "provider_retry" };
  }
  return { state: "review", code: "provider_review" };
}

async function openProvider(db: Db, a: Account, signal: AbortSignal) {
  return new TwilioA2p(await credentials(db, a), fetch, signal);
}

export async function setupSms(
  db: Db,
  job: SetupJob,
  signal: AbortSignal,
  open = openProvider,
): Promise<SetupOutcome> {
  if (job.number_type === "toll_free") {
    return { state: "complete", code: "toll_free" };
  }
  try {
    const [a, r] = await Promise.all([
      account(db, job.organization_id),
      registration(db, job.organization_id),
    ]);
    let stop: SetupOutcome | undefined;
    if (
      !a?.enabled || !a.sms_enforced || !a.resources_reconciled_at || !r ||
      !campaignReady(r)
    ) stop = waiting;
    if (
      (a && a.account_sid !== job.account_sid) ||
      (r?.account_sid && r.account_sid !== job.account_sid)
    ) {
      stop = { state: "review", code: "account_mismatch" };
    }
    if (stop || !a || !r) {
      return stop ?? waiting;
    }
    const t = await open(db, a, signal);
    await attachNumber(db, t, a, r, job.phone_number_id, job.actor_id, { ...job, signal });
    // Only a signed per-number event can change a2p_numbers.status to registered.
    return { state: "complete", code: "submitted" };
  } catch (error) {
    return outcome(error, job.attempts);
  }
}
