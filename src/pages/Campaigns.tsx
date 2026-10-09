import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import CampaignsPageContent from "@/components/campaigns/CampaignsPageContent";

/**
 * Campaigns management table (Phase 1). The body is keyed by the signed-in user and
 * organization, so filters, the expanded row, column drafts and pending saves reset during
 * render whenever the identity changes — another viewer's state can never paint here.
 */
const Campaigns: React.FC = () => {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  return <CampaignsPageContent key={`${user?.id ?? "anonymous"}:${organizationId ?? "no-org"}`} />;
};

export default Campaigns;
