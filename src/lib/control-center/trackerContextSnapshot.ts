import {
  deriveCompletionPercent,
  TRACKER_ISSUE_OPEN_STATUSES,
  TRACKER_ISSUE_SEVERITY_LABELS,
  TRACKER_STATUS_LABELS,
  type TrackerIssue,
  type TrackerItem,
  type TrackerMarketingClaim,
  type TrackerSystem,
} from "./trackerTypes";

interface SnapshotInput {
  systems: TrackerSystem[];
  items: TrackerItem[];
  issues: TrackerIssue[];
  claims: TrackerMarketingClaim[];
}

/**
 * Builds a plain-text snapshot of current launch-readiness state — systems +
 * statuses + derived completion, open launch blockers, and marketing-reality
 * warnings — for pasting into an AI coding agent (Claude / Cursor). Derived
 * entirely from live data; never reads stored completion.
 */
export function buildTrackerContextSnapshot({
  systems,
  items,
  issues,
  claims,
}: SnapshotInput): string {
  const itemsBySystem = new Map<string, TrackerItem[]>();
  for (const item of items) {
    const list = itemsBySystem.get(item.system_id) ?? [];
    list.push(item);
    itemsBySystem.set(item.system_id, list);
  }

  const overall = deriveCompletionPercent(items);
  const openIssues = issues.filter((i) => TRACKER_ISSUE_OPEN_STATUSES.includes(i.status));
  const blockers = openIssues
    .filter((i) => i.severity === "critical" || i.severity === "high")
    .sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1));
  const marketingWarnings = claims.filter((c) => c.reality_status !== "accurate");

  const lines: string[] = [];
  lines.push("AGENTFLOW LAUNCH-READINESS SNAPSHOT (Control Center → Tracker)");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Authoritative architecture/invariants: AGENT_RULES.md (in repo).`);
  lines.push("");
  lines.push(
    `OVERALL COMPLETION: ${overall}% (${items.filter((i) => i.status === "complete").length}/${items.length} items complete)`,
  );
  lines.push(`OPEN ISSUES: ${openIssues.length} (critical+high blockers: ${blockers.length})`);
  lines.push(`MARKETING WARNINGS: ${marketingWarnings.length} claim(s) not accurate`);
  lines.push("");

  lines.push("== SYSTEMS ==");
  for (const s of systems) {
    const sysItems = itemsBySystem.get(s.id) ?? [];
    const pct = deriveCompletionPercent(sysItems);
    const sysOpen = openIssues.filter((i) => i.system_id === s.id).length;
    lines.push(
      `- ${s.name} [${TRACKER_STATUS_LABELS[s.status]}] — ${pct}% complete, ${sysItems.length} items, ${sysOpen} open issue(s)` +
        (s.plain_english_summary ? ` — ${s.plain_english_summary}` : ""),
    );
  }
  lines.push("");

  lines.push("== OPEN LAUNCH BLOCKERS (critical/high) ==");
  if (blockers.length === 0) {
    lines.push("- None 🎉");
  } else {
    for (const b of blockers) {
      lines.push(
        `- [${TRACKER_ISSUE_SEVERITY_LABELS[b.severity]}] ${b.title}` +
          (b.next_action ? ` — next: ${b.next_action}` : ""),
      );
    }
  }
  lines.push("");

  lines.push("== MARKETING REALITY WARNINGS ==");
  if (marketingWarnings.length === 0) {
    lines.push("- None");
  } else {
    for (const c of marketingWarnings) {
      lines.push(
        `- "${c.feature_claim}" → ${c.reality_status}` +
          (c.actual_status ? ` (reality: ${c.actual_status})` : "") +
          ` [action: ${c.action_needed}]`,
      );
    }
  }

  return lines.join("\n");
}
