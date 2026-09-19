/**
 * ReadinessCard — "Am I fully set up to operate? If not, what remains?"
 *
 * Purely presentational. Every check arrives as a `ReadinessCheck` from `computeReadiness`, so when
 * the configurable agency onboarding system lands it replaces the computation and this component
 * keeps working against the same shape.
 *
 * The `unknown` state is not decoration. A check whose prerequisite is missing — a resident-state
 * licence when no resident state is set — is neither passed nor failed, and counting it as a
 * failure would penalise the agent twice for one missing field.
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { Check, CircleDashed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricUnavailable, ProfileSection, ProfileSkeletonBlock } from "./ProfilePrimitives";
import type { ReadinessCheck, ReadinessSummary } from "@/lib/profile/profile-readiness";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<
  ReadinessCheck["state"],
  { icon: React.ReactNode; ring: string; label: string }
> = {
  complete: {
    icon: <Check className="h-3.5 w-3.5" />,
    ring: "border-success/40 bg-success/10 text-success",
    label: "Complete",
  },
  incomplete: {
    icon: <X className="h-3.5 w-3.5" />,
    ring: "border-warning/40 bg-warning/10 text-warning",
    label: "Outstanding",
  },
  // Muted, never green. An absence of evidence is not a pass.
  unknown: {
    icon: <CircleDashed className="h-3.5 w-3.5" />,
    ring: "border-border bg-muted text-muted-foreground",
    label: "Not applicable yet",
  },
};

export interface ReadinessCardProps {
  summary: ReadinessSummary | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export const ReadinessCard: React.FC<ReadinessCardProps> = ({
  summary,
  isLoading,
  error,
  onRetry,
}) => {
  const navigate = useNavigate();

  return (
    <ProfileSection
      title="Business readiness"
      description="What it takes to be fully set up to write business."
      action={
        summary && !error ? (
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {summary.completeCount} of {summary.totalCount} complete
          </span>
        ) : undefined
      }
    >
      {error ? (
        <MetricUnavailable title="Readiness couldn't load" onRetry={onRetry} />
      ) : isLoading || !summary ? (
        <ProfileSkeletonBlock rows={5} />
      ) : (
        <>
          {summary.percent !== null && (
            <div className="mb-5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    summary.isFullyReady ? "bg-success" : "bg-primary",
                  )}
                  style={{ width: `${summary.percent}%` }}
                />
              </div>
            </div>
          )}

          <ul className="divide-y divide-border/60">
            {summary.checks.map((check) => {
              const style = STATE_STYLES[check.state];
              return (
                <li key={check.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      style.ring,
                    )}
                    aria-label={style.label}
                  >
                    {style.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        check.state === "complete" ? "text-foreground" : "text-foreground",
                      )}
                    >
                      {check.label}
                    </p>
                    {check.detail && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {check.detail}
                      </p>
                    )}
                  </div>

                  {check.state !== "complete" && check.actionPath && check.actionLabel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => navigate(check.actionPath as string)}
                    >
                      {check.actionLabel}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ProfileSection>
  );
};
