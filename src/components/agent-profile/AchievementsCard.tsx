/**
 * AchievementsCard — career records, every one derived from real stored data.
 *
 * WHAT IS GONE: the previous page's "Top Producer" badge (`totalClients >= 10`) and "Hot Streak"
 * badge (`monthWins >= 3`) — src/pages/AgentProfile.tsx:136-146. No agency defined either
 * threshold. Deleted, not relocated.
 *
 * WHAT EACH RECORD MEANS:
 *   Largest policy            max face amount across primary AND additional policies
 *   Largest premium policy    max MONTHLY premium
 *   Best premium month        the calendar month with the highest total monthly premium sold
 *   Most policies in a month  the calendar month with the most policies sold
 *   Most dials in a day       the highest outbound-dial count on any single LOCAL day
 *
 * Month buckets come from the policy's sale date. `clients.sold_date` is a true `date` — no time
 * component, no timezone — so month bucketing has NO timezone ambiguity. Policies with no usable
 * sale date are excluded and their count is stated, never folded into a guessed month.
 *
 * "Most dials in a day" is the one figure that genuinely needs a timezone, so it carries its own:
 * the browser's IANA zone, validated server-side against `pg_timezone_names`, and NAMED on the tile
 * because the zone is what defines the day boundary. `profiles.timezone` cannot be used — it stores
 * Rails labels like "Eastern Time (US & Canada)", which are not IANA names (AGENT_RULES #14).
 * It is computed for the AGENT scope only: "the team's busiest day" and "the best day any member
 * had" are different metrics and neither is what the label implies.
 *
 * A record the aggregate could not compute is ABSENT. It is never rendered as a zero.
 */

import React from "react";
import { Award, CalendarRange, Layers, PhoneCall, Trophy } from "lucide-react";
import { useBranding } from "@/contexts/BrandingContext";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
} from "./ProfilePrimitives";
import {
  formatCount,
  formatMonthBucket,
  formatMonthlyCurrency,
  formatWholeCurrency,
} from "@/lib/profile/profile-format";
import { AchievementTile, MilestoneLadder, UndatedPolicyNote } from "./AchievementTiles";
import { buildProfileMilestones } from "@/lib/profile/profile-milestones";
import type { BookStats } from "@/lib/profile/profile-queries";

export interface AchievementsCardProps {
  stats: BookStats | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  isTeam?: boolean;
}

export const AchievementsCard: React.FC<AchievementsCardProps> = ({
  stats,
  isLoading,
  error,
  onRetry,
  isTeam = false,
}) => {
  const { formatDate } = useBranding();
  const a = stats?.achievements;

  const detail = (parts: (string | null | undefined)[]) =>
    parts.filter(Boolean).join(" · ") || null;

  const tiles: React.ReactNode[] = [];

  if (a?.largestFace?.faceAmount) {
    tiles.push(
      <AchievementTile
        key="largest-face"
        icon={<Trophy className="h-4 w-4" />}
        label={isTeam ? "Largest team policy" : "Largest policy"}
        value={formatWholeCurrency(a.largestFace.faceAmount)}
        detail={detail([
          a.largestFace.carrier,
          a.largestFace.policyType,
          a.largestFace.soldDate ? formatDate(a.largestFace.soldDate) : null,
        ])}
      />,
    );
  }

  if (a?.largestPremium?.premiumMonthly) {
    tiles.push(
      <AchievementTile
        key="largest-premium"
        icon={<Award className="h-4 w-4" />}
        label="Largest premium policy"
        value={`${formatMonthlyCurrency(a.largestPremium.premiumMonthly)}/mo`}
        detail={detail([
          a.largestPremium.carrier,
          a.largestPremium.policyType,
          a.largestPremium.soldDate ? formatDate(a.largestPremium.soldDate) : null,
        ])}
      />,
    );
  }

  if (a?.bestPremiumMonth) {
    tiles.push(
      <AchievementTile
        key="best-month"
        icon={<CalendarRange className="h-4 w-4" />}
        label="Best premium month"
        value={`${formatMonthlyCurrency(a.bestPremiumMonth.premiumMonthly)}/mo`}
        detail={`${formatMonthBucket(a.bestPremiumMonth.month)} · ${formatCount(
          a.bestPremiumMonth.policies,
        )} ${a.bestPremiumMonth.policies === 1 ? "policy" : "policies"}`}
      />,
    );
  }

  if (a?.mostPoliciesMonth) {
    tiles.push(
      <AchievementTile
        key="most-policies-month"
        icon={<Layers className="h-4 w-4" />}
        label="Most policies in a month"
        value={formatCount(a.mostPoliciesMonth.policies)}
        detail={`${formatMonthBucket(a.mostPoliciesMonth.month)} · ${formatMonthlyCurrency(
          a.mostPoliciesMonth.premiumMonthly,
        )} monthly`}
      />,
    );
  }

  if (a?.mostDialsDay) {
    tiles.push(
      <AchievementTile
        key="most-dials"
        icon={<PhoneCall className="h-4 w-4" />}
        label="Most dials in a day"
        value={formatCount(a.mostDialsDay.dials)}
        detail={`${formatDate(a.mostDialsDay.day)} · measured in ${a.mostDialsDay.timeZone}`}
      />,
    );
  }

  const milestones = stats
    ? buildProfileMilestones(
        {
          totalClients: stats.totalClients,
          totalPolicies: stats.totalPolicies,
          totalPremiumMonthly: stats.totalPremiumMonthly,
          distinctLicensedStates: stats.distinctLicensedStates,
          isTeam,
        },
        formatCount,
      )
    : [];

  return (
    <ProfileSection
      title={isTeam ? "Team achievements" : "Lifetime achievements"}
      description="Career records, derived from recorded policy and dialing history."
    >
      {error ? (
        <MetricUnavailable title="Achievements couldn't load" onRetry={onRetry} />
      ) : isLoading || !stats ? (
        <ProfileSkeletonBlock rows={3} />
      ) : (
        <>
          {tiles.length === 0 ? (
            <ProfileEmptyState
              icon={<Trophy className="h-6 w-6" />}
              title="No records yet"
              description="Records appear as policies are written and dialing history builds up."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tiles}</div>
          )}

          <MilestoneLadder milestones={milestones} />
          <UndatedPolicyNote count={stats.undatedPolicies} />
        </>
      )}
    </ProfileSection>
  );
};
