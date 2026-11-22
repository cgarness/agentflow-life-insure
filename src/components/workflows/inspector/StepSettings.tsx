import type { BlockEditor } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import { graphBlock } from "../../../../supabase/functions/_shared/automations/graph";
import { Problem } from "./Field";
import StepDetailsFields from "./StepDetailsFields";
import { otherIssues, type EditorProps } from "./stepConfig";
import type { StepInspectorProps } from "./types";
import MessageFields from "./fields/MessageFields";
import TaskFields from "./fields/TaskFields";
import TimingFields from "./fields/TimingFields";
import TriggerFields from "./fields/TriggerFields";

// The validator starts a message with the field it is about. Those messages are shown under that field.
const NAMED_FIELDS: Partial<Record<BlockEditor, readonly string[]>> = {
  sms: ["Message"], email: ["Subject", "Message"], task: ["Task title", "Notes"],
};
const DETAIL_FIELDS = ["Step name", "Description"];

function StepEditor({editor, ...props}: EditorProps & {editor: BlockEditor}) {
  switch (editor) {
    case "sms": case "email": return <MessageFields {...props}/>;
    case "task": return <TaskFields {...props}/>;
    case "wait": case "waitUntilAppointment": return <TimingFields {...props}/>;
    case "emailCondition": return <p className="text-muted-foreground">
      Contacts with an email address take the Yes path. Everyone else takes the No path. A path without steps ends there.
    </p>;
    default: return <TriggerFields {...props}/>;
  }
}

/** Everything a step can be given: its settings, its problems, its details and the workspace's actions. */
export default function StepSettings({graph, node, scope, issues, readOnly = false, onChange, actions}: StepInspectorProps) {
  const editor = graphBlock(node)?.editor;
  const general = otherIssues(issues, [...(editor ? NAMED_FIELDS[editor] ?? [] : []), ...DETAIL_FIELDS]);
  return <div>
    <div aria-live="polite">
      {general.length > 0 && <ul aria-label="Problems with this step" className="mb-4 space-y-1.5 rounded-md bg-badge-error-surface p-3">
        {general.map((issue, index) => <li key={index}><Problem>{issue.message}</Problem></li>)}
      </ul>}
    </div>
    <div className="space-y-4">
      {editor
        ? <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          <StepEditor key={node.id} editor={editor} graph={graph} node={node} scope={scope} issues={issues} readOnly={readOnly} onChange={onChange}/>
        </fieldset>
        : <p className="text-muted-foreground">This step comes from a version of the builder that this screen cannot edit. It is shown for inspection.</p>}
      <StepDetailsFields key={node.id} node={node} issues={issues} readOnly={readOnly} onChange={onChange}/>
      {actions && <div className="flex flex-wrap items-center gap-2 border-t pt-4">{actions}</div>}
    </div>
  </div>;
}
