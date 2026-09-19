/**
 * LicensingCard — the agent's state licences, from the CANONICAL source.
 *
 * Reads `agent_state_licenses`. It does NOT read `profiles.licensed_states`, which is the legacy
 * store the previous page used: onboarding and invite flows still write it, nothing syncs it to
 * `agent_state_licenses`, and in production 7 of the 11 agents who have legacy entries have no
 * canonical rows at all. Those agents will now see nothing here, so the card says so and links to
 * where they can record them — an honest regression converted into an action rather than a silent
 * zero. (Migrating that legacy data is a separate, approval-gated task; this build does not touch
 * a single row of it.)
 *
 * THE STATUS MAPPING IS THE POINT:
 *
 *   expired  -> "Expired"              destructive   an actual problem
 *   soon     -> "Expiring Soon"        warning       needs attention within 30 days
 *   ok       -> "Active"               success       genuinely current
 *   none     -> "No expiration on file" MUTED        no evidence either way
 *
 * The existing Settings card maps `none` to a green "Active"
 * (ProfileStateLicensesCard.tsx:350-356), which asserts currency for the 17 of 18 production rows
 * that carry no expiration date. That is the one behaviour this card deliberately does not copy.
 */

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/contexts/BrandingContext";
import { expirationStatus, type LicenseRow } from "@/components/settings/state-licenses/stateLicenseSchema";
import { US_STATE_NAME_BY_CODE } from "@/constants/us-geo";
import { normalizeUsState } from "@/utils/stateUtils";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
} from "./ProfilePrimitives";
import { cn } from "@/lib/utils";

const STATUS_PRESENTATION = {
  expired: { label: "Expired", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  soon: { label: "Expiring Soon", cls: "border-warning/40 bg-warning/10 text-warning" },
  ok: { label: "Active", cls: "border-success/40 bg-success/10 text-success" },
  none: { label: "No expiration on file", cls: "border-border bg-muted text-muted-foreground" },
} as const;

export interface LicensingCardProps {
  licenses: LicenseRow[] | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  residentState: string | null;
  /** How many entries the agent has in the LEGACY `profiles.licensed_states` store. */
  legacyLicensedStateCount: number;
}

export const LicensingCard: React.FC<LicensingCardProps> = ({
  licenses,
  isLoading,
  error,
  onRetry,
  residentState,
  legacyLicensedStateCount,
}) => {
  const navigate = useNavigate();
  const { formatDate } = useBranding();

  const residentCode = residentState ? normalizeUsState(residentState).toUpperCase() : null;

  const rows = useMemo(() => {
    if (!licenses) return [];
    return [...licenses]
      .map((lic) => {
        const code = normalizeUsState(lic.state ?? "").toUpperCase();
        return {
          ...lic,
          code,
          name: US_STATE_NAME_BY_CODE[code] ?? lic.state,
          status: expirationStatus(lic.expiration_date),
          // Derived by comparing NORMALIZED values on both sides. It is a derived chip, never
          // presented as a stored licence attribute — no resident flag exists on the table, and
          // the (agent_id, state) unique index means the distinction cannot even be represented.
          isResident: residentCode !== null && code === residentCode,
        };
      })
      .sort((a, b) => Number(b.isResident) - Number(a.isResident) || a.code.localeCompare(b.code));
  }, [licenses, residentCode]);

  const showLegacyNotice =
    !error && licenses !== null && licenses.length === 0 && legacyLicensedStateCount > 0;

  return (
    <ProfileSection
      title="State licensing"
      description="Recorded state licences, the source of truth for where you can write."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/settings?section=state-licenses")}
        >
          Manage licences
        </Button>
      }
    >
      {error ? (
        <MetricUnavailable title="Licences couldn't load" onRetry={onRetry} />
      ) : isLoading || !licenses ? (
        <ProfileSkeletonBlock rows={3} />
      ) : rows.length === 0 ? (
        <>
          <ProfileEmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="No state licences recorded"
            description="Add your state licences so your profile reflects where you can write business."
            action={
              <Button size="sm" onClick={() => navigate("/settings?section=state-licenses")}>
                Add a licence
              </Button>
            }
          />
          {showLegacyNotice && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {legacyLicensedStateCount}{" "}
              {legacyLicensedStateCount === 1 ? "state was" : "states were"} listed on your
              onboarding profile but {legacyLicensedStateCount === 1 ? "has" : "have"} not been
              recorded as {legacyLicensedStateCount === 1 ? "a licence" : "licences"} yet. Add{" "}
              {legacyLicensedStateCount === 1 ? "it" : "them"} in Settings to show{" "}
              {legacyLicensedStateCount === 1 ? "it" : "them"} here.
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((lic) => {
            const presentation = STATUS_PRESENTATION[lic.status];
            return (
              <div
                key={lic.id}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
                  {lic.code}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">{lic.name}</p>
                    {lic.isResident && (
                      <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-primary">
                        Resident
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CreditCard className="h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate font-mono">
                      {lic.license_number?.trim() ? (
                        lic.license_number
                      ) : (
                        <span className="italic opacity-70">No licence number</span>
                      )}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        presentation.cls,
                      )}
                    >
                      {presentation.label}
                    </span>
                    {lic.expiration_date && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(lic.expiration_date)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ProfileSection>
  );
};
