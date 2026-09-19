/**
 * TeamReadinessCard — how much of the organization beneath this leader is actually set up.
 *
 * Counts only, and every count is clickable-looking but is NOT a button: drill-in is deliberately
 * deferred rather than faked. A control that does nothing is worse than a number that is only a
 * number.
 *
 * `licensesWithoutExpiration` is shown alongside the expired and expiring counts on purpose.
 * A licence with no expiration date is `expirationStatus() === "none"` — unknown, not current — and
 * in production that is 17 of 18 rows. Reporting only "0 expired" would make the card look far
 * healthier than the underlying data supports.
 */

import React from "react";
import { AlertTriangle, CalendarClock, FileWarning, IdCard, MapPin, ShieldCheck } from "lucide-react";
import {
  MetricUnavailable,
  ProfileSection,
  ProfileSkeletonBlock,
} from "../ProfilePrimitives";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import type { TeamReadinessStats } from "@/lib/profile/profile-queries";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "attention" | "problem";

const TONE_CLS: Record<Tone, string> = {
  neutral: "border-border/60 bg-card text-foreground",
  attention: "border-warning/30 bg-warning/5 text-foreground",
  problem: "border-destructive/30 bg-destructive/5 text-foreground",
};

const GapTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: Tone;
}> = ({ icon, label, value, tone = "neutral" }) => (
  <div
    className={cn(
      "flex items-start gap-3 rounded-xl border p-4",
      TONE_CLS[value === 0 ? "neutral" : tone],
    )}
  >
    <span
      className={cn(
        "mt-0.5 shrink-0",
        value === 0
          ? "text-muted-foreground/60"
          : tone === "problem"
            ? "text-destructive"
            : tone === "attention"
              ? "text-warning"
              : "text-muted-foreground",
      )}
    >
      {icon}
    </span>
    <div className="min-w-0">
      <p className="text-xl font-semibold tabular-nums text-foreground">{formatCount(value)}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{label}</p>
    </div>
  </div>
);

export interface TeamReadinessCardProps {
  stats: TeamReadinessStats | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export const TeamReadinessCard: React.FC<TeamReadinessCardProps> = ({
  stats,
  isLoading,
  error,
  onRetry,
}) => {
  const percent =
    stats && stats.scopeAgentCount > 0
      ? Math.round((stats.readyCount / stats.scopeAgentCount) * 100)
      : null;

  return (
    <ProfileSection
      title="Team readiness"
      description="How much of the team is fully set up to write business."
      action={
        stats && !error && percent !== null ? (
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {formatCount(stats.readyCount)} of {formatCount(stats.scopeAgentCount)} ready
          </span>
        ) : undefined
      }
    >
      {error ? (
        <MetricUnavailable title="Team readiness couldn't load" onRetry={onRetry} />
      ) : isLoading || !stats ? (
        <ProfileSkeletonBlock rows={4} />
      ) : (
        <>
          {percent !== null && (
            <div className="mb-5 flex items-center gap-4">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    percent === 100 ? "bg-success" : "bg-primary",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {percent}%
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <GapTile
              icon={<IdCard className="h-4 w-4" />}
              label="need an NPN on file"
              value={stats.needsNpn}
              tone="attention"
            />
            <GapTile
              icon={<MapPin className="h-4 w-4" />}
              label="have no resident state set"
              value={stats.needsResidentState}
              tone="attention"
            />
            <GapTile
              icon={<ShieldCheck className="h-4 w-4" />}
              label="have no resident-state licence recorded"
              value={stats.needsResidentLicense}
              tone="attention"
            />
            <GapTile
              icon={<FileWarning className="h-4 w-4" />}
              label="have no carrier appointments on file"
              value={stats.needsCarrier}
              tone="attention"
            />
            <GapTile
              icon={<AlertTriangle className="h-4 w-4" />}
              label="licences past their expiration date"
              value={stats.expiredLicenses}
              tone="problem"
            />
            <GapTile
              icon={<CalendarClock className="h-4 w-4" />}
              label="licences expiring within 30 days"
              value={stats.expiringLicenses30d}
              tone="attention"
            />
          </div>

          {stats.licensesWithoutExpiration > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {formatCount(stats.licensesWithoutExpiration)} team{" "}
              {stats.licensesWithoutExpiration === 1 ? "licence has" : "licences have"} no
              expiration date on file, so {stats.licensesWithoutExpiration === 1 ? "it is" : "they are"}{" "}
              neither current nor expired as far as AgentFlow can tell.
            </p>
          )}
        </>
      )}
    </ProfileSection>
  );
};
