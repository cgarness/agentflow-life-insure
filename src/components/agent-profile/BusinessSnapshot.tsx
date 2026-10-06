/**
 * BusinessSnapshot — the five lifetime figures that answer "what have I built?".
 *
 * Every tile carries its definition, because several of them are not what the label alone implies:
 *
 *   Total Policies         counts additional policies, so it can exceed the client count
 *   Total Monthly Premium  is NOT annualized, and excludes policies with no premium recorded
 *   Carriers               is derived from POLICY records, not from carrier appointments
 *   Licensed States        counts distinct NORMALIZED states, so "CA" and "California" count once
 *
 * Used by BOTH tabs. Sharing the component is what guarantees the Agent and Team scopes use the
 * same definitions rather than drifting into two numbers with one name.
 */

import React from "react";
import { Building2, FileText, MapPin, Users, Wallet } from "lucide-react";
import {
  DefinitionHint,
  MetricUnavailable,
  ProfileSection,
  StatTile,
} from "./ProfilePrimitives";
import {
  formatCount,
  formatMonthlyCurrency,
} from "@/lib/profile/profile-format";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookStats } from "@/lib/profile/profile-queries";

export interface BusinessSnapshotProps {
  stats: BookStats | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** "Team" prefixes the labels on the Team tab. */
  scopeLabel?: "Total" | "Team";
  title: string;
  description?: string;
  /** Rendered as a sixth tile on the Team tab only. */
  extraTile?: React.ReactNode;
}

export const BusinessSnapshot: React.FC<BusinessSnapshotProps> = ({
  stats,
  isLoading,
  error,
  onRetry,
  scopeLabel = "Total",
  title,
  description,
  extraTile,
}) => {
  const prefix = scopeLabel === "Team" ? "Team " : "";

  return (
    <ProfileSection title={title} description={description}>
      {error ? (
        <MetricUnavailable title="Business snapshot couldn't load" onRetry={onRetry} />
      ) : isLoading || !stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[132px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatTile
            icon={<Users className="h-4 w-4" />}
            label={`${prefix}Clients`}
            value={formatCount(stats.totalClients)}
            caveat={
              stats.clientsWithoutPolicyDetail > 0
                ? `${formatCount(stats.clientsWithoutPolicyDetail)} with no policy details recorded`
                : undefined
            }
          />

          <StatTile
            icon={<FileText className="h-4 w-4" />}
            label={`${prefix}Policies`}
            value={formatCount(stats.totalPolicies)}
            hint={
              stats.additionalPolicyCount > 0
                ? `Includes ${formatCount(stats.additionalPolicyCount)} additional ${
                    stats.additionalPolicyCount === 1 ? "policy" : "policies"
                  } beyond the primary one.`
                : "Primary policy per client, plus any additional policies recorded."
            }
            caveat={
              stats.malformedAdditionalPolicies > 0
                ? `${formatCount(stats.malformedAdditionalPolicies)} additional-policy ${
                    stats.malformedAdditionalPolicies === 1 ? "record" : "records"
                  } could not be read`
                : undefined
            }
          />

          <StatTile
            icon={<Wallet className="h-4 w-4" />}
            label={`${prefix}Monthly Premium`}
            value={formatMonthlyCurrency(stats.totalPremiumMonthly)}
            hint="Recorded monthly premium. Not annualized."
            caveat={
              stats.policiesMissingPremium > 0
                ? `${formatCount(stats.policiesMissingPremium)} ${
                    stats.policiesMissingPremium === 1 ? "policy has" : "policies have"
                  } no premium recorded`
                : undefined
            }
          />

          <StatTile
            icon={<Building2 className="h-4 w-4" />}
            label="Carriers"
            value={formatCount(stats.distinctCarriers)}
            // Never "active carriers": no appointment status is stored anywhere, so claiming one
            // would be inventing a field.
            hint="Distinct carriers on these policies."
          />

          <StatTile
            icon={<MapPin className="h-4 w-4" />}
            label={scopeLabel === "Team" ? "States Covered" : "Licensed States"}
            value={formatCount(stats.distinctLicensedStates)}
            hint="Distinct recorded license states."
          />

          {extraTile}
        </div>
      )}

      {stats && !error && (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Lifetime totals from the{" "}
          <DefinitionHint text="Primary and additional policies on current client records, including manually added and imported clients. These are book totals, not sale-event totals.">
            book of business
          </DefinitionHint>
          . For performance over a date range, see Reports.
        </p>
      )}
    </ProfileSection>
  );
};
