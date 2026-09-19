/**
 * TeamDownlinePreview — the COMPACT view of the organization, on the Team Profile page itself.
 *
 * Intentionally shallow: the viewer at the top, their DIRECT reports below, and a descendant count
 * on each so the size of each branch is visible without expanding it. The full organization opens
 * in a dialog, so the page never mounts hundreds of cards to render a summary.
 *
 * Avatars are initials. `avatar_url` holds a base64 data URL, so a roster of even twenty agents
 * would pull megabytes into the browser to draw twenty circles.
 */

import React from "react";
import { Network, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MetricUnavailable,
  ProfileEmptyState,
  ProfileSection,
  ProfileSkeletonBlock,
} from "../ProfilePrimitives";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import { displayNameFor, initialsFor, type OrgTreeView } from "@/lib/profile/profile-org-view";

const AgentCard: React.FC<{
  name: string;
  initials: string;
  role: string;
  descendantCount: number;
  emphasis?: boolean;
}> = ({ name, initials, role, descendantCount, emphasis = false }) => (
  <div
    className={
      emphasis
        ? "flex w-full max-w-[220px] flex-col items-center rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center"
        : "flex w-full max-w-[200px] flex-col items-center rounded-xl border border-border/60 bg-card px-4 py-3 text-center transition-colors hover:border-primary/30"
    }
  >
    <div
      className={
        emphasis
          ? "flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-sm font-semibold text-primary"
          : "flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground"
      }
    >
      {initials}
    </div>
    <p className="mt-2 w-full truncate text-sm font-medium text-foreground">{name}</p>
    <p className="w-full truncate text-xs text-muted-foreground">{role}</p>
    {descendantCount > 0 && (
      <span className="mt-2 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        +{formatCount(descendantCount)} {descendantCount === 1 ? "agent" : "agents"}
      </span>
    )}
  </div>
);

export interface TeamDownlinePreviewProps {
  view: OrgTreeView | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onOpenFullTree: () => void;
  /** Depth from the readiness RPC; the view's own depth is used when it is unavailable. */
  maxDepth: number | null;
}

/** How many direct reports appear in the compact preview before the rest roll into a summary chip. */
const PREVIEW_LIMIT = 8;

export const TeamDownlinePreview: React.FC<TeamDownlinePreviewProps> = ({
  view,
  isLoading,
  error,
  onRetry,
  onOpenFullTree,
  maxDepth,
}) => {
  const shown = view?.directReports.slice(0, PREVIEW_LIMIT) ?? [];
  const hidden = Math.max(0, (view?.directReports.length ?? 0) - shown.length);

  return (
    <ProfileSection
      title="Organization"
      description="The team built beneath you."
      action={
        view?.root && view.totalDownline > 0 ? (
          <Button variant="outline" size="sm" onClick={onOpenFullTree}>
            <Network className="mr-1.5 h-3.5 w-3.5" />
            View full organization
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <MetricUnavailable title="Organization couldn't load" onRetry={onRetry} />
      ) : isLoading || !view ? (
        <ProfileSkeletonBlock rows={3} />
      ) : !view.root ? (
        <ProfileEmptyState
          icon={<Users className="h-6 w-6" />}
          title="Your profile isn't in the team roster"
          description="This usually means your account has no organization set. Contact an administrator."
        />
      ) : view.directReports.length === 0 ? (
        <ProfileEmptyState
          icon={<Users className="h-6 w-6" />}
          title="No direct reports yet"
          description="Agents appear here once they are placed beneath you in the hierarchy."
        />
      ) : (
        <>
          <div className="flex flex-col items-center">
            <AgentCard
              emphasis
              name={displayNameFor(view.root)}
              initials={initialsFor(view.root)}
              role={view.root.role}
              descendantCount={view.totalDownline}
            />

            {/* The connector. Purely structural, drawn with border tokens so it reads in both themes. */}
            <div className="h-6 w-px bg-border" aria-hidden />
            <div className="mb-6 h-px w-full max-w-3xl bg-border" aria-hidden />

            <div className="flex flex-wrap items-start justify-center gap-4">
              {shown.map((child) => (
                <AgentCard
                  key={child.id}
                  name={displayNameFor(child)}
                  initials={initialsFor(child)}
                  role={child.role}
                  descendantCount={child.descendantCount}
                />
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={onOpenFullTree}
                  className="flex h-full min-h-[116px] w-full max-w-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-center transition-colors hover:border-primary/40"
                >
                  <span className="text-sm font-medium text-foreground">
                    +{formatCount(hidden)} more
                  </span>
                  <span className="mt-0.5 text-xs text-muted-foreground">direct reports</span>
                </button>
              )}
            </div>
          </div>

          <div className="mt-8 grid gap-3 border-t border-border/60 pt-5 sm:grid-cols-3">
            <div>
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatCount(view.directReports.length)}
              </p>
              <p className="text-xs text-muted-foreground">Direct reports</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatCount(view.totalDownline)}
              </p>
              <p className="text-xs text-muted-foreground">Total downline (excludes you)</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatCount(maxDepth ?? view.maxDepth)}
              </p>
              <p className="text-xs text-muted-foreground">Levels deep</p>
            </div>
          </div>

          {view.unattached.length > 0 && (
            /* Surfaced, never dropped. These are authorized agents whose branch could not be
               attached — a missing upline row or a cycle the builder broke. */
            <p className="mt-4 text-xs leading-relaxed text-warning">
              {formatCount(view.unattached.length)}{" "}
              {view.unattached.length === 1 ? "agent is" : "agents are"} in your team but could not
              be placed in the chart, usually because of a gap in the reporting line.
            </p>
          )}
        </>
      )}
    </ProfileSection>
  );
};
