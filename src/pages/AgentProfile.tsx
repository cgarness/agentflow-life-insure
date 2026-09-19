/**
 * AgentProfile — the premium business profile, in two scopes.
 *
 *   Agent Profile  "what have I built personally?"
 *   Team Profile   "what has the organization beneath me built?"
 *
 * Reports answers a different question — why, when and how performance changed over a date range —
 * and this page deliberately does not duplicate it. Nothing here is windowed; everything is
 * lifetime.
 *
 * THIS FILE IS ORCHESTRATION ONLY. It resolves identity and branding, renders the two tabs, and
 * owns no data fetching, no aggregation and no metric definition. The version it replaces was a
 * single 301-line page that fetched every `calls`, `clients` and `wins` row belonging to the agent
 * into the browser with no limit and reduced them in the render path.
 *
 * Deliberately NOT added to `src/lib/viewAsSurfaces.ts`: `/agent-profile` is blocked under "View As"
 * at the `AppLayout` guard, and `viewAsSurfaces.test.ts` pins that exclusion. Admitting it would
 * render the operator's own book of business under the viewed agent's name.
 */

import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useIsOrganizationWideViewer } from "@/hooks/useProfileData";
import { AgentProfileTab } from "@/components/agent-profile/AgentProfileTab";
import { TeamProfileTab } from "@/components/agent-profile/team/TeamProfileTab";

type ProfileTab = "agent" | "team";

const AgentProfile: React.FC = () => {
  const { profile } = useAuth();
  const { branding } = useBranding();
  const isOrganizationWide = useIsOrganizationWideViewer();

  const [tab, setTab] = useState<ProfileTab>("agent");

  const firstName = profile?.first_name || "Agent";
  const lastName = profile?.last_name || "";
  const leaderName = `${firstName} ${lastName}`.trim();

  // The organization's real name, from branding. Never a hardcoded agency name.
  const organizationName = branding?.companyName?.trim() || "Your agency";
  const organizationLogoUrl = branding?.logoUrl?.trim() || null;

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-7xl">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ProfileTab)} className="space-y-6">
          <div className="border-b border-border">
            <TabsList className="h-auto border-none bg-transparent p-0">
              <TabsTrigger
                value="agent"
                className="rounded-none px-4 py-2.5 text-sm transition-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-6"
              >
                Agent Profile
              </TabsTrigger>
              <TabsTrigger
                value="team"
                className="rounded-none px-4 py-2.5 text-sm transition-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-6"
              >
                Team Profile
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="agent" className="mt-0 focus-visible:outline-none">
            <AgentProfileTab
              organizationName={organizationName}
              organizationLogoUrl={organizationLogoUrl}
            />
          </TabsContent>

          {/*
            Mounted only once the Team tab is selected. Resolving the downline runs
            getAgentScopeIds, which is strictly sequential — rounds x batches x pages, one network
            round trip each — so the Agent tab must never wait on it.
          */}
          <TabsContent value="team" className="mt-0 focus-visible:outline-none">
            {tab === "team" && (
              <TeamProfileTab
                leaderName={leaderName}
                leaderRole={profile?.role || "Agent"}
                organizationName={organizationName}
                isOrganizationWide={isOrganizationWide}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AgentProfile;
