import { useState } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue } from "@/lib/automation-api";
import { emptyGraph, type AutomationGraph, type AutomationNode } from "../../../../supabase/functions/_shared/automations/graph";
import StepInspector from "../inspector/StepInspector";

export const TRIGGER_ID = "00000000-0000-4000-8000-000000000001";
export const STEP_ID = "00000000-0000-4000-8000-000000000002";

export function step(type: string, config: Record<string, unknown> = {}, extra: Partial<AutomationNode> = {}): AutomationNode {
  return {id: STEP_ID, type, version: 1, config, ...extra};
}
export function trigger(type = "lead_created", config: Record<string, unknown> = {}, extra: Partial<AutomationNode> = {}): AutomationNode {
  return {id: TRIGGER_ID, type, version: 1, config, ...extra};
}

/** A two-step graph around the edited step, or just the trigger when the trigger is being edited. */
export function graphAround(node: AutomationNode, start: AutomationNode = trigger()): AutomationGraph {
  if (node.id === start.id) return {...emptyGraph(), nodes: [node]};
  return {...emptyGraph(), nodes: [start, node], edges: [{id: "00000000-0000-4000-8000-000000000003", source: start.id, target: node.id}]};
}

interface Options {
  start?: AutomationNode;
  issues?: Issue[];
  readOnly?: boolean;
}

/** Mounts the inspector the way the workspace does: every change replaces the step it is editing. */
export function mountInspector(initial: AutomationNode, options: Options = {}) {
  const changes: AutomationNode[] = [];
  function Workspace() {
    const [node, setNode] = useState(initial);
    return <StepInspector graph={graphAround(node, options.start)} node={node} scope="tenant" issues={options.issues ?? []}
      readOnly={options.readOnly} onChange={next => { changes.push(next); setNode(next); }}/>;
  }
  const view = render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}><Workspace/></QueryClientProvider>);
  return {...view, changes, latest: () => changes[changes.length - 1]};
}
