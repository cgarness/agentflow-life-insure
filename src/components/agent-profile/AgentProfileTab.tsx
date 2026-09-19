/**
 * AgentProfileTab — "my career and my book of business".
 *
 * Composition only: every number arrives from `useProfileData`, every section owns its own
 * loading / empty / FAILED presentation, and a failure in one card never blanks the page.
 *
 * WHAT IS NOT HERE, DELIBERATELY: calls today, calls this month, total talk time, callbacks,
 * appointments, live campaigns, active queues and availability status. Those are daily-work
 * telemetry; they live on the Dialer header and on Reports, and putting them here is what made the
 * previous version of this page an operations console wearing a profile's clothes.
 */

import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOwnLicenses, useProfileBookStats } from "@/hooks/useProfileData";
import { computeReadiness, type ReadinessSummary } from "@/lib/profile/profile-readiness";
import { normalizeProfileCarriers } from "@/components/settings/ProfileCarriersSection";
import { ProfileHero } from "./ProfileHero";
import { BusinessSnapshot } from "./BusinessSnapshot";
import { ReadinessCard } from "./ReadinessCard";
import { CarrierProductionCard } from "./CarrierProductionCard";
import { PolicyTypeMixCard } from "./PolicyTypeMixCard";
import { LicensingCard } from "./LicensingCard";
import { CarrierAppointmentsCard } from "./CarrierAppointmentsCard";
import { AchievementsCard } from "./AchievementsCard";

export interface AgentProfileTabProps {
  organizationName: string;
  organizationLogoUrl: string | null;
}

/** How many entries the agent has in the LEGACY `profiles.licensed_states` store. */
function countLegacyLicensedStates(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0;
}

export const AgentProfileTab: React.FC<AgentProfileTabProps> = ({
  organizationName,
  organizationLogoUrl,
}) => {
  const { profile, user, isLoading: authLoading } = useAuth();
  const book = useProfileBookStats("self");
  const licenses = useOwnLicenses();

  const carrierCount = normalizeProfileCarriers(profile?.carriers).length;

  // Readiness needs licences, so it is only computable once that query has SUCCEEDED. A licence
  // failure must not produce a readiness summary built on an empty list — that would report the
  // agent as missing a resident-state licence they may well hold.
  const readiness: ReadinessSummary | null =
    licenses.data === null
      ? null
      : computeReadiness({
          firstName: profile?.first_name,
          lastName: profile?.last_name,
          email: profile?.email ?? user?.email,
          phone: profile?.phone,
          npn: profile?.npn,
          residentState: profile?.resident_state,
          onboardingComplete: profile?.onboarding_complete,
          carrierAppointmentCount: carrierCount,
          licenses: licenses.data.map((l) => ({
            state: l.state,
            expiration_date: l.expiration_date,
          })),
        });

  return (
    <div className="space-y-5">
      <ProfileHero
        firstName={profile?.first_name || "Agent"}
        lastName={profile?.last_name || ""}
        role={profile?.role || "Agent"}
        avatarUrl={profile?.avatar_url || null}
        organizationName={organizationName}
        organizationLogoUrl={organizationLogoUrl}
        npn={profile?.npn ?? null}
        residentState={profile?.resident_state ?? null}
        // `null` renders "Unavailable" rather than a 0 the aggregate never produced.
        licensedStateCount={book.error ? null : (book.data?.distinctLicensedStates ?? null)}
        carrierAppointmentCount={carrierCount}
        readinessPercent={readiness?.percent ?? null}
        isFullyReady={readiness?.isFullyReady ?? false}
        isLoading={authLoading || !profile}
      />

      <BusinessSnapshot
        title="Business snapshot"
        description="Lifetime totals across everything you have written."
        stats={book.data}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <ReadinessCard
          summary={readiness}
          isLoading={licenses.isLoading || authLoading}
          error={licenses.error}
          onRetry={licenses.refetch}
        />
        <PolicyTypeMixCard
          rows={book.data?.policyTypeMix ?? null}
          overflowPolicies={book.data?.policyTypeOverflowPolicies ?? 0}
          totalPolicies={book.data?.totalPolicies ?? 0}
          isLoading={book.isLoading}
          error={book.error}
          onRetry={book.refetch}
        />
      </div>

      <CarrierProductionCard
        rows={book.data?.carrierBreakdown ?? null}
        overflowPolicies={book.data?.carrierOverflowPolicies ?? 0}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
      />

      <LicensingCard
        licenses={licenses.data}
        isLoading={licenses.isLoading}
        error={licenses.error}
        onRetry={licenses.refetch}
        residentState={profile?.resident_state ?? null}
        legacyLicensedStateCount={countLegacyLicensedStates(profile?.licensed_states)}
      />

      <CarrierAppointmentsCard rawCarriers={profile?.carriers} />

      <AchievementsCard
        stats={book.data}
        isLoading={book.isLoading}
        error={book.error}
        onRetry={book.refetch}
      />
    </div>
  );
};
