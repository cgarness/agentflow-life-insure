import { z } from "zod";
import { registrations } from "./blockRegistry.ts";

export interface AutomationNode {
  id: string;
  type: string;
  version: number;
  config: Record<string, unknown>;
}
export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  branch?: "yes" | "no" | null;
}
export interface AutomationGraph {
  format: 1;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  settings: { reentry: "once" | "after_completion"; stop_on_reply: boolean };
}
export type GraphIssue = { nodeId?: string; message: string };
const configured = registrations.map((entry) => ({
  ...entry,
  schema: entry.schema(z),
}));
// The picker offers the latest supported definition while a saved graph keeps its version.
export const blocks = configured.filter((entry) =>
  !configured.some((other) =>
    other.type === entry.type && other.version > entry.version
  )
);
export function graphBlock(node: AutomationNode) {
  return configured.find((entry) =>
    entry.type === node.type && entry.version === node.version
  );
}

export function emptyGraph(): AutomationGraph {
  return {
    format: 1,
    nodes: [],
    edges: [],
    settings: { reentry: "once", stop_on_reply: false },
  };
}

export function validateGraph(graph: AutomationGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  if (
    graph?.format !== 1 || !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    return [{ message: "Unsupported graph format." }];
  }
  if (
    !["once", "after_completion"].includes(graph.settings?.reentry) ||
    typeof graph.settings?.stop_on_reply !== "boolean"
  ) {
    issues.push({ message: "Choose valid re-entry and stop settings." });
  }
  const ids = new Set<string>();
  const starts: AutomationNode[] = [];
  let actions = 0;
  for (const n of graph.nodes) {
    if (!n?.id || ids.has(n.id)) {
      return [{ message: "Each block needs a unique ID." }];
    }
    ids.add(n.id);
    const spec = graphBlock(n);
    if (
      !spec || !n.config ||
      typeof n.config !== "object"
    ) {
      issues.push({ nodeId: n.id, message: "Unsupported block or version." });
      continue;
    }
    if (spec.category === "trigger") starts.push(n);
    if (spec.category === "action") actions++;
    const parsed = spec.schema.safeParse(n.config);
    const issue = spec.check?.(n.config) ??
      (parsed.success
        ? undefined
        : parsed.error.issues.map((i) =>
          [i.path.join("."), i.message].filter(Boolean).join(" · ")
        ).join(", "));
    if (issue) issues.push({ nodeId: n.id, message: issue });
  }
  if (starts.length !== 1) {
    issues.push({ message: "Choose exactly one trigger." });
  }
  if (!actions) issues.push({ message: "Add at least one action." });
  const edgeIds = new Set<string>();
  const exits = new Map<string, Map<string, string>>();
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    if (
      !edge?.id || edgeIds.has(edge.id) || !ids.has(edge.source) ||
      !ids.has(edge.target)
    ) {
      issues.push({
        message: "An edge has a duplicate ID or an invalid endpoint.",
      });
      continue;
    }
    edgeIds.add(edge.id);
    const branch = edge.branch ?? "";
    const paths = exits.get(edge.source) ?? new Map<string, string>();
    const branching =
      graphBlock(nodes.get(edge.source)!)?.category === "condition";
    if (
      paths.has(branch) ||
      (branching ? !["yes", "no"].includes(branch) : branch !== "")
    ) {
      issues.push({
        nodeId: edge.source,
        message: "This block has an invalid or duplicate exit.",
      });
    }
    if (graphBlock(nodes.get(edge.target)!)?.category === "trigger") {
      issues.push({
        nodeId: edge.target,
        message: "A trigger cannot follow another block.",
      });
    }
    paths.set(branch, edge.target);
    exits.set(edge.source, paths);
  }
  if (starts.length === 1) {
    const visited = new Set<string>();
    const active = new Set<string>();
    function visit(id: string) {
      if (active.has(id)) {
        issues.push({ nodeId: id, message: "Remove the cycle." });
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      active.add(id);
      exits.get(id)?.forEach(visit);
      active.delete(id);
    }
    visit(starts[0].id);
    for (const id of ids) {
      if (!visited.has(id)) {
        issues.push({
          nodeId: id,
          message: "Connect this block to the trigger.",
        });
      }
    }
  }
  return issues;
}

export function previewGraph(
  graph: AutomationGraph,
  input: Record<string, unknown> = {},
) {
  const rows: { nodeId: string; detail: string }[] = [];
  const errors = validateGraph(graph);
  if (errors.length) {
    return errors.map((e) => ({ nodeId: e.nodeId ?? "", detail: e.message }));
  }
  let node = graph.nodes.find((n) => graphBlock(n)?.category === "trigger");
  while (node) {
    const spec = graphBlock(node)!;
    const { detail, hold, branch = null } = spec.preview({
      type: node.type,
      label: spec.label,
      config: node.config,
      input,
    });
    rows.push({ nodeId: node.id, detail });
    if (hold) {
      break;
    }
    const edge = graph.edges.find((e) =>
      e.source === node!.id && (e.branch ?? null) === branch
    );
    node = edge ? graph.nodes.find((n) => n.id === edge.target) : undefined;
  }
  return rows;
}
