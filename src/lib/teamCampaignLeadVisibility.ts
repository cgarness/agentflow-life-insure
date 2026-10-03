/** Display-only evidence; it never authorizes a database read, claim, or write. */
export interface TeamLeadDisplayVisit {
  readonly organizationId: string;
  readonly viewerId: string;
  readonly campaignId: string;
}

export interface TeamLeadDisplayConfirmation {
  readonly visit: TeamLeadDisplayVisit;
  readonly campaignLeadId: string;
  readonly leadId: string;
}

export interface TeamLeadVisibilityInput {
  visit: TeamLeadDisplayVisit | null;
  confirmation: TeamLeadDisplayConfirmation | null;
  lead: Record<string, unknown> | null;
  confirmedLockLeadId: string | null;
  loading: boolean;
  advancing: boolean;
}

/** Same visit, row, and confirmed lock; outbound answer state is intentionally irrelevant. */
export function canShowTeamCampaignLeadDetails(i: TeamLeadVisibilityInput): boolean {
  const { visit, confirmation, lead } = i;
  if (!visit || !confirmation || !lead || i.loading || i.advancing) return false;
  return confirmation.visit === visit &&
    confirmation.campaignLeadId === i.confirmedLockLeadId &&
    lead.id === confirmation.campaignLeadId &&
    lead.lead_id === confirmation.leadId &&
    lead.campaign_id === visit.campaignId &&
    lead.organization_id === visit.organizationId;
}
