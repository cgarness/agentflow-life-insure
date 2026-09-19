/**
 * ProfileHero — "who I am and what I am set up to sell", not "what I am doing right now".
 *
 * Deliberately ABSENT: availability status. The old page put the agent's operational state at the
 * centre of what is meant to be an overall business profile. Availability belongs to Settings and
 * inbound routing; this page never reads `profiles.availability_status`.
 *
 * The organization name comes from the branding context, which resolves
 * `company_settings.company_name` -> `organizations.name` -> "AgentFlow". No agency name is ever
 * hardcoded.
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Building2, IdCard, MapPin, Pencil, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { US_STATE_NAME_BY_CODE } from "@/constants/us-geo";
import { normalizeUsState } from "@/utils/stateUtils";
import { cn } from "@/lib/utils";
import { ProfileHeroFact } from "./ProfileHeroFact";

export interface ProfileHeroProps {
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl: string | null;
  organizationName: string;
  organizationLogoUrl: string | null;
  npn: string | null;
  residentState: string | null;
  licensedStateCount: number | null;
  carrierAppointmentCount: number;
  readinessPercent: number | null;
  isFullyReady: boolean;
  isLoading?: boolean;
}

/**
 * Display a state in its full name form.
 *
 * `profiles.resident_state` is written as a FULL NAME by Settings and as a 2-LETTER CODE by User
 * Management, so it is normalized to a code first and then expanded. The old page searched the
 * name->code map BY VALUE, which showed "CA" as the title for any invitation-created agent.
 */
function displayState(raw: string | null): string | null {
  if (!raw || raw.trim() === "") return null;
  const code = normalizeUsState(raw.trim()).toUpperCase();
  return US_STATE_NAME_BY_CODE[code] ?? raw.trim();
}

export const ProfileHero: React.FC<ProfileHeroProps> = ({
  firstName,
  lastName,
  role,
  avatarUrl,
  organizationName,
  organizationLogoUrl,
  npn,
  residentState,
  licensedStateCount,
  carrierAppointmentCount,
  readinessPercent,
  isFullyReady,
  isLoading = false,
}) => {
  const navigate = useNavigate();
  const initials = `${firstName.charAt(0) || "A"}${lastName.charAt(0) || ""}`.toUpperCase();
  const stateName = displayState(residentState);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      {/* A single restrained accent, not a decorative image competing with the data. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary/5 blur-3xl" />

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4 sm:gap-5">
            {isLoading ? (
              <Skeleton className="h-16 w-16 shrink-0 rounded-2xl sm:h-20 sm:w-20" />
            ) : avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl border border-border object-cover sm:h-20 sm:w-20"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-xl font-semibold text-primary sm:h-20 sm:w-20 sm:text-2xl">
                {initials}
              </div>
            )}

            <div className="min-w-0 pt-0.5">
              {isLoading ? (
                <>
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="mt-2 h-4 w-32" />
                </>
              ) : (
                <>
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {firstName} {lastName}
                  </h1>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{role}</span>
                    <span aria-hidden className="text-muted-foreground/40">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {organizationLogoUrl ? (
                        <img src={organizationLogoUrl} alt="" className="h-4 w-4 rounded object-contain" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate">{organizationName}</span>
                    </span>
                  </div>

                  {readinessPercent !== null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "mt-3 gap-1.5 border font-medium",
                        isFullyReady
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-warning/40 bg-warning/10 text-warning",
                      )}
                    >
                      {isFullyReady ? (
                        <BadgeCheck className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {isFullyReady ? "Fully set up" : `${readinessPercent}% set up`}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {/* ABSOLUTE paths: setSearchParams is route-relative and would produce
                /agent-profile?section=… , a link that goes nowhere. */}
            <Button variant="outline" size="sm" onClick={() => navigate("/settings?section=my-profile")}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit profile
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/settings")}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Profile settings
            </Button>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border/60 pt-6 sm:grid-cols-4">
          <ProfileHeroFact
            icon={<IdCard className="h-4 w-4" />}
            label="NPN"
            value={npn?.trim() || <span className="text-muted-foreground">Not on file</span>}
          />
          <ProfileHeroFact
            icon={<MapPin className="h-4 w-4" />}
            label="Resident state"
            value={stateName ?? <span className="text-muted-foreground">Not set</span>}
          />
          <ProfileHeroFact
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Licensed states"
            value={
              licensedStateCount === null ? (
                <span className="text-muted-foreground">Unavailable</span>
              ) : (
                licensedStateCount
              )
            }
          />
          <ProfileHeroFact
            icon={<Building2 className="h-4 w-4" />}
            label="Carrier appointments"
            value={carrierAppointmentCount}
          />
        </div>
      </div>
    </section>
  );
};
