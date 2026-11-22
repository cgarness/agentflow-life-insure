import { useId, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TIMEZONES } from "@/components/settings/brandingConfig";
import type { EmailSender } from "@/lib/automation-channels";
import { APPOINTMENT_OUTCOMES } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import { APPOINTMENT_TRIGGERS } from "../../../../supabase/functions/_shared/automations/fields";
import {
  blocks, graphBlock, previewGraph, stepTitle, triggerNode, type AutomationGraph,
} from "../../../../supabase/functions/_shared/automations/graph";
import Field from "../inspector/Field";
import OptionsAlert from "../inspector/OptionsAlert";
import { selectStyle } from "../lib/fieldStyles";
import { useCampaignOptions, useDispositionOptions } from "../useAutomationOptions";
import { browserTimeZone, previewInput, type PreviewFlags, type PreviewValues } from "./previewInput";

interface Props {
  graph: AutomationGraph;
  scope: string;
  /** Verified sender identities for the email steps, by sender ID. */
  senders: Record<string, EmailSender>;
}

const CONTACT = [["first_name", "First name"], ["last_name", "Last name"], ["email", "Email"], ["phone", "Phone"], ["lead_source", "Lead source"]] as const;
const triggers = blocks.filter(block => block.category === "trigger");

/** Test values in, the path a run would take out. Nothing is enrolled, sent or saved. */
export default function PreviewForm({graph, scope, senders}: Props) {
  const id = useId();
  const trigger = triggerNode(graph);
  const editors = new Set(graph.nodes.map(node => graphBlock(node)?.editor));
  const [device] = useState(browserTimeZone);
  const [values, setValues] = useState<PreviewValues>({timezone: device});
  const [flags, setFlags] = useState<PreviewFlags>({sms_eligible: true, email_eligible: true, lookup_failed: false, assigned: true});
  const campaigns = useCampaignOptions(scope, String(trigger?.config.campaign_id ?? ""), true);
  const dispositions = useDispositionOptions(scope, trigger?.type === "disposition_recorded");
  const set = (key: keyof PreviewValues) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues(current => ({...current, [key]: event.target.value}));
  const checks: {key: keyof PreviewFlags; label: string; shown: boolean}[] = [
    {key: "sms_eligible", label: "SMS sender and contact eligible", shown: editors.has("sms")},
    {key: "email_eligible", label: "Email sender and contact eligible", shown: editors.has("email")},
    {key: "lookup_failed", label: "Contact lookup unavailable", shown: editors.has("emailCondition")},
    {key: "assigned", label: "Contact has an assigned agent", shown: editors.has("task")},
  ];
  const rows = previewGraph(graph, previewInput(trigger?.type, values, flags, senders));
  const title = (nodeId: string) => {
    const node = graph.nodes.find(step => step.id === nodeId);
    return node ? stepTitle(node) : "";
  };
  return <>
    <p className="text-muted-foreground">Enter test values to see what each step would do. Nothing is sent and no contact is enrolled.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id + "event"} label="Test event">
        <select id={id + "event"} className={selectStyle} value={values.trigger ?? trigger?.type ?? ""} onChange={set("trigger")}>
          {triggers.map(option => <option key={option.type} value={option.type}>{option.label}</option>)}
        </select>
      </Field>
      <Field id={id + "campaign"} label="Test campaign">
        <select id={id + "campaign"} className={selectStyle} value={values.campaign_id ?? ""} onChange={set("campaign_id")}>
          <option value="">None</option>
          {campaigns.items.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select>
        {campaigns.hasNextPage && <Button type="button" variant="link" className="h-11 px-0 md:h-9" disabled={campaigns.isFetchingNextPage}
          onClick={() => { void campaigns.fetchNextPage(); }}>Load more campaigns</Button>}
        {campaigns.isError && <OptionsAlert what="Campaigns" onRetry={() => { void campaigns.refetch(); }}/>}
      </Field>
      {trigger?.type === "disposition_recorded" && <Field id={id + "disposition"} label="Test disposition">
        <select id={id + "disposition"} className={selectStyle} value={values.disposition_id ?? ""} onChange={set("disposition_id")}>
          <option value="">Not specified</option>
          {dispositions.data?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        {dispositions.isError && <OptionsAlert what="Dispositions" onRetry={() => { void dispositions.refetch(); }}/>}
      </Field>}
      {trigger?.type === "appointment_outcome_recorded" && <Field id={id + "outcome"} label="Test outcome">
        <select id={id + "outcome"} className={selectStyle} value={values.outcome ?? ""} onChange={set("outcome")}>
          <option value="">Not specified</option>
          {APPOINTMENT_OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{outcome === "no_show" ? "No-show" : "Held"}</option>)}
        </select>
      </Field>}
      {CONTACT.map(([key, label]) => <Field key={key} id={id + key} label={label}>
        <Input id={id + key} value={values[key] ?? ""} onChange={set(key)}/>
      </Field>)}
      {!!trigger && APPOINTMENT_TRIGGERS.includes(trigger.type) && <>
        <Field id={id + "start"} label="Appointment start">
          <Input id={id + "start"} type="datetime-local" value={values.appointment_start ?? ""} onChange={set("appointment_start")}/>
        </Field>
        <Field id={id + "zone"} label="Time zone">
          <select id={id + "zone"} className={selectStyle} value={values.timezone} onChange={set("timezone")}>
            {!TIMEZONES.some(group => group.options.some(option => option.value === device)) && <option value={device}>{device} (this device)</option>}
            {TIMEZONES.map(group => <optgroup key={group.group} label={group.group}>
              {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>)}
          </select>
        </Field>
      </>}
    </div>
    {checks.some(check => check.shown) && <div className="flex flex-wrap gap-x-6 gap-y-1">
      {checks.filter(check => check.shown).map(check => <label key={check.key} className="flex min-h-11 cursor-pointer items-center gap-2 md:min-h-9">
        <Checkbox checked={flags[check.key]} onCheckedChange={checked => setFlags(current => ({...current, [check.key]: checked === true}))}/>
        {check.label}
      </label>)}
    </div>}
    <ol aria-label="Preview results" className="space-y-2">
      {rows.map((row, index) => <li key={index} className="whitespace-pre-wrap rounded-md bg-muted p-3">
        <strong className="font-semibold">{title(row.nodeId)}</strong> {row.detail}
      </li>)}
    </ol>
  </>;
}
