import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { readinessLabels } from "@/lib/number-affinity";
import { contactAssignment } from "@/lib/contact-from-number";
import type { useContactFromNumber } from "@/hooks/useContactFromNumber";

type Model = ReturnType<typeof useContactFromNumber>;
type Props = { model: Model; legacyNumber: string; onLegacyChange: (number: string) => void;
  legacyOptions: { number: string; label: string }[] };

function NumberConfirmation({ model, onClosed }: { model: Model; onClosed: () => void }) {
  const [assign, setAssign] = useState(false);
  const pending = model.pending!;
  const assignment = contactAssignment(model.preview);
  const canAssign = pending.sender.readiness === "ready" && pending.sender.voice_readiness === "ready";
  return <Dialog open onOpenChange={open => { if (!open) model.cancel(); }}>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-sm grid-cols-1"
      onCloseAutoFocus={event => { event.preventDefault(); onClosed(); }}>
      <DialogHeader>
        <DialogTitle>{assignment.number || assignment.split ? "Use a different number?" : "Use this number?"}</DialogTitle>
        <DialogDescription>
          {assignment.split ? "This contact has different assigned numbers for calls and texts." :
            assignment.number ? `This contact is assigned to ${formatPhoneNumber(assignment.number)}.` :
              "This contact does not have a shared assigned number."}
          {` Use ${formatPhoneNumber(pending.sender.number ?? "")} instead?`}
        </DialogDescription>
      </DialogHeader>
      {model.canAssign && <div className="space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox aria-label="Make this the assigned number" checked={assign}
            onCheckedChange={value => setAssign(value === true)} disabled={model.busy || !canAssign} />
          <span>Make this the assigned number</span>
        </label>
        {!canAssign && <p className="text-xs text-muted-foreground">This number must be ready for calls and texts to become assigned.</p>}
      </div>}
      {model.error && <p role="alert" className="text-sm text-destructive">{model.error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={model.busy} onClick={model.cancel}>Cancel</Button>
        <Button disabled={model.busy} onClick={() => void model.confirm(assign)}>{model.busy ? "Saving…" : "Use number"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function ContactFromNumberControl({ model, legacyNumber, legacyOptions, onLegacyChange }: Props) {
  const trigger = useRef<HTMLSelectElement>(null);
  const selectedId = model.sender?.id ?? "";
  const choices = model.enabled ? model.options : [];
  const missing = !!selectedId && !choices.some(row => row.id === selectedId);
  return <div className="min-w-0">
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-accent/30 px-2 py-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From:</span>
      <select ref={trigger} aria-label="From number" disabled={model.disabled}
        value={model.enabled ? selectedId : legacyNumber}
        onChange={event => model.enabled ? model.select(event.target.value) : onLegacyChange(event.target.value)}
        className="min-w-0 max-w-48 cursor-pointer border-none bg-transparent text-xs font-semibold text-foreground outline-none focus:ring-0">
        {model.enabled ? <>
          {!selectedId && <option value="">{model.sender?.number ? `${formatPhoneNumber(model.sender.number)} · Unavailable` : "Choose a number"}</option>}
          {missing && <option value={selectedId}>{formatPhoneNumber(model.sender?.number ?? "")}</option>}
          {choices.filter(row => row.id).map(row => <option key={row.id!} value={row.id!}>{formatPhoneNumber(row.number ?? "")}</option>)}
        </> : legacyOptions.length ? legacyOptions.map(row => <option key={row.number} value={row.number}>{row.label}</option>) :
          <option value="">{model.disabled ? "Checking numbers…" : "No numbers available"}</option>}
      </select>
    </label>
    {model.enabled && !model.pending && <>
      {model.error ? <div role="alert" className="mt-1 flex items-center gap-1 text-xs text-destructive">
        <span>{model.error}</span><Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={model.retry}>Retry</Button>
      </div> : model.sender && <div className="mt-1 text-xs text-muted-foreground">
        {model.readiness.call !== "ready" && <p>Calls: {readinessLabels[model.readiness.call] ?? "Number unavailable"}</p>}
        {model.readiness.sms !== "ready" && <p>{readinessLabels[model.readiness.sms] ?? "Texting unavailable"}</p>}
      </div>}
    </>}
    {model.pending && <NumberConfirmation key={`${model.pending.visit}:${model.pending.sender.id}`}
      model={model} onClosed={() => trigger.current?.focus()} />}
  </div>;
}
