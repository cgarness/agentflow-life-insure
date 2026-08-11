/**
 * Campaign scope helpers.
 *
 * THREE DISTINCT ACCESS CONCEPTS — do not collapse them back into one rule:
 *
 *   1. MANAGEMENT  (`canUserManageCampaign`)  — who may view/administer a campaign and its
 *      contacts. Same-organization Admin / Super Admin may manage agent-owned PERSONAL
 *      campaigns. Team Leaders and Agents do NOT gain cross-user Personal access here.
 *
 *   2. DIALING     (`canUserDialCampaign`)    — who may see, select, or start a campaign in
 *      the Dialer. PERSONAL IS OWNER-ONLY. There is deliberately no `viewAll` option: an
 *      Admin's "view all campaigns" permission must never grant Personal dialing access.
 *      The database mirrors this in `public.can_dial_campaign(uuid)`, which is the
 *      server-authoritative source; these predicates are UX only.
 *
 *   3. ATTACHMENT  (`filterCampaignsForAssignee`) — which campaigns a lead owned by
 *      `assigneeId` may be attached to (manual Add-Lead picker). Unchanged behaviour.
 */

export type CampaignLike = {
  type: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
};

/** Role context for MANAGEMENT decisions only. Never accepted by the dialing helper. */
export type CampaignManagementRole = {
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  /** Team Leader / Admin "view all campaigns" scope — widens TEAM only. */
  viewAll?: boolean;
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

export function isOpenPoolCampaign(c: CampaignLike): boolean {
  const t = normalizeCampaignType(c.type);
  return t === "OPEN POOL" || t === "OPEN";
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

/**
 * DIALER SCOPE — may this user see/select/start this campaign in the Dialer?
 *
 * Personal is owner-only, with no escape hatch. The two-parameter signature is load-bearing:
 * it makes it impossible to pass a `viewAll`/admin flag that could widen Personal access.
 * Enforced server-side by `public.can_dial_campaign(uuid)`.
 */
export function canUserDialCampaign(c: CampaignLike, userId: string): boolean {
  if (isOpenPoolCampaign(c)) return true;
  if (isPersonalCampaignForAssignee(c, userId)) return true;
  if (isTeamCampaignIncludingAgent(c, userId)) return true;
  return false;
}

/**
 * MANAGEMENT SCOPE — may this user view/administer this campaign and its contacts?
 *
 * Adds same-organization Admin / Super Admin access to agent-owned Personal campaigns on
 * top of the dial scope. `viewAll` continues to widen TEAM only — it never exposes another
 * user's Personal campaign to a Team Leader or Agent.
 *
 * Organization scoping is the caller's responsibility (every campaign query is already
 * `organization_id`-filtered and RLS-bounded); this predicate assumes a same-org row.
 */
export function canUserManageCampaign(
  c: CampaignLike,
  userId: string,
  opts?: CampaignManagementRole,
): boolean {
  if (canUserDialCampaign(c, userId)) return true;
  if (isPersonalCampaign(c)) return Boolean(opts?.isAdmin || opts?.isSuperAdmin);
  if (opts?.viewAll && isTeamCampaign(c)) return true;
  return false;
}

/** Campaigns this user may see/select/start in the Dialer. */
export function filterCampaignsForDialing<T extends CampaignLike>(cs: readonly T[], userId: string): T[] {
  return cs.filter((c) => canUserDialCampaign(c, userId));
}

/** Campaigns this user may view/administer. */
export function filterCampaignsForManagement<T extends CampaignLike>(
  cs: readonly T[],
  userId: string,
  opts?: CampaignManagementRole,
): T[] {
  return cs.filter((c) => canUserManageCampaign(c, userId, opts));
}

/**
 * ATTACHMENT SCOPE — campaigns the assignee can attach a lead they own to (manual add helper).
 * Behaviour is unchanged: Personal owner-only, Team participants, Open Pool org-wide,
 * `viewAll` widening TEAM only.
 */
export function filterCampaignsForAssignee(
  cs: CampaignLike[],
  assigneeId: string,
  opts?: { viewAll?: boolean },
): CampaignLike[] {
  return cs.filter((c) => {
    if (canUserDialCampaign(c, assigneeId)) return true;
    return Boolean(opts?.viewAll && isTeamCampaign(c));
  });
}

export function campaignAcceptsUnassignedLeads(c: CampaignLike): boolean {
  return isTeamCampaign(c) || isOpenPoolCampaign(c);
}
