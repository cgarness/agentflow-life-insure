import { graphBlock, triggerNode, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

/** Card width in pixels. Must match the `w-64` class on the canvas card. */
export const CARD_WIDTH = 256;
/** Height used until the browser has measured a card. */
export const CARD_HEIGHT = 76;
const COLUMN = 312;
const ROW = 184;

interface Tree { id: string; branches: (Tree | null)[] }

/**
 * Top-down positions for the canvas. Every step sits centred above everything that follows it, and a
 * condition reserves one column per branch, so nested branches never overlap. Steps the trigger does
 * not reach are laid out to the right, where the author can see and reconnect or remove them.
 */
export function layoutSteps(graph: AutomationGraph): Map<string, {x: number; y: number}> {
  const positions = new Map<string, {x: number; y: number}>();
  const known = new Map(graph.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();

  function grow(id: string): Tree {
    seen.add(id);
    const exits = graph.edges.filter(edge => edge.source === id);
    const follow = (branch: "yes" | "no" | undefined) => {
      const target = exits.find(edge => (edge.branch ?? undefined) === branch)?.target;
      return target && known.has(target) && !seen.has(target) ? grow(target) : null;
    };
    const condition = graphBlock(known.get(id)!)?.category === "condition";
    return {id, branches: condition ? [follow("yes"), follow("no")] : [follow(undefined)]};
  }
  const span = (tree: Tree): number => tree.branches.reduce((total, branch) => total + (branch ? span(branch) : 1), 0);
  function place(tree: Tree, left: number, depth: number) {
    positions.set(tree.id, {x: (left + span(tree) / 2) * COLUMN - CARD_WIDTH / 2, y: depth * ROW});
    let cursor = left;
    for (const branch of tree.branches) {
      if (branch) place(branch, cursor, depth + 1);
      cursor += branch ? span(branch) : 1;
    }
  }

  const targets = new Set(graph.edges.map(edge => edge.target));
  const trigger = triggerNode(graph);
  const roots = [...(trigger ? [trigger] : []), ...graph.nodes.filter(node => !targets.has(node.id)), ...graph.nodes];
  let left = 0;
  for (const root of roots) {
    if (seen.has(root.id)) continue;
    const tree = grow(root.id);
    place(tree, left, 0);
    left += span(tree);
  }
  return positions;
}
