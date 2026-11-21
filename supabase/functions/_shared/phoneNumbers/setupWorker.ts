import type { Db } from "../a2p/types.ts";
import { checked } from "../a2p/store.ts";
import type { SetupJob, SetupOutcome } from "./setupTypes.ts";

type Processor = (
  db: Db,
  job: SetupJob,
  signal: AbortSignal,
) => Promise<SetupOutcome>;

async function currentScope(
  db: Db,
  job: SetupJob,
  signal: AbortSignal,
): Promise<SetupOutcome | null> {
  const [org, number] = await Promise.all([
    db.from("organizations").select("status,twilio_subaccount_status")
      .eq("id", job.organization_id).abortSignal(signal).maybeSingle(),
    db.from("phone_numbers").select("id").eq("id", job.phone_number_id).eq(
      "organization_id",
      job.organization_id,
    )
      .eq("phone_number", job.phone_number).eq("twilio_sid", job.phone_sid).in(
        "status",
        ["active", "Active"],
      )
      .abortSignal(signal).maybeSingle(),
  ]);
  const agency = checked(org) as {
    status: string;
    twilio_subaccount_status: string;
  } | null;
  if (
    !agency || agency.status !== "active" ||
    agency.twilio_subaccount_status !== "active"
  ) {
    return { state: "waiting", code: "agency_suspended", retrySeconds: 900 };
  }
  return checked(number) ? null : { state: "review", code: "inactive_number" };
}

export async function runNumberSetup(
  db: Db,
  processors: Record<SetupJob["kind"], Processor>,
  signal: AbortSignal,
) {
  let processed = 0, retrying = 0, superseded = 0;
  // Claim one at a time so no job sits in a batch while another uses up its lease.
  for (let i = 0; i < 8 && !signal.aborted; i++) {
    const rows = checked(
      await db.rpc("phone_number_setup_claim").abortSignal(signal),
    ) as SetupJob[];
    if (!rows.length) break;
    const job = rows[0];
    const backoff = Math.min(3600, 30 * 2 ** Math.min(7, job.attempts));
    let outcome: SetupOutcome;
    try {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
      outcome = await currentScope(db, job, deadline) ??
        await processors[job.kind](db, job, deadline);
    } catch {
      // Re-read provider membership on the next lease, including after lost responses.
      outcome = { state: "retry", code: "PROVIDER_RETRY" };
    }
    const saved = checked(
      await db.rpc("phone_number_setup_finish", {
        p_purchase: job.purchase_id,
        p_kind: job.kind,
        p_lease: job.lease_token,
        p_state: outcome.state,
        p_code: outcome.code,
        p_retry_seconds: outcome.retrySeconds ?? backoff,
        p_profile_sid: outcome.profileSid ?? null,
      }).abortSignal(AbortSignal.timeout(5000)),
    );
    if (!saved) superseded++;
    else {
      processed++;
      if (outcome.state === "retry") retrying++;
    }
  }
  return { processed, retrying, superseded };
}
