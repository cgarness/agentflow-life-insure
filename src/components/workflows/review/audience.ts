import type { SummaryNames } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import {
  graphBlock, type AutomationNode, type AutomationSettings, type Reentry,
} from "../../../../supabase/functions/_shared/automations/graph";

// What a run belongs to. A second event for the same one is what the re-entry rule decides.
const SUBJECTS: Record<string, string> = {
  appointment_booked: "appointment",
  appointment_outcome_recorded: "appointment",
  inbound_call_missed: "call",
  sale_recorded: "policy",
  policy_issuance_confirmed: "policy",
};

function either(items: string[]): string {
  return items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " or " + items[items.length - 1];
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Who can enter the workflow, in words, for each kind of trigger. */
export function audienceSentence(trigger: AutomationNode | undefined, names: SummaryNames = {}): string {
  if (!trigger) return "Choose a trigger";
  const config = trigger.config;
  const source = config.lead_source ? " · Lead source: " + String(config.lead_source) : "";
  switch (trigger.type) {
    case "lead_created":
      return "Newly created agency leads" + source;
    case "campaign_membership_created":
      return "Leads added to " + (config.any_campaign === true
        ? "any campaign you can manage"
        : (config.campaign_id && names.campaign?.(String(config.campaign_id))) || "the selected campaign") + source;
    case "disposition_recorded": {
      const chosen = strings(config.disposition_ids).map(id => names.disposition?.(id) ?? "a selected disposition");
      return chosen.length ? "Contacts saved with the disposition " + either([...new Set(chosen)]) : "Contacts saved with a disposition you choose";
    }
    case "appointment_booked":
      return "Contacts with a newly booked appointment, not counting callbacks";
    case "appointment_outcome_recorded": {
      const chosen = strings(config.outcomes).map(outcome => outcome === "no_show" ? "a no-show" : "held");
      return chosen.length ? "Contacts whose appointment is recorded as " + either(chosen) : "Contacts whose appointment outcome is recorded";
    }
    case "inbound_call_missed":
      return "Callers whose inbound call ends without an answer";
    case "sale_recorded":
      return "Clients with a newly recorded policy sale";
    case "policy_issuance_confirmed":
      return "Clients whose policy issuance is confirmed";
    default:
      return graphBlock(trigger)?.label ?? "Unsupported trigger";
  }
}

export function reentrySentence(reentry: Reentry, triggerType: string | undefined): string {
  const subject = SUBJECTS[triggerType ?? ""] ?? "contact";
  if (reentry === "after_completion") return "Again for the same " + subject + " once its earlier run has completed";
  if (reentry === "after_end") return "Again for the same " + subject + " once its earlier run has ended, even if that run was stopped or failed";
  return "Once per " + subject;
}

/** The three stop settings. A run can also be stopped by hand at any time. */
export function stopRules(settings: AutomationSettings): {label: string; on: boolean}[] {
  return [
    {label: "Stop when the contact replies", on: settings.stop_on_reply === true},
    {label: "Stop when an appointment is booked", on: settings.stop_on_booking === true},
    {label: "Stop when the contact is reached on a later call", on: settings.stop_on_contact === true},
  ];
}
