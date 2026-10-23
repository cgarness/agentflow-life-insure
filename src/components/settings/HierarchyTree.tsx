import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildProfileOrgForest,
  countForestNodes,
  isLiveProfileNode,
  pruneDeletedLeaves,
} from "@/lib/profile-org-tree";
import { loadHierarchyTreeData, type HierarchyTreeData } from "@/lib/hierarchy/hierarchyTreeData";
import { VisualOrgNode, type HierarchyChartNode } from "./hierarchy/VisualOrgNode";

/**
 * Settings → User Management → Hierarchy (hierarchy stabilization F4).
 *
 * Query scoping, not authorization — `profiles_select_org` permits same-org reads. The rows
 * come from `loadHierarchyTreeData` and are drawn as loaded, never re-filtered:
 *  - Admin / Super Admin (role or `is_super_admin` on the viewer's PROFILE): the whole
 *    organization, explicit `organization_id` filter, Deleted rows included;
 *  - Team Leader / Agent: their upline chain, themselves and their downline walk only.
 * Deleted members follow the shared Deleted-intermediate rule (`pruneDeletedLeaves`): drawn
 * muted only where someone still reports through them, never counted. Without an organization
 * nothing is queried; a load failure is an error state, never an empty chart.
 */

type LoadState =
  | { key: string; status: "loading" | "error" }
  | { key: string; status: "ready"; data: HierarchyTreeData };

const SCOPE_COPY: Record<HierarchyTreeData["scope"], string> = {
  organization: "Everyone in your organization, grouped under their manager.",
  "reporting-line": "Your full upline chain and everyone in your downline. Peers under the same manager are not shown.",
  none: "",
};

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative z-10 py-16 text-center text-sm text-muted-foreground">{children}</div>
);

const HierarchyTree: React.FC = () => {
  const { profile } = useAuth();
  const organizationId = (useOrganization().organizationId ?? "").trim() || null;
  const viewerId = profile?.id ?? null;
  const role = profile?.role ?? null;
  const isSuperAdmin = profile?.is_super_admin === true;
  const scopeKey = `${viewerId ?? ""}|${organizationId ?? ""}|${role ?? ""}|${isSuperAdmin}`;
  const [state, setState] = useState<LoadState>({ key: "", status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Fail closed: no viewer or no organization → no query at all.
    if (!viewerId || !organizationId) return;
    let cancelled = false;
    setState({ key: scopeKey, status: "loading" });
    loadHierarchyTreeData({ viewerId, organizationId, role, isSuperAdmin })
      .then((data) => { if (!cancelled) setState({ key: scopeKey, status: "ready", data }); })
      .catch((e) => {
        console.error("[HierarchyTree] load failed:", e);
        if (!cancelled) setState({ key: scopeKey, status: "error" });
      });
    return () => { cancelled = true; };
  }, [scopeKey, viewerId, organizationId, role, isSuperAdmin, version]);

  // A previous viewer's or organization's rows are never drawn for the current one.
  const current = state.key === scopeKey ? state : null;
  const data = current?.status === "ready" ? current.data : null;

  const tree = useMemo<HierarchyChartNode[]>(
    () => (data ? pruneDeletedLeaves(buildProfileOrgForest(data.rows), new Set(viewerId ? [viewerId] : [])) : []),
    [data, viewerId],
  );
  const memberCount = useMemo(() => countForestNodes(tree, isLiveProfileNode), [tree]);
  const deletedShown = useMemo(() => countForestNodes(tree) - memberCount, [tree, memberCount]);

  const phase = !viewerId ? "loading" : !organizationId ? "no-organization" : current?.status ?? "loading";

  return (
    <div className="relative overflow-x-auto overflow-y-visible rounded-2xl border border-primary/10 bg-gradient-to-b from-muted/30 via-card to-card p-6 pb-8 shadow-xl shadow-black/[0.03] dark:shadow-black/20">
      <div
        className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.12),transparent_45%),radial-gradient(circle_at_80%_100%,hsl(280_60%_50%/0.08),transparent_40%)] opacity-[0.35] dark:opacity-20"
        aria-hidden
      />

      <div className="relative z-10 mb-6 flex flex-col gap-1 border-b border-border/40 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            <h4 className="text-lg font-semibold tracking-tight">Team structure</h4>
          </div>
          {data && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{SCOPE_COPY[data.scope]}</p>}
          {deletedShown > 0 && (
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Deleted members appear muted only where someone still reports through them.
            </p>
          )}
        </div>
        {data && (
          <p className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {memberCount} member{memberCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {phase === "loading" ? (
        <div className="relative z-10 flex min-h-[200px] items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-label="Loading" />
        </div>
      ) : phase === "no-organization" ? (
        <Notice>Your organization could not be determined, so no team structure is shown.</Notice>
      ) : phase === "error" ? (
        <div role="alert" className="relative z-10 flex flex-col items-center gap-3 py-16 text-center text-sm">
          <p className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            We couldn't load the team structure.
          </p>
          <Button variant="outline" size="sm" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      ) : tree.length === 0 ? (
        <Notice>
          {data?.scope === "organization" ? "No team members in this organization yet." : "No reporting line to show yet."}
        </Notice>
      ) : (
        <div className="relative z-10 space-y-4">
          {data?.scope === "reporting-line" && tree.length > 1 && (
            <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
              Your manager may appear separately if their own manager is not shown on this chart.
            </p>
          )}
          <div className="flex flex-row flex-wrap justify-center gap-16 overflow-visible pb-6 pt-2">
            {tree.map((root) => (
              <VisualOrgNode key={root.id} node={root} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HierarchyTree;
