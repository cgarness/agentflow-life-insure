import type { ReactNode } from "react";
import type { Issue } from "@/lib/automation-api";
import type { AutomationGraph, AutomationNode } from "../../../../supabase/functions/_shared/automations/graph";

/** Contract between the editor workspace and the step settings surface. */
export interface StepInspectorProps {
  graph: AutomationGraph;
  node: AutomationNode;
  /** Query-cache scope: signed-in user, agency and session revision. */
  scope: string;
  /** Issues that belong to this step. */
  issues: Issue[];
  readOnly?: boolean;
  /** Replace the step. Config, details, type and version may all change; the id never does. */
  onChange: (node: AutomationNode) => void;
  onClose?: () => void;
  /** Move up, Move down and Remove, supplied by the workspace. */
  actions?: ReactNode;
}

export interface StepInspectorSheetProps extends StepInspectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
