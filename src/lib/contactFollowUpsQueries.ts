/**
 * Per-contact reads for the Follow-ups card: appointments + (leads only) campaign callbacks.
 * Tasks come from the Tasks tab's own shared query (`tasksApi.getTasks` under `["tasks", contactId]`).
 *
 * - Tenant-scoped (`organization_id`) and contact-scoped through parameterized `.eq()`; RLS alone
 *   decides what this viewer may read — nothing is broadened and no owner filter is added.
 * - Fails closed: every read is checked, a failure cancels its sibling, and the call rejects only
 *   after every read has settled. It never returns a partial set.
 * - An empty result is "none visible", never an error (RLS / stale JWT role claims can legitimately
 *   hide rows, AGENT_RULES #19 / #22).
 */
import { supabase } from "@/integrations/supabase/client";
import { TERMINAL_CAMPAIGN_LEAD_STATUSES } from "@/lib/dashboard-callbacks";
import { assertNoQueryError, type ContactType } from "@/lib/dashboard-contact-identity";
import { OPEN_APPOINTMENT_STATUSES } from "@/lib/calendar/appointmentOwnership";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";
import type { FollowUpAppointmentRow, FollowUpCampaignRow } from "@/lib/contactFollowUps";

/** Per-source cap. Real per-contact volumes are tiny; hitting it marks the counts "at least". */
export const FOLLOW_UP_SOURCE_LIMIT = 200;

const APPOINTMENT_COLUMNS = "id, title, type, status, start_time, end_time, notes, user_id, created_by, contact_id";
const CAMPAIGN_COLUMNS =
  "id, lead_id, status, callback_due_at, scheduled_callback_at, callback_agent_id, callback_note, campaigns(name)";

export interface ContactFollowUpRows {
  appointments: FollowUpAppointmentRow[];
  campaign: FollowUpCampaignRow[];
  truncated: boolean;
}

/** A read cancelled by its caller (unmount, contact switch, refetch). Not a failure; never logged. */
export class FollowUpsCancelledError extends Error {
  constructor() {
    super("Follow-ups read cancelled");
    this.name = "FollowUpsCancelledError";
  }
}

export async function fetchContactFollowUpRows(opts: {
  contactId: string;
  contactType: ContactType;
  organizationId: string;
  signal?: AbortSignal;
}): Promise<ContactFollowUpRows> {
  const { contactId, contactType, organizationId } = opts;
  const cancel = linkedAbort(opts.signal);

  const checked = <T,>(context: string) => (res: { data: T[] | null; error: unknown }): T[] => {
    if (cancel.signal.aborted) throw new FollowUpsCancelledError();
    assertNoQueryError(`contact-followups:${context}`, res);
    return res.data ?? [];
  };

  const appointmentsRead = (supabase as any)
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .in("status", [...OPEN_APPOINTMENT_STATUSES])
    .order("start_time", { ascending: true })
    .order("id", { ascending: true })
    .limit(FOLLOW_UP_SOURCE_LIMIT)
    .abortSignal(cancel.signal)
    .then(checked<FollowUpAppointmentRow>("appointments"));

  // campaign_leads links to leads only; clients and recruits have no campaign callbacks to read.
  const campaignRead: Promise<FollowUpCampaignRow[]> =
    contactType === "lead"
      ? (supabase as any)
          .from("campaign_leads")
          .select(CAMPAIGN_COLUMNS)
          .eq("organization_id", organizationId)
          .eq("lead_id", contactId)
          .not("status", "in", `(${TERMINAL_CAMPAIGN_LEAD_STATUSES.join(",")})`)
          // Static column-only expression; no id is ever interpolated into this raw filter.
          .or("callback_due_at.not.is.null,scheduled_callback_at.not.is.null")
          .order("id", { ascending: true })
          .limit(FOLLOW_UP_SOURCE_LIMIT)
          .abortSignal(cancel.signal)
          .then(checked<FollowUpCampaignRow>("campaign-callbacks"))
      : Promise.resolve([]);

  try {
    const [appointments, campaign] = await settleAll([appointmentsRead, campaignRead] as const, cancel.abort);
    return {
      appointments,
      campaign,
      truncated: appointments.length >= FOLLOW_UP_SOURCE_LIMIT || campaign.length >= FOLLOW_UP_SOURCE_LIMIT,
    };
  } finally {
    cancel.dispose();
  }
}
