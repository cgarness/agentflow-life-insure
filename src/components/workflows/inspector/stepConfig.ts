import type { Issue } from "@/lib/automation-api";
import type { AutomationGraph, AutomationNode } from "../../../../supabase/functions/_shared/automations/graph";

/** What every block editor receives. A disabled fieldset around the editor handles read-only graphs. */
export interface EditorProps {
  graph: AutomationGraph;
  node: AutomationNode;
  scope: string;
  issues: Issue[];
  readOnly: boolean;
  onChange: (node: AutomationNode) => void;
}

export function textValue(node: AutomationNode, key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value : "";
}

/** Merge a change into the step's configuration. A key set to undefined is removed. */
export function patchConfig(node: AutomationNode, patch: Record<string, unknown>): AutomationNode {
  const config = {...node.config, ...patch};
  for (const key of Object.keys(config)) if (config[key] === undefined) delete config[key];
  return {...node, config};
}

/** The first text step definition stored a purpose chosen by the author. Editing moves the step to the current one. */
export function currentSms(node: AutomationNode): AutomationNode {
  if (node.type !== "send_sms" || node.version !== 1) return node;
  const {purpose: _purpose, ...config} = node.config;
  return {...node, version: 2, config};
}

/** The validator names the field at the start of its message, which lets the message sit under that field. */
export function fieldIssues(issues: Issue[], label: string): string[] {
  return issues.filter(issue => issue.message.startsWith(label + " ")).map(issue => issue.message);
}

export function otherIssues(issues: Issue[], labels: readonly string[]): Issue[] {
  return issues.filter(issue => !labels.some(label => issue.message.startsWith(label + " ")));
}

/** IDs of the hint and error text that `Field` renders for a control. */
/**
 * The browser's limit for a field whose rule counts characters. Browsers count UTF-16 units, so an emoji takes two.
 * Twice the rule lets every text the rule allows be typed; the character count shown under the field enforces it.
 */
export const nativeMaxLength = (characters: number) => characters * 2;

export function describedBy(id: string, hint: unknown, errors: string[] = []): string | undefined {
  return [hint ? id + "-hint" : "", errors.length ? id + "-error" : ""].filter(Boolean).join(" ") || undefined;
}

/** Arrow keys move between the buttons of a menu list. Tab and Shift+Tab keep working as usual. */
export function arrowNavigation(event: {key: string; currentTarget: HTMLElement; preventDefault: () => void}) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (!items.length) return;
  const down = event.key === "ArrowDown";
  const current = items.indexOf(document.activeElement as HTMLElement);
  const from = current < 0 ? (down ? -1 : 0) : current;
  event.preventDefault();
  items[(from + (down ? 1 : items.length - 1)) % items.length].focus();
}
