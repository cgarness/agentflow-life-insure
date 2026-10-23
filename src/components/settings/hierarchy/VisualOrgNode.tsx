/**
 * Presentational org-chart node for Settings → Hierarchy (moved out of `HierarchyTree.tsx`,
 * hierarchy stabilization F4). Renders one profile card and, recursively, everyone attached
 * beneath it. No data access: nodes come from `buildProfileOrgForest` over the query-scoped
 * rows of `loadHierarchyTreeData`, after `pruneDeletedLeaves`.
 *
 * A Deleted node only reaches this component as a connector (someone who is not Deleted
 * reports beneath it), so it is drawn muted and labelled "Deleted" rather than as a member.
 */
import React from "react";
import { Crown, Shield, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isDeletedProfile, type ProfileOrgNode } from "@/lib/profile-org-tree";
import type { HierarchyTreeRow } from "@/lib/hierarchy/hierarchyTreeData";

export type HierarchyChartNode = ProfileOrgNode<HierarchyTreeRow>;

function initials(node: HierarchyChartNode): string {
  const a = (node.first_name || "").trim().charAt(0);
  const b = (node.last_name || "").trim().charAt(0);
  if (a && b) return `${a}${b}`.toUpperCase();
  if (a) return a.toUpperCase();
  const e = (node.email || "?").charAt(0).toUpperCase();
  return e || "?";
}

function displayName(node: HierarchyChartNode): string {
  const n = [node.first_name, node.last_name].filter(Boolean).join(" ").trim();
  return n || node.email || "Unknown";
}

const MemberAvatar: React.FC<{ node: HierarchyChartNode; muted: boolean }> = ({ node, muted }) => {
  const url = (node.avatar_url || "").trim();
  return (
    <div
      className={cn(
        "relative mx-auto flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold shadow-inner ring-2",
        muted
          ? "bg-muted text-muted-foreground ring-border grayscale"
          : "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground ring-primary/30",
      )}
    >
      {url ? (
        <img src={url} alt={displayName(node)} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initials(node)}</span>
      )}
    </div>
  );
};

const RoleBadge: React.FC<{ role: string | null }> = ({ role }) => {
  const r = (role || "Agent").toLowerCase();
  if (r === "admin") {
    return (
      <Badge className="mt-2 border border-sky-400/40 bg-sky-500/15 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.25)] gap-1 font-medium tracking-wide">
        <Crown className="h-3 w-3" />
        {role}
      </Badge>
    );
  }
  if (r === "team leader") {
    return (
      <Badge className="mt-2 border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)] gap-1 font-medium tracking-wide">
        <Shield className="h-3 w-3" />
        {role}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="mt-2 border border-border/60 bg-muted/40 gap-1 font-medium">
      <User className="h-3 w-3" />
      {role || "Agent"}
    </Badge>
  );
};

/** SVG T-junction: horizontal bar at top + one drop per child to bottom of connector zone. */
function OrgBranchSvg({ childCount }: { childCount: number }) {
  if (childCount < 2) return null;
  const centers = Array.from({ length: childCount }, (_, i) => ((i + 0.5) / childCount) * 100);
  const d = [
    `M ${centers[0]} 0 L ${centers[childCount - 1]} 0`,
    ...centers.map((cx) => `M ${cx} 0 L ${cx} 100`),
  ].join(" ");
  return (
    <svg
      className="pointer-events-none block h-full w-full overflow-visible text-primary/20"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinecap="square" />
    </svg>
  );
}

const NodeCard: React.FC<{ node: HierarchyChartNode }> = ({ node }) => {
  const deleted = isDeletedProfile(node);
  const name = displayName(node);
  return (
    <div className="relative overflow-visible">
      {!deleted && (
        <div
          className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/35 via-cyan-500/15 to-violet-500/20 opacity-70 blur-md"
          aria-hidden
        />
      )}
      <div
        className={cn(
          "relative rounded-2xl border px-5 py-4 text-center min-w-[168px] max-w-[220px]",
          deleted
            ? "border-dashed border-border bg-muted/40 opacity-70"
            : "border-primary/20 bg-card/90 shadow-lg shadow-primary/5 backdrop-blur-sm",
        )}
        title={deleted ? "Deleted member, shown because people still report through them" : undefined}
      >
        <MemberAvatar node={node} muted={deleted} />
        <p
          className={cn(
            "mt-2.5 truncate text-sm font-semibold tracking-tight",
            deleted ? "text-muted-foreground" : "text-foreground",
          )}
          title={name}
        >
          {name}
        </p>
        {deleted ? (
          <Badge variant="outline" className="mt-2 border-dashed font-medium text-muted-foreground">
            Deleted{node.role ? ` · ${node.role}` : ""}
          </Badge>
        ) : (
          <RoleBadge role={node.role} />
        )}
      </div>
    </div>
  );
};

/** Top-down org node: stem + SVG fork (multi-child) so lines aren’t clipped or mis-measured. */
export const VisualOrgNode: React.FC<{ node: HierarchyChartNode }> = ({ node }) => {
  const n = node.children.length;

  return (
    <div className="flex min-w-0 flex-col items-center overflow-visible" data-testid={`hierarchy-node-${node.id}`}>
      <NodeCard node={node} />

      {n > 0 && (
        <div className="relative mt-0 flex min-w-0 flex-col items-center overflow-visible">
          <div className="h-6 w-px shrink-0 bg-primary/20" aria-hidden />

          <div className="relative inline-flex max-w-full flex-col items-center overflow-visible">
            <div
              className={`relative z-10 flex w-max max-w-full flex-row flex-wrap justify-center gap-x-12 gap-y-16 ${n > 1 ? "pt-8" : "pt-0"}`}
            >
              {node.children.map((child) => (
                <div key={child.id} className="relative flex min-w-[168px] flex-col items-center overflow-visible">
                  {n === 1 && <div className="h-6 w-px shrink-0 bg-primary/20" aria-hidden />}
                  <VisualOrgNode node={child} />
                </div>
              ))}
            </div>
            {n > 1 && (
              <div className="pointer-events-none absolute top-0 left-0 right-0 h-8 z-0 overflow-visible">
                <OrgBranchSvg childCount={n} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
