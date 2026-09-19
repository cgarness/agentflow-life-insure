/**
 * TeamCoverageCard — licensing coverage across the team, as a SUMMARY.
 *
 * Deliberately not a list of every licence for every downline agent: on a team of any size that is
 * hundreds of rows nobody reads, and it would mean shipping per-agent licence detail to the browser
 * for a number that is a count. The RPC returns counts and the ten most-covered states, and that is
 * all this renders.
 *
 * No US map. `react-simple-maps` / `topojson` are not dependencies, and adding a mapping library
 * for a first implementation is not a trade worth making against a clean list.
 *
 * State codes are NORMALIZED server-side through `public.normalize_us_state`, so "CA" and
 * "California" are one state here rather than two.
 */

import React from "react";
import { MapPin } from "lucide-react";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
  ShareBar,
} from "../ProfilePrimitives";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import { US_STATE_NAME_BY_CODE } from "@/constants/us-geo";
import type { TeamReadinessStats } from "@/lib/profile/profile-queries";

export interface TeamCoverageCardProps {
  stats: TeamReadinessStats | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const Summary: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
    <p className="text-xl font-semibold tabular-nums text-foreground">{formatCount(value)}</p>
    <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
  </div>
);

export const TeamCoverageCard: React.FC<TeamCoverageCardProps> = ({
  stats,
  isLoading,
  error,
  onRetry,
}) => {
  const maxAgents = stats?.topStates.reduce((acc, s) => Math.max(acc, s.agents), 0) ?? 0;

  return (
    <ProfileSection
      title="Licensing coverage"
      description="Where the team is licensed to write."
    >
      {error ? (
        <MetricUnavailable title="Coverage couldn't load" onRetry={onRetry} />
      ) : isLoading || !stats ? (
        <ProfileSkeletonBlock rows={3} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary label="states covered" value={stats.statesCovered} />
            <Summary label="agents with licences recorded" value={stats.agentsWithLicenses} />
            <Summary label="licences with no expiration on file" value={stats.licensesWithoutExpiration} />
          </div>

          {stats.topStates.length === 0 ? (
            <ProfileEmptyState
              className="mt-5"
              icon={<MapPin className="h-6 w-6" />}
              title="No state licences recorded across the team"
              description="Coverage appears once team members record their state licences."
            />
          ) : (
            <div className="mt-6">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Top covered states
              </p>
              <ul className="space-y-3">
                {stats.topStates.map((s) => (
                  <li key={s.state}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                      <span className="truncate text-foreground">
                        <span className="font-mono font-medium">{s.state}</span>
                        <span className="ml-2 text-muted-foreground">
                          {US_STATE_NAME_BY_CODE[s.state] ?? ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        <span className="font-medium text-foreground">{formatCount(s.agents)}</span>{" "}
                        {s.agents === 1 ? "agent" : "agents"}
                      </span>
                    </div>
                    <ShareBar percent={maxAgents === 0 ? 0 : (s.agents / maxAgents) * 100} />
                  </li>
                ))}
              </ul>
              {stats.statesCovered > stats.topStates.length && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Showing the {stats.topStates.length} most-covered of {formatCount(stats.statesCovered)}{" "}
                  states.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </ProfileSection>
  );
};
