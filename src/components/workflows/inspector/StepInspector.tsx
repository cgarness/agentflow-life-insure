import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { graphBlock } from "../../../../supabase/functions/_shared/automations/graph";
import StepSettings from "./StepSettings";
import type { StepInspectorProps } from "./types";

const KINDS = {trigger: "Trigger", action: "Action", wait: "Timing", condition: "Condition"} as const;

/** Settings for the selected step, shown beside the canvas or list. */
export default function StepInspector(props: StepInspectorProps) {
  const {node, onClose} = props;
  const block = graphBlock(node);
  return <section aria-label="Configure block" className="flex max-h-full min-h-0 flex-col rounded-lg border bg-card text-sm text-card-foreground">
    <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
      <div className="min-w-0">
        {block && <p className="text-xs font-medium text-muted-foreground">{KINDS[block.category]}</p>}
        <h3 className="text-base font-semibold leading-6">{block?.label ?? node.type.replace(/_/g, " ")}</h3>
      </div>
      {onClose && <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-1 h-11 w-11 shrink-0 md:h-9 md:w-9"
        aria-label="Close step settings" onClick={onClose}>
        <X aria-hidden="true"/>
      </Button>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <StepSettings {...props}/>
    </div>
  </section>;
}
