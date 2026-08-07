/**
 * Import ↔ campaign compatibility rules (Contacts / Import Build).
 *
 * Pure predicates shared by the campaign picker (display), the submit-time guard, and the
 * new-campaign ownership payload. The SERVER remains the authority — `create_import_campaign`
 * and `add_leads_to_campaign` re-enforce every rule here. Frontend filtering is UX, never
 * authorization.
 *
 * Mirrors the server matrix:
 *   Personal  — owner is the selected agent (Specific Agent) or the caller (Myself).
 *               Round Robin and Unassigned may NOT use a Personal campaign.
 *   Team      — owner is the creator (existing semantics); participants come from the import.
 *               Assigned leads must belong to `assigned_agent_ids`; unassigned leads are eligible.
 *   Open Pool — organization-wide; no participants.
 */

export type ImportAssignStrategy = "myself" | "specific_agent" | "round_robin" | "unassigned";

export type ImportCampaignType = "Personal" | "Team" | "Open Pool";

export interface ImportCampaignLike {
  type: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
}

export interface ImportAssignContext {
  strategy: ImportAssignStrategy;
  /** The authenticated importer. */
  currentUserId: string;
  /** Selected agent (Specific Agent) or the rotation set (Round Robin). Empty otherwise. */
  agentIds: string[];
}

function normalizeType(type: string | null | undefined): string {
  return (type ?? "").trim().toUpperCase();
}

function isPersonal(c: ImportCampaignLike): boolean {
  return normalizeType(c.type) === "PERSONAL";
}

function isTeam(c: ImportCampaignLike): boolean {
  return normalizeType(c.type) === "TEAM";
}

function isOpenPool(c: ImportCampaignLike): boolean {
  const t = normalizeType(c.type);
  return t === "OPEN POOL" || t === "OPEN";
}

/** Tolerates a jsonb array, a JSON string, or garbage. */
function participantSet(raw: unknown): Set<string> {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  return new Set(arr.map((x) => String(x)));
}

function uniq(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

/** The agents this import will assign leads to. Empty for an unassigned import. */
function targetAgents(ctx: ImportAssignContext): string[] {
  if (ctx.strategy === "myself") return [ctx.currentUserId];
  if (ctx.strategy === "unassigned") return [];
  return uniq(ctx.agentIds);
}

/**
 * Which campaign types may be created NEW for a given import strategy.
 * Personal is withheld for Round Robin and Unassigned — those leads can never satisfy the
 * Personal eligibility rule (`lead.assigned_agent_id = campaigns.user_id`).
 */
export function campaignTypesForStrategy(strategy: ImportAssignStrategy): ImportCampaignType[] {
  if (strategy === "round_robin" || strategy === "unassigned") return ["Team", "Open Pool"];
  return ["Personal", "Team", "Open Pool"];
}

/** Whether an EXISTING campaign can actually receive this import's leads. */
export function isCampaignCompatibleWithImport(c: ImportCampaignLike, ctx: ImportAssignContext): boolean {
  if (isOpenPool(c)) return true;

  const targets = targetAgents(ctx);

  if (isPersonal(c)) {
    // Round Robin and Unassigned can never satisfy a single-owner Personal campaign.
    if (ctx.strategy === "round_robin" || ctx.strategy === "unassigned") return false;
    if (targets.length !== 1) return false;
    return (c.user_id ?? "") === targets[0];
  }

  if (isTeam(c)) {
    // Unassigned leads are eligible for a Team campaign and stay unassigned.
    if (ctx.strategy === "unassigned") return true;
    if (targets.length === 0) return false;
    const participants = participantSet(c.assigned_agent_ids);
    return targets.every((id) => participants.has(id));
  }

  return false;
}

/** Convenience filter for the picker. */
export function filterCampaignsForImport<T extends ImportCampaignLike>(
  campaigns: readonly T[],
  ctx: ImportAssignContext,
): T[] {
  return campaigns.filter((c) => isCampaignCompatibleWithImport(c, ctx));
}

/**
 * `campaigns.user_id` for a NEW campaign.
 * Personal follows the lead owner; Team and Open Pool preserve creator-owner semantics.
 * Returns `null` for a combination the server will reject.
 */
export function resolveCampaignOwnerId(
  type: ImportCampaignType,
  ctx: ImportAssignContext,
): string | null {
  if (type !== "Personal") return ctx.currentUserId;
  if (ctx.strategy === "round_robin" || ctx.strategy === "unassigned") return null;
  const targets = targetAgents(ctx);
  return targets.length === 1 ? targets[0] : null;
}

/** `campaigns.assigned_agent_ids` for a NEW campaign. */
export function participantIdsForImport(type: ImportCampaignType, ctx: ImportAssignContext): string[] {
  if (type === "Open Pool") return [];
  if (ctx.strategy === "unassigned") return [ctx.currentUserId]; // D-3
  return targetAgents(ctx);
}

/** Submit-time guard mirroring the server's rejections; returns an error string or null. */
export function validateImportCampaignSelection(args: {
  ctx: ImportAssignContext;
  mode: "none" | "existing" | "new";
  existingCampaign?: ImportCampaignLike | null;
  newType?: ImportCampaignType;
  newName?: string;
}): string | null {
  const { ctx, mode, existingCampaign, newType, newName } = args;
  if (mode === "none") {
    return ctx.strategy === "unassigned"
      ? "Unassigned leads must join a Team or Open Pool campaign."
      : null;
  }

  if (mode === "existing") {
    if (!existingCampaign) return "Select a campaign from the list.";
    if (!isCampaignCompatibleWithImport(existingCampaign, ctx)) {
      return "That campaign can't receive these leads. Pick a compatible campaign or change the assignment.";
    }
    return null;
  }

  if (!newName?.trim()) return "Enter a name for the new campaign.";
  if (!newType) return "Choose a campaign type.";
  if (!campaignTypesForStrategy(ctx.strategy).includes(newType)) {
    return newType === "Personal"
      ? "Personal campaigns can't be used with this assignment. Choose Team or Open Pool."
      : "That campaign type isn't available for this assignment.";
  }
  if (newType === "Personal" && !resolveCampaignOwnerId("Personal", ctx)) {
    return "Select exactly one agent to own this Personal campaign.";
  }
  if (newType === "Team" && ctx.strategy !== "unassigned" && targetAgents(ctx).length === 0) {
    return "Select at least one agent for this Team campaign.";
  }
  return null;
}
