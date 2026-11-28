import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  REENTRY_OPTIONS, triggerNode, type AutomationGraph, type AutomationSettings, type Reentry,
} from "../../../../supabase/functions/_shared/automations/graph";
import Field from "../inspector/Field";
import { selectStyle } from "../lib/fieldStyles";
import { reentrySentence, stopRules } from "../review/audience";

interface Props {
  graph: AutomationGraph;
  readOnly?: boolean;
  onChange: (graph: AutomationGraph) => void;
}

const CHOICES: Record<Reentry, string> = {
  once: "Once",
  after_completion: "Again after a completed run",
  after_end: "Again after a run ends for any reason",
};
const STOP_KEYS = ["stop_on_reply", "stop_on_booking", "stop_on_contact"] as const;

/** Workflow-wide rules: when the same contact, appointment, call or policy may enter again, and what ends a run early. */
export default function RunRules({graph, readOnly, onChange}: Props) {
  const id = useId();
  const trigger = triggerNode(graph)?.type;
  const rules = stopRules(graph.settings);
  function set(patch: Partial<AutomationSettings>) {
    const settings = {...graph.settings, ...patch};
    // The two newer stop rules are stored only while they are on, so earlier drafts keep their exact shape.
    if (!settings.stop_on_booking) delete settings.stop_on_booking;
    if (!settings.stop_on_contact) delete settings.stop_on_contact;
    onChange({...graph, settings});
  }
  return <section aria-label="Run rules" className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
    <h3 className="text-base font-semibold">Run rules</h3>
    <fieldset disabled={readOnly} className="mt-3 min-w-0 space-y-4">
      <Field id={id + "reentry"} label="Re-entry" hint={reentrySentence(graph.settings.reentry, trigger) + "."}>
        <select id={id + "reentry"} className={selectStyle} aria-describedby={id + "reentry-hint"} value={graph.settings.reentry}
          onChange={event => set({reentry: event.target.value as Reentry})}>
          {REENTRY_OPTIONS.map(option => <option key={option} value={option}>{CHOICES[option]}</option>)}
        </select>
      </Field>
      <div className="space-y-1">
        {rules.map((rule, index) => <div key={STOP_KEYS[index]} className="flex min-h-11 items-center justify-between gap-3 md:min-h-9">
          <Label htmlFor={id + STOP_KEYS[index]} className="font-normal leading-5">{rule.label}</Label>
          <Switch id={id + STOP_KEYS[index]} checked={rule.on} onCheckedChange={on => set({[STOP_KEYS[index]]: on})}/>
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">A run can also be stopped by hand from Activity at any time.</p>
    </fieldset>
  </section>;
}
