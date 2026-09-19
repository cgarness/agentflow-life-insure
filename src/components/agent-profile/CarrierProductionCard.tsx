/**
 * CarrierProductionCard — lifetime book of business by carrier.
 *
 * Two rules the bars follow:
 *
 *  * A policy with NO carrier recorded gets its own visible row, never a silent drop. Blank is the
 *    unset value for `clients.carrier` (it DEFAULTs to ''), and hiding those rows would make the
 *    bars stop summing to the policy count.
 *  * Every bar is `bg-primary`. A per-carrier colour would imply a categorical meaning that does
 *    not exist, and would have to be re-checked for contrast in both themes for no gain.
 *
 * Shared by both tabs, so Agent and Team production are visually and definitionally identical.
 */

import React, { useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
  ShareBar,
} from "./ProfilePrimitives";
import {
  formatCount,
  formatMonthlyCurrency,
} from "@/lib/profile/profile-format";
import type { CarrierProductionRow } from "@/lib/profile/profile-queries";
import { cn } from "@/lib/utils";

type Mode = "policies" | "premium";

export interface CarrierProductionCardProps {
  rows: CarrierProductionRow[] | null;
  overflowPolicies: number;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  title?: string;
}

export const NO_CARRIER_LABEL = "No carrier recorded";

export const CarrierProductionCard: React.FC<CarrierProductionCardProps> = ({
  rows,
  overflowPolicies,
  isLoading,
  error,
  onRetry,
  title = "Carrier production",
}) => {
  const [mode, setMode] = useState<Mode>("policies");

  const ordered = useMemo(() => {
    if (!rows) return [];
    const sorted = [...rows].sort((a, b) =>
      mode === "policies"
        ? b.policies - a.policies || b.premiumMonthly - a.premiumMonthly
        : b.premiumMonthly - a.premiumMonthly || b.policies - a.policies,
    );
    const max = sorted.reduce(
      (acc, r) => Math.max(acc, mode === "policies" ? r.policies : r.premiumMonthly),
      0,
    );
    return sorted.map((r) => ({
      ...r,
      percent: max === 0 ? 0 : ((mode === "policies" ? r.policies : r.premiumMonthly) / max) * 100,
    }));
  }, [rows, mode]);

  return (
    <ProfileSection
      title={title}
      description="Lifetime policies and monthly premium by carrier."
      action={
        rows && rows.length > 0 && !error ? (
          <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
            {(["policies", "premium"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {error ? (
        <MetricUnavailable title="Carrier production couldn't load" onRetry={onRetry} />
      ) : isLoading || !rows ? (
        <ProfileSkeletonBlock rows={4} />
      ) : ordered.length === 0 ? (
        <ProfileEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No policies on the book yet"
          description="Carrier production appears once policies are recorded against clients."
        />
      ) : (
        <>
          <ul className="space-y-4">
            {ordered.map((row) => (
              <li key={row.carrier ?? "__none__"}>
                <div className="mb-1.5 flex items-baseline justify-between gap-4">
                  <span
                    className={cn(
                      "truncate text-sm font-medium",
                      row.carrier ? "text-foreground" : "italic text-muted-foreground",
                    )}
                  >
                    {row.carrier ?? NO_CARRIER_LABEL}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {mode === "policies" ? (
                      <>
                        <span className="font-medium text-foreground">
                          {formatCount(row.policies)}
                        </span>{" "}
                        {row.policies === 1 ? "policy" : "policies"}
                      </>
                    ) : (
                      <span className="font-medium text-foreground">
                        {formatMonthlyCurrency(row.premiumMonthly)}
                      </span>
                    )}
                  </span>
                </div>
                <ShareBar percent={row.percent} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === "policies"
                    ? `${formatMonthlyCurrency(row.premiumMonthly)} monthly`
                    : `${formatCount(row.policies)} ${row.policies === 1 ? "policy" : "policies"}`}
                </p>
              </li>
            ))}
          </ul>

          {overflowPolicies > 0 && (
            /* No silent truncation: if the server capped the list, say what was left out. */
            <p className="mt-4 text-xs text-muted-foreground">
              {formatCount(overflowPolicies)} further {overflowPolicies === 1 ? "policy" : "policies"}{" "}
              across additional carriers are not shown.
            </p>
          )}
        </>
      )}
    </ProfileSection>
  );
};
