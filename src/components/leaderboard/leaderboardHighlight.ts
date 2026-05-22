export function agentHighlightClass(
  agentId: string,
  opts: {
    spotlightAgentId?: string | null;
    newLeaderId?: string | null;
  },
): string {
  const classes: string[] = [];
  if (opts.spotlightAgentId === agentId) classes.push("animate-leaderboard-spotlight");
  if (opts.newLeaderId === agentId) classes.push("animate-new-leader-pulse");
  return classes.join(" ");
}
