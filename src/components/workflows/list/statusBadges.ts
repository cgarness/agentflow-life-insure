import type { BadgeProps } from "@/components/ui/badge";

export type StatusTone = NonNullable<BadgeProps["variant"]>;
export interface StatusBadge { label: string; tone: StatusTone }

const UNKNOWN: StatusBadge = {label: "Unknown", tone: "warning"};

const WORKFLOW = new Map<string, StatusBadge>([
  ["draft", {label: "Draft", tone: "neutral"}],
  ["active", {label: "Active", tone: "success"}],
  ["paused", {label: "Paused", tone: "warning"}],
  ["archived", {label: "Archived", tone: "neutral"}],
]);

/** A missing or unrecognised status is shown as Unknown, never as a real state. */
export function workflowStatusBadge(status?: string | null): StatusBadge {
  return WORKFLOW.get(status ?? "") ?? UNKNOWN;
}

/** An agency switch. Only a confirmed boolean reads On or Off. */
export function switchBadge(enabled?: boolean | null): StatusBadge {
  if (enabled === true) return {label: "On", tone: "success"};
  if (enabled === false) return {label: "Off", tone: "neutral"};
  return UNKNOWN;
}

const RUN = new Map<string, StatusBadge>([
  ["queued", {label: "Queued", tone: "info"}],
  ["waiting", {label: "Waiting", tone: "info"}],
  ["held", {label: "Held", tone: "warning"}],
  ["paused", {label: "Paused", tone: "warning"}],
  ["completed", {label: "Completed", tone: "success"}],
  ["stopped", {label: "Stopped", tone: "neutral"}],
  ["failed", {label: "Failed", tone: "error"}],
  ["unknown", UNKNOWN],
]);

export function sentenceCase(value: string) {
  const words = value.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export function runStatusBadge(status?: string | null): StatusBadge {
  if (!status) return UNKNOWN;
  return RUN.get(status) ?? {label: sentenceCase(status), tone: "neutral"};
}
