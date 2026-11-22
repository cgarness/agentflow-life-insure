import { useId } from "react";
import { Input } from "@/components/ui/input";
import { graphBlock } from "../../../../../supabase/functions/_shared/automations/graph";
import { selectStyle } from "../../lib/fieldStyles";
import Field from "../Field";
import { patchConfig, textValue, type EditorProps } from "../stepConfig";

const UNITS = ["minutes", "hours", "days"];

function count(value: unknown): number | "" {
  return typeof value === "number" ? value : "";
}
function whole(text: string): number | undefined {
  return text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Math.trunc(Number(text));
}

/** A fixed wait, or a wait that ends a set time before the appointment that started the workflow. */
export default function TimingFields({node, onChange}: EditorProps) {
  const id = useId();
  const untilAppointment = graphBlock(node)?.editor === "waitUntilAppointment";
  const amountKey = untilAppointment ? "amount" : "duration";
  return <>
    <div className="grid grid-cols-2 gap-3">
      <Field id={id + "amount"} label={untilAppointment ? "Time before" : "Duration"}>
        <Input id={id + "amount"} type="number" inputMode="numeric" min={1} step={1} value={count(node.config[amountKey])}
          onChange={event => onChange(patchConfig(node, {[amountKey]: whole(event.target.value)}))}/>
      </Field>
      <Field id={id + "unit"} label="Unit">
        <select id={id + "unit"} className={selectStyle} value={textValue(node, "unit")}
          onChange={event => onChange(patchConfig(node, {unit: event.target.value || undefined}))}>
          <option value="">Choose unit</option>
          {UNITS.map(unit => <option key={unit}>{unit}</option>)}
        </select>
      </Field>
    </div>
    {untilAppointment ? <>
      <Field id={id + "late"} label="If that time has already passed"
        hint="This happens when an appointment is booked, or moved, closer than the time above.">
        <select id={id + "late"} className={selectStyle} aria-describedby={id + "late-hint"}
          value={node.config.late === "continue" ? "continue" : "skip"}
          onChange={event => onChange(patchConfig(node, {late: event.target.value === "continue" ? "continue" : undefined}))}>
          <option value="skip">Skip the remaining steps</option>
          <option value="continue">Continue right away</option>
        </select>
      </Field>
      <p className="text-muted-foreground">
        The wait follows the appointment. Rescheduling moves it to the new time. Days are counted in your agency's time zone,
        so one day before a 3:00 PM appointment is 3:00 PM the day before. Nothing runs once the appointment has started.
      </p>
    </> : <p className="text-muted-foreground">The next step runs when this much time has passed.</p>}
  </>;
}
