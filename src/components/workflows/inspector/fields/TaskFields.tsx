import { useId } from "react";
import { Input } from "@/components/ui/input";
import { TASK_TYPES } from "../../../../../supabase/functions/_shared/automations/blockRegistry";
import { triggerNode } from "../../../../../supabase/functions/_shared/automations/graph";
import { selectStyle } from "../../lib/fieldStyles";
import Field from "../Field";
import PersonalizedField from "../PersonalizedField";
import { patchConfig, textValue, type EditorProps } from "../stepConfig";

const UNITS = ["minutes", "hours", "days"] as const;
// The two selects always show a choice, so that choice is stored with the author's first edit.
const SHOWN = {task_type: "Follow Up", due_unit: "days"};

/** A task for the contact's assigned agent, due a set time after the event that started the run or the end the last wait was given. */
export default function TaskFields({graph, node, issues, onChange}: EditorProps) {
  const id = useId();
  const trigger = triggerNode(graph)?.type;
  const amount = typeof node.config.due_amount === "number" ? node.config.due_amount : undefined;
  const type = textValue(node, "task_type") || SHOWN.task_type, unit = textValue(node, "due_unit") || SHOWN.due_unit;
  const change = (patch: Record<string, unknown>) => onChange(patchConfig(node, {task_type: type, due_unit: unit, ...patch}));
  return <>
    <PersonalizedField label="Task title" value={textValue(node, "title")} maxLength={200} trigger={trigger} issues={issues}
      onChange={title => change({title})}/>
    <Field id={id + "type"} label="Task type">
      <select id={id + "type"} className={selectStyle} value={type} onChange={event => change({task_type: event.target.value})}>
        {TASK_TYPES.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </Field>
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Field id={id + "due"} label="Due">
          <Input id={id + "due"} type="number" inputMode="numeric" min={0} step={1} placeholder="0" aria-describedby={id + "when"}
            value={amount ?? ""} onChange={event => change({due_amount: event.target.value === "" ? undefined : Number(event.target.value)})}/>
        </Field>
        <Field id={id + "unit"} label="Unit">
          <select id={id + "unit"} className={selectStyle} value={unit} onChange={event => change({due_unit: event.target.value})}>
            {UNITS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
      </div>
      <p id={id + "when"} className="text-xs text-muted-foreground">
        {amount === 0 && <span className="font-medium text-foreground">Due right away. </span>}Counted from the event that started
        the automation or, after a wait, from the time that wait was set to end. A late or held step after that does not move it.
      </p>
    </div>
    <PersonalizedField label="Notes" multiline value={textValue(node, "notes")} maxLength={2000} trigger={trigger} issues={issues}
      className="text-base md:text-sm" onChange={notes => change({notes: notes || undefined})}/>
    <p className="text-muted-foreground">
      The task goes to the contact's assigned agent.
      {trigger === "inbound_call_missed" && " A missed call without a matched contact or responsible agent becomes a callback in Inbounds."}
    </p>
  </>;
}
