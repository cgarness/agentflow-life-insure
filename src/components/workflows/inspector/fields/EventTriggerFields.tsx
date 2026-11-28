import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { APPOINTMENT_OUTCOMES, type BlockEditor } from "../../../../../supabase/functions/_shared/automations/blockRegistry";
import { graphBlock } from "../../../../../supabase/functions/_shared/automations/graph";
import { useDispositionOptions } from "../../useAutomationOptions";
import OptionsAlert from "../OptionsAlert";
import { patchConfig, type EditorProps } from "../stepConfig";

const MAX_DISPOSITIONS = 20;
const OUTCOME_LABELS: Record<(typeof APPOINTMENT_OUTCOMES)[number], string> = {no_show: "No-show", held: "Held"};
const EXPLANATIONS: Partial<Record<BlockEditor, string>> = {
  disposition: "Starts when an agent saves a disposition you check. Check at least one. The same result again while a run is still going does not start another.",
  appointment: "Starts when an appointment is booked with a contact. Callbacks are not included. If the appointment moves, a waiting reminder moves with it. If it is cancelled, the run ends.",
  appointmentOutcome: "Starts when a person records the outcome you check. Check at least one. An appointment whose time has simply passed does not count.",
  inboundMissed: "Starts when an inbound call ends without anyone answering, on a computer or a connected phone. A task step then makes one callback per call: for the responsible agent when there is one, otherwise in Inbounds for any agent to claim.",
  sale: "Starts when a new policy sale is recorded. Policies entered as history do not count. Each policy is followed separately.",
  issuance: "Starts only when someone confirms issuance on the policy. A recorded sale or an effective date does not count.",
};
const row = "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent md:min-h-9";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Settings for the triggers that start from a recorded event rather than a new lead. */
export default function EventTriggerFields({node, scope, onChange}: EditorProps) {
  const id = useId();
  const editor = graphBlock(node)?.editor;
  const dispositions = useDispositionOptions(scope, editor === "disposition");
  const chosen = strings(node.config.disposition_ids);
  const outcomes = strings(node.config.outcomes);
  // A disposition deleted since the step was saved stays listed so the author can clear it.
  const removed = dispositions.data ? chosen.filter(value => !dispositions.data.some(option => option.id === value)) : [];
  const toggle = (key: "disposition_ids" | "outcomes", current: string[], value: string, order?: readonly string[]) => {
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onChange(patchConfig(node, {[key]: next.length ? (order ? order.filter(item => next.includes(item)) : next) : undefined}));
  };
  return <>
    {editor === "disposition" && <div role="group" aria-labelledby={id + "dispositions"} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p id={id + "dispositions"} className="text-sm font-medium leading-none">Dispositions</p>
        <p className="text-xs text-muted-foreground" aria-live="polite">{chosen.length} selected</p>
      </div>
      {dispositions.isError ? <OptionsAlert what="Dispositions" onRetry={() => { void dispositions.refetch(); }}/>
        : dispositions.isPending ? <p role="status" className="text-muted-foreground">Loading dispositions…</p>
        : !dispositions.data.length && !removed.length ? <p className="text-muted-foreground">Your agency has no dispositions yet.</p>
        : <div className="max-h-64 overflow-y-auto rounded-md border p-1">
          {dispositions.data.map(option => <label key={option.id} className={row}>
            <Checkbox checked={chosen.includes(option.id)} disabled={!chosen.includes(option.id) && chosen.length >= MAX_DISPOSITIONS}
              onCheckedChange={() => toggle("disposition_ids", chosen, option.id)}/>
            <svg viewBox="0 0 8 8" className="h-2.5 w-2.5 shrink-0" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={option.color}/></svg>
            <span className="min-w-0 truncate">{option.name}</span>
          </label>)}
          {removed.map(value => <label key={value} className={row}>
            <Checkbox checked onCheckedChange={() => toggle("disposition_ids", chosen, value)}/>
            <span className="text-muted-foreground">Disposition no longer available</span>
          </label>)}
        </div>}
      {chosen.length >= MAX_DISPOSITIONS && <p className="text-xs text-muted-foreground">A trigger can use up to {MAX_DISPOSITIONS} dispositions.</p>}
    </div>}
    {editor === "appointmentOutcome" && <div role="group" aria-labelledby={id + "outcomes"} className="space-y-1.5">
      <p id={id + "outcomes"} className="text-sm font-medium leading-none">Outcomes</p>
      {APPOINTMENT_OUTCOMES.map(outcome => <label key={outcome} className={row}>
        <Checkbox checked={outcomes.includes(outcome)} onCheckedChange={() => toggle("outcomes", outcomes, outcome, APPOINTMENT_OUTCOMES)}/>
        {OUTCOME_LABELS[outcome]}
      </label>)}
    </div>}
    {editor && EXPLANATIONS[editor] && <p className="text-muted-foreground">{EXPLANATIONS[editor]}</p>}
  </>;
}
