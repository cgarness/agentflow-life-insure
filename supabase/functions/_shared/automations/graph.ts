import { z } from "zod";
import { registrations, type SummaryNames } from "./blockRegistry.ts";
import { offsetLabel } from "./blockHandlers.ts";
import { characterCount } from "./fields.ts";

/** Optional author notes. Never part of execution configuration or a customer message. */
export interface StepMeta {
  name?: string;
  description?: string;
}
export interface AutomationNode {
  id: string;
  type: string;
  version: number;
  config: Record<string, unknown>;
  meta?: StepMeta;
}
export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  branch?: "yes" | "no" | null;
}
export type Reentry = "once" | "after_completion" | "after_end";
export interface AutomationSettings {
  reentry: Reentry;
  stop_on_reply: boolean;
  stop_on_booking?: boolean;
  stop_on_contact?: boolean;
}
export interface AutomationGraph {
  format: 1;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  settings: AutomationSettings;
}
export type GraphIssue = { nodeId?: string; message: string };
export const STEP_NAME_MAX = 80;
export const STEP_DESCRIPTION_MAX = 500;
export const REENTRY_OPTIONS: readonly Reentry[] = ["once", "after_completion", "after_end"];
export type BlockGroup = "Triggers" | "Actions" | "Timing" | "Conditions";

const GROUPS: Record<string, BlockGroup> = {
  trigger: "Triggers",
  action: "Actions",
  wait: "Timing",
  condition: "Conditions",
};
const configured = registrations.map((entry) => ({
  ...entry,
  group: GROUPS[entry.category],
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

export function triggerNode(graph: AutomationGraph): AutomationNode | undefined {
  return graph.nodes.find((node) => graphBlock(node)?.category === "trigger");
}

/** Choices that are valid at an insertion point: triggers on an empty canvas, then steps this trigger supports. */
export function availableBlocks(graph: AutomationGraph) {
  const trigger = triggerNode(graph);
  if (!trigger) return blocks.filter((entry) => entry.category === "trigger");
  return blocks.filter((entry) => entry.category !== "trigger" && (!entry.after || entry.after.includes(trigger.type)));
}

/** A custom name becomes the title; otherwise the block label, with the delay written out for waits. */
export function stepTitle(node: AutomationNode): string {
  const name = node.meta?.name?.trim();
  if (name) return name;
  if (node.type === "wait") {
    const delay = offsetLabel(node.config.duration, node.config.unit);
    if (delay) return "Wait " + delay;
  }
  return graphBlock(node)?.label ?? node.type.replace(/_/g, " ");
}

/** The block type plus its configured value, so a renamed step stays identifiable. */
export function stepSummary(node: AutomationNode, names?: SummaryNames): string {
  const block = graphBlock(node);
  if (!block) return "Unsupported step";
  const detail = block.summary(node.config ?? {}, names);
  const titled = stepTitle(node);
  if (node.meta?.name?.trim()) return [block.label, detail].filter(Boolean).join(" · ");
  return titled === block.label ? detail : titled.includes(detail) ? "" : detail;
}

/**
 * Control characters a step name or description may not contain: U+0000-U+001F and U+007F-U+009F, the set the
 * database refuses. A description may keep tabs and line breaks. A name may not, nor a line or paragraph separator.
 * Tested by code point, so no lint rule needs an exception.
 */
function refusedInStep(code: number, isName: boolean): boolean {
  if (!isName && (code === 9 || code === 10 || code === 13)) return false;
  return code <= 31 || (code >= 127 && code <= 159) || (isName && (code === 0x2028 || code === 0x2029));
}
export function stepTextHasControl(text: string, isName: boolean): boolean {
  for (const c of text) if (refusedInStep(c.codePointAt(0) ?? 0, isName)) return true;
  return false;
}
/**
 * What an author typed or pasted, made acceptable. In a name each run of refused characters becomes one space, so
 * the name stays on one line with its words apart. In a description they are dropped and line breaks stay.
 */
export function cleanStepText(text: string, isName: boolean): string {
  let out = "";
  let gap = false;
  for (const c of text) {
    if (!refusedInStep(c.codePointAt(0) ?? 0, isName)) { out += c; gap = false; }
    else if (isName && !gap) { out += " "; gap = true; }
  }
  return out;
}
function metaIssue(meta: unknown): string | undefined {
  if (meta === undefined) return undefined;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "Step details are not valid.";
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.some(([key]) => key !== "name" && key !== "description")) return "Step details are not valid.";
  const { name, description } = meta as StepMeta;
  if (name !== undefined && (typeof name !== "string" || characterCount(name) > STEP_NAME_MAX || stepTextHasControl(name, true))) {
    return "Step name must be plain text of " + STEP_NAME_MAX + " characters or fewer.";
  }
  if (description !== undefined && (typeof description !== "string" || characterCount(description) > STEP_DESCRIPTION_MAX ||
    stepTextHasControl(description, false))) {
    return "Description must be plain text of " + STEP_DESCRIPTION_MAX + " characters or fewer.";
  }
  return undefined;
}

export function validateGraph(graph: AutomationGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  if (
    graph?.format !== 1 || !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    return [{ message: "Unsupported graph format." }];
  }
  const settings = graph.settings;
  if (
    !REENTRY_OPTIONS.includes(settings?.reentry) || typeof settings?.stop_on_reply !== "boolean" ||
    (settings.stop_on_booking !== undefined && typeof settings.stop_on_booking !== "boolean") ||
    (settings.stop_on_contact !== undefined && typeof settings.stop_on_contact !== "boolean")
  ) {
    issues.push({ message: "Choose valid re-entry and stop settings." });
  }
  const ids = new Set<string>();
  const starts: AutomationNode[] = [];
  let actions = 0;
  const trigger = graph.nodes.find((n) => n && graphBlock(n)?.category === "trigger")?.type ?? null;
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
    const unavailable = spec.category !== "trigger" && trigger && spec.after && !spec.after.includes(trigger)
      ? spec.label + " is not available after this trigger. Remove it or change the trigger."
      : undefined;
    const issue = unavailable ?? metaIssue(n.meta) ?? spec.check?.(n.config, trigger) ??
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
      name: node.meta?.name?.trim() || undefined,
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
