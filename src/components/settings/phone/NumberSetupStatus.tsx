import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NumberSetupRow } from "./useNumberSetupStatus";

const smsLabels: Record<NumberSetupRow["sms_state"], string> = {
  pending: "SMS setup queued", registering: "SMS registering", ready: "SMS ready",
  waiting: "SMS on hold", retry: "SMS setup delayed", review: "SMS needs attention",
  toll_free: "Toll-free verification required", voice_only: "Voice only", inactive: "SMS inactive",
};
const trustLabels: Record<NumberSetupRow["trust_state"], string> = {
  pending: "Linking agency profile", waiting: "Waiting for Trust Hub approval", retry: "Agency link delayed",
  review: "Agency link needs attention", linked: "Agency profile linked", inactive: "Agency link inactive",
};

const remedy: Record<string, string> = {
  agency_suspended: "Ask an administrator to review the agency’s phone service.",
  personal_number: "Check the assigned agent and authorized texting numbers.",
  profile_changed: "Ask support to verify the agency’s updated Trust Hub profile.",
  confirmation_overdue: "Registration confirmation is overdue. Ask support to check this number.",
  sender_limit: "The campaign has reached its number limit. Review the agency’s A2P registration.",
  account_mismatch: "Ask support to verify the Twilio account for this number.",
  mapping_conflict: "Ask support to check the number’s existing messaging service.",
  registration_failed: "Check the registration issue in A2P Registration.",
  service_configuration: "Ask support to check the campaign’s messaging service.",
  provider_review: "Ask support to review the number’s registration.",
  policy_disabled: "Check the agency’s texting settings.",
  policy_required: "Ask support to enable the agency’s texting policy.",
  registration_busy: "A registration update is in progress. This status will refresh automatically.",
  sender_not_selected: "Check the agency’s authorized SMS senders.",
  registration_stale: "Waiting for a current registration check.",
  sender_removed: "Check the sender in the agency’s messaging service.",
  trust_profile_rejected: "Review the agency profile in Trust Hub.",
  trust_profile_unverified: "Ask support to verify ownership of the agency profile.",
  trust_profile_conflict: "Ask support to verify the agency’s Trust Hub profile.",
  number_scope_changed: "Ask support to verify ownership of the number.",
  trust_assignment_conflict: "Ask support to check the existing Trust Hub assignment.",
};
function statusDetail(state: string, code: string | null) {
  if (!["waiting", "retry", "review"].includes(state)) return null;
  return (code && remedy[code.toLowerCase()]) || (state === "review" ? "Contact support to review setup." : null);
}
type Props = {
  row: NumberSetupRow; phone: string; onRetry: () => void;
  retrying: boolean; retryError: boolean; retryQueued: boolean;
};
export function NumberSetupStatus({ row, phone, onRetry, retrying, retryError, retryQueued }: Props) {
  const label = row.sms_state === "waiting" && row.sms_code === "waiting_agency"
    ? "Waiting for agency A2P approval" : smsLabels[row.sms_state];
  const details = [...new Set([statusDetail(row.sms_state, row.sms_code), statusDetail(row.trust_state, row.trust_code)])].filter(Boolean);
  return (
    <div className="mt-1 grid min-w-28 max-w-60 justify-items-start gap-1">
      <div role="status" className="space-y-1">
        <Badge variant="outline" className={row.sms_state === "ready"
          ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground"}>
          {label}
        </Badge>
        <p className="text-xs text-muted-foreground">{trustLabels[row.trust_state]}</p>
        {details.map(detail => <p className="text-xs text-muted-foreground" key={detail}>{detail}</p>)}
      </div>
      {row.can_retry && <Button type="button" size="sm" variant="link" className="h-auto px-0 text-xs"
        aria-label={`Retry setup for ${phone}`} disabled={retrying} onClick={onRetry}>
        {retrying ? "Requesting retry…" : "Retry setup"}
      </Button>}
      {row.can_retry && retryError && <p role="alert" className="text-xs text-destructive">Couldn’t request a retry. Try again.</p>}
      {row.can_retry && retryQueued && <p role="status" className="text-xs text-muted-foreground">Setup retry queued.</p>}
    </div>
  );
}
