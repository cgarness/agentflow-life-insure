import { Zap } from "lucide-react";
import type { AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";
import AutomationBlockPicker from "../AutomationBlockPicker";
import type { BlockType } from "../lib/draftGraph";

interface Props {
  graph: AutomationGraph;
  readOnly?: boolean;
  onStart: (type: BlockType) => void;
}

/** The blank, unsaved workflow. Shown by the canvas and by the ordered list; only one of them is mounted. */
export default function EmptyWorkflow({graph, readOnly, onStart}: Props) {
  return <div className="grid justify-items-center gap-3 p-6 text-center">
    <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
      <Zap className="h-5 w-5"/>
    </span>
    {readOnly ? <p className="text-sm text-muted-foreground">This automation has no steps.</p> : <>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Start with a trigger</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Choose the event that starts this automation. Nothing is saved until you save the draft.
        </p>
      </div>
      <AutomationBlockPicker primary label="Choose trigger" graph={graph} onPick={onStart}/>
    </>}
  </div>;
}
