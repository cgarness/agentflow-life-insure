/** Campaign helpers for assigning leads to queues scoped by assignee visibility. */

export type CampaignLike = {
  type: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
};

export function isPersonalCampaignForAssignee(c: CampaignLike, assigneeId: string): boolean {
  return c.type === "Personal" && (c.user_id ?? "") === assigneeId;
}

export function isTeamCampaignIncludingAgent(c: CampaignLike, assigneeId: string): boolean {
  if (c.type !== "Team") return false;
  const raw = c.assigned_agent_ids;
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) arr = p;
    } catch {
      arr = [];
    }
  }
  return arr.some((x) => String(x) === assigneeId);
}

export function isOpenPoolCampaign(c: CampaignLike): boolean {
  const t = (c.type || "").trim();
  return t === "Open Pool" || t === "Open";
}

/** Whether the user may view/dial this campaign (dialer picker, campaigns list, lead add). */
export function canUserAccessCampaign(
  c: CampaignLike,
  userId: string,
  opts?: { viewAll?: boolean },
): boolean {
  if (opts?.viewAll) return true;
  if (isOpenPoolCampaign(c)) return true;
  if (isPersonalCampaignForAssignee(c, userId)) return true;
  if (isTeamCampaignIncludingAgent(c, userId)) return true;
  return false;
}

/** Campaigns the assignee can attach a lead they own to (manual add helper). */
export function filterCampaignsForAssignee(
  cs: CampaignLike[],
  assigneeId: string,
  opts?: { viewAll?: boolean },
): CampaignLike[] {
  return cs.filter((c) => canUserAccessCampaign(c, assigneeId, opts));
}

export function campaignAcceptsUnassignedLeads(c: CampaignLike): boolean {
  return c.type === "Team" || c.type === "Open Pool";
}
