import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Issue } from "@/lib/automation-api";
import { cn } from "@/lib/utils";
import {
  cleanStepText, graphBlock, STEP_DESCRIPTION_MAX, STEP_NAME_MAX, type AutomationNode, type StepMeta,
} from "../../../../supabase/functions/_shared/automations/graph";
import Field from "./Field";
import { describedBy, fieldIssues } from "./stepConfig";

interface Props {
  node: AutomationNode;
  issues: Issue[];
  readOnly: boolean;
  onChange: (node: AutomationNode) => void;
}


/**
 * Optional name and internal note for any step. They live beside the configuration, never inside it.
 * A name is one line of plain text; a description may keep its line breaks. The shared rule removes the
 * control characters the database refuses as they are typed or pasted.
 */
export default function StepDetailsFields({node, issues, readOnly, onChange}: Props) {
  const id = useId();
  const name = node.meta?.name ?? "", description = node.meta?.description ?? "";
  const nameIssues = fieldIssues(issues, "Step name"), descriptionIssues = fieldIssues(issues, "Description");
  const [opened, setOpened] = useState(Boolean(name || description));
  // A problem with a detail has to be visible to be fixed.
  const open = opened || nameIssues.length > 0 || descriptionIssues.length > 0;

  function write(key: keyof StepMeta, value: string) {
    const {meta: current, ...step} = node;
    const meta: StepMeta = {...current};
    if (value.trim()) meta[key] = value; else delete meta[key];
    onChange(Object.keys(meta).length ? {...step, meta} : step);
  }

  return <Collapsible open={open} onOpenChange={setOpened} className="border-t pt-2">
    <CollapsibleTrigger asChild>
      <Button type="button" variant="ghost" className="h-11 w-full justify-between px-2 md:h-9">
        Step details
        <ChevronDown aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}/>
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <fieldset disabled={readOnly} className="min-w-0 space-y-4 px-2 pb-1 pt-3">
        <Field id={id + "name"} label="Step name" errors={nameIssues}>
          <Input id={id + "name"} value={name} maxLength={STEP_NAME_MAX} placeholder={graphBlock(node)?.label}
            aria-invalid={nameIssues.length > 0 || undefined} aria-describedby={describedBy(id + "name", false, nameIssues)}
            onChange={event => write("name", cleanStepText(event.target.value, true))}/>
        </Field>
        <Field id={id + "description"} label="Description" hint="Only your team sees this." errors={descriptionIssues}>
          <Textarea id={id + "description"} value={description} maxLength={STEP_DESCRIPTION_MAX} className="text-base md:text-sm"
            aria-invalid={descriptionIssues.length > 0 || undefined} aria-describedby={describedBy(id + "description", true, descriptionIssues)}
            onChange={event => write("description", cleanStepText(event.target.value, false))}/>
        </Field>
      </fieldset>
    </CollapsibleContent>
  </Collapsible>;
}
