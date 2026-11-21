import { z } from "zod";
import { blocks, graphBlock, type AutomationGraph, type AutomationNode } from "../../../../supabase/functions/_shared/automations/graph";

export type BlockType = AutomationNode["type"];
export type Branch = "yes" | "no" | undefined;

// Incomplete fields are valid in a draft. Unknown wire formats are inspect-only.
const envelope = z.object({
  format: z.literal(1),
  nodes: z.array(z.object({
    id: z.string().min(1), type: z.string().min(1), version: z.number().int().positive(),
    config: z.record(z.unknown()),
  }).strict()),
  edges: z.array(z.object({
    id: z.string().min(1), source: z.string().min(1), target: z.string().min(1),
    branch: z.enum(["yes","no"]).nullish(),
  }).strict()),
  settings: z.object({reentry:z.enum(["once","after_completion"]),stop_on_reply:z.boolean()}).strict(),
}).strict();

export function canEditDraft(value: unknown): value is AutomationGraph {
  if (!envelope.safeParse(value).success) return false;
  const graph = value as AutomationGraph;
  return graph.nodes.every(node => Boolean(graphBlock(node)));
}

export function block(type: string) {
  return blocks.find((definition) => definition.type === type);
}

export function newNode(type: BlockType): AutomationNode {
  return {id: crypto.randomUUID(), version: block(type)!.version, type, config: {}};
}

export function insertStep(graph: AutomationGraph, parentId: string, branch: Branch, step: AutomationNode): AutomationGraph {
  const successor = graph.edges.find(edge => edge.source === parentId && (edge.branch ?? undefined) === branch);
  const edges = graph.edges.filter(edge => edge !== successor);
  edges.push({id: crypto.randomUUID(), source: parentId, target: step.id, ...(branch && {branch})});
  if (successor) {
    // Inserting a condition on an occupied edge retains the previous continuation on Yes.
    edges.push({id: successor.id, source: step.id, target: successor.target,
      ...(block(step.type)?.category === "condition" && {branch: "yes" as const})});
  }
  return {...graph, nodes: [...graph.nodes, step], edges};
}

export function removeStep(graph: AutomationGraph, id: string): AutomationGraph {
  const incoming = graph.edges.find(edge => edge.target === id);
  const outgoing = graph.edges.filter(edge => edge.source === id);
  if (!incoming || outgoing.length > 1) return graph;
  const edges = graph.edges.filter(edge => edge.target !== id && edge.source !== id);
  if (outgoing.length) edges.push({...incoming, target: outgoing[0].target});
  return {...graph, nodes: graph.nodes.filter(node => node.id !== id), edges};
}

export function moveStep(graph: AutomationGraph, id: string, direction: "up" | "down"): AutomationGraph {
  const link = graph.edges.find(edge => direction === "up" ? edge.target === id : edge.source === id);
  if (!link) return graph;
  const {source: first, target: second} = link;
  const allowed = [first, second].every(stepId => {
    const category = block(graph.nodes.find(node => node.id === stepId)?.type ?? "")?.category;
    return category === "wait" || category === "action";
  });
  if (!allowed) return graph;
  const swap = (stepId: string) => stepId === first ? second : stepId === second ? first : stepId;
  return {...graph, edges: graph.edges.map(edge => ({...edge, source: swap(edge.source), target: swap(edge.target)}))};
}

export function orderedSteps(graph: AutomationGraph) {
  const result: Array<{node: AutomationNode; path: string}> = [];
  const seen = new Set<string>();
  function visit(node: AutomationNode | undefined, path: string) {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    result.push({node, path});
    for (const edge of graph.edges.filter(e => e.source === node.id).sort((a,b) =>
      (b.branch ?? "").localeCompare(a.branch ?? ""))) {
      const nextPath = edge.branch ? [path, edge.branch === "yes" ? "Yes" : "No"].filter(Boolean).join(" / ") : path;
      visit(graph.nodes.find(n => n.id === edge.target), nextPath);
    }
  }
  visit(graph.nodes.find(node => block(node.type)?.category === "trigger"), "");
  graph.nodes.forEach(node => visit(node, ""));
  return result;
}
