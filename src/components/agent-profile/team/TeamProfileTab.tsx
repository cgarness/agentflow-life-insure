/**
 * TeamProfileTab — "the organization I have built beneath me".
 *
 * The tab is ALWAYS rendered (decision D-5). When the viewer has no downline it shows a polished
 * empty state rather than disappearing: a page that changes shape per user is harder to explain
 * than one that explains itself, and the empty state can say what a downline is and how one grows.
 *
 * SCOPE, restated because it is the security-sensitive part:
 *   * Business figures and readiness come from RPCs that derive scope from `auth.uid()` alone —
 *     the browser cannot steer them, because neither function accepts an agent id.
 *   * The roster, preview and org tree come from a query-scoped `profiles` read whose id set is
 *     resolved by `getAgentScopeIds` over `upline_id`, which throws rather than widening on error.
 *   * Nothing here reads `hierarchy_path`.
 */

import React, { useMemo, useState } from "react";
import { Building2, Users } from "lucide-react";
import { useProfileBookStats, useTeamReadiness, useTeamRoster } from "@/hooks/useProfileData";
import { buildOrgTreeView } from "@/lib/profile/profile-org-view";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  StatTile,
} from "../ProfilePrimitives";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import { BusinessSnapshot } from "../BusinessSnapshot";
import { CarrierProductionCard } from "../CarrierProductionCard";
import { PolicyTypeMixCard } from "../PolicyTypeMixCard";
import { AchievementsCard } from "../AchievementsCard";
import { TeamReadinessCard } from "./TeamReadinessCard";
import { TeamCoverageCard } from "./TeamCoverageCard";
import { TeamDownlinePreview } from "./TeamDownlinePreview";
import { FullOrganizationTreeDialog } from "./FullOrganizationTreeDialog";

export interface TeamProfileTabProps {
  leaderName: string;
  leaderRole: string;
  organizationName: string;
  /** True for Admin / non-impersonating Super Admin: their team scope is the whole organization. */
  isOrganizationWide: boolean;
}

export const TeamProfileTab: React.FC<TeamProfileTabProps> = ({
  leaderName,
  leaderRole,
  organizationName,
  isOrganizationWide,
}) => {
  const [treeOpen, setTreeOpen] = useState(false);

  const book = useProfileBookStats("team");
  const readiness = useTeamReadiness();
  const roster = useTeamRoster();

  const view = useMemo(
    () => (roster.data ? buildOrgTreeView(roster.data.profiles, roster.data.rootId) : null),
    [roster.data],
  );

  // "No team" is only a VALID conclusion when the roster query SUCCEEDED. While it is loading or
  // after it failed, the tab must not claim the viewer has no team.
  const hasNoTeam =
    !roster.isLoading && !roster.error && view !== null && view.totalDownline === 0;

  if (hasNoTeam && !isOrganizationWide) {
    return (
      <div className="space-y-5">
        <ProfileSection
          title="Team profile"
          description={`${leaderName} · ${leaderRole} · ${organizationName}`}
        >
          <ProfileEmptyState
            icon={<Users className="h-7 w-7" />}
            title="You haven't built a team yet"
            description="When agents are placed beneath you in the hierarchy, this tab shows the business your organization has written, how ready your team is to operate, and your full org chart."
          />
        </ProfileSection>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ProfileSection
        title="Team profile"
        description={
          isOrganizationWide
            ? `${leaderName} · ${leaderRole} · agency-wide view of ${organizationName}`
            : `${leaderName} · ${leaderRole} · ${organizationName}`
        }
        action={
          readiness.data && !readiness.error ? (
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {formatCount(readiness.data.readyCount)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {formatCount(readiness.data.scopeAgentCount)}
              </span>{" "}
              fully set up
            </span>
          ) : undefined
        }
      >
        {readiness.error ? (
          <MetricUnavailable title="Team summary couldn't load" onRetry={readiness.refetch} />
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isOrganizationWide
              ? "As an administrator this covers every active member of the organization."
              : "This covers you and everyone in your downline."}{" "}
            Business figures are lifetime totals, not activity.
          </p>
        )}
      </ProfileSection>

      <BusinessSnapshot
        title="Team business snapshot"
        description="Lifetime totals across the team's book of business."
        scopeLabel="Team"
        stats={book.data}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
        extraTile={
          book.data && !book.error ? (
            <StatTile
              icon={<Building2 className="h-4 w-4" />}
              label="Total Downline"
              value={formatCount(readiness.data?.totalDownline ?? Math.max(book.data.scopeAgentCount - 1, 0))}
              hint="Agents beneath you, at every level. Excludes you."
            />
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <TeamReadinessCard
          stats={readiness.data}
          isLoading={readiness.isLoading}
          error={readiness.error}
          onRetry={readiness.refetch}
        />
        <PolicyTypeMixCard
          title="Team policy type mix"
          rows={book.data?.policyTypeMix ?? null}
          overflowPolicies={book.data?.policyTypeOverflowPolicies ?? 0}
          totalPolicies={book.data?.totalPolicies ?? 0}
          isLoading={book.isLoading}
          error={book.error}
          onRetry={book.refetch}
        />
      </div>

      <CarrierProductionCard
        title="Team carrier production"
        rows={book.data?.carrierBreakdown ?? null}
        overflowPolicies={book.data?.carrierOverflowPolicies ?? 0}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
      />

      <TeamCoverageCard
        stats={readiness.data}
        isLoading={readiness.isLoading}
        error={readiness.error}
        onRetry={readiness.refetch}
      />

      <TeamDownlinePreview
        view={view}
        isLoading={roster.isLoading}
        error={roster.error}
        onRetry={roster.refetch}
        onOpenFullTree={() => setTreeOpen(true)}
        maxDepth={readiness.data?.maxDepth ?? null}
      />

      <AchievementsCard
        isTeam
        stats={book.data}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
      />

      <FullOrganizationTreeDialog open={treeOpen} onOpenChange={setTreeOpen} view={view} />
    </div>
  );
};
