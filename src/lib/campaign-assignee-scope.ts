/** Campaign helpers for assigning leads to queues scoped by assignee visibility. */

export type CampaignLike = {
  type: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
};

function normalizeCampaignType(type: string | null | undefined): string {
  return (type ?? "").trim().toUpperCase();
}

export function isPersonalCampaign(c: CampaignLike): boolean {
  return normalizeCampaignType(c.type) === "PERSONAL";
}

export function isTeamCampaign(c: CampaignLike): boolean {
  return normalizeCampaignType(c.type) === "TEAM";
}

export function isPersonalCampaignForAssignee(c: CampaignLike, assigneeId: string): boolean {
  return isPersonalCampaign(c) && (c.user_id ?? "") === assigneeId;
}

export function isTeamCampaignIncludingAgent(c: CampaignLike, assigneeId: string): boolean {
  if (!isTeamCampaign(c)) return false;
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

/**
 * Whether the user may view/dial this campaign.
 * Personal is always owner-only — viewAll never exposes another agent's Personal list.
 * viewAll (Team Leader / Admin) adds all Team campaigns in the org, not others' Personal.
 */
export function canUserAccessCampaign(
  c: CampaignLike,
  userId: string,
  opts?: { viewAll?: boolean },
): boolean {
  if (isOpenPoolCampaign(c)) return true;
  if (isPersonalCampaignForAssignee(c, userId)) return true;
  if (isTeamCampaignIncludingAgent(c, userId)) return true;
  if (opts?.viewAll && isTeamCampaign(c)) return true;
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
  return isTeamCampaign(c) || isOpenPoolCampaign(c);
}
