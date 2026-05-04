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
  return c.type === "Open Pool";
}

/** Campaigns the assignee can attach a lead they own to (manual add helper). */
export function filterCampaignsForAssignee(cs: CampaignLike[], assigneeId: string): CampaignLike[] {
  return cs.filter(
    (c) =>
      isPersonalCampaignForAssignee(c, assigneeId) ||
      isTeamCampaignIncludingAgent(c, assigneeId) ||
      isOpenPoolCampaign(c)
  );
}

export function campaignAcceptsUnassignedLeads(c: CampaignLike): boolean {
  return c.type === "Team" || c.type === "Open Pool";
}
