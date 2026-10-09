import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePermissions } from "@/hooks/usePermissions";
import { useBranding } from "@/contexts/BrandingContext";
import { useMinWidth } from "@/hooks/useMinWidth";
import { useCampaignsTableData } from "@/hooks/useCampaignsTableData";
import { useCampaignsTablePrefs } from "@/hooks/useCampaignsTablePrefs";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CreateCampaignModal } from "@/components/campaigns/CreateCampaignModal";
import { visibleColumns } from "@/lib/campaigns-table/columns";
import {
  DEFAULT_FILTERS, DEFAULT_SORT, defaultDirFor, duplicateEligibility, filterCampaigns, isDefaultView,
  isLeadershipViewer, resolveCampaignMetrics, sortCampaigns,
  type CampaignFilters, type CampaignRow, type CampaignSort, type SortKey,
} from "@/lib/campaigns-table/model";
import CampaignsToolbar from "./CampaignsToolbar";
import CampaignColumnsMenu from "./CampaignColumnsMenu";
import CampaignsTable from "./CampaignsTable";
import CampaignStackedList from "./CampaignStackedList";
import DuplicateCampaignDialog from "./DuplicateCampaignDialog";
import {
  CampaignsEmpty, CampaignsFilteredEmpty, CampaignsLoadError, CampaignsNotice, CampaignsSkeleton,
} from "./CampaignsListStates";

const RENDER_STEP = 100;
const DESKTOP_MIN_WIDTH = 1280;

/** Body of the Campaigns page. Mounted under a `${userId}:${orgId}` key, so all local state is per identity. */
export default function CampaignsPageContent() {
  const navigate = useNavigate();
  const { user, profile, isImpersonating } = useAuth();
  const { organizationId } = useOrganization();
  const { getDataScope, hasFeatureAccess, isLoading: permissionsLoading } = usePermissions();
  const { formatDate } = useBranding();
  const desktop = useMinWidth(DESKTOP_MIN_WIDTH);
  const userId = user?.id ?? null;

  // MANAGEMENT scope only (unchanged inputs). Never reused for Dialer access.
  const viewAll = Boolean(profile?.is_super_admin) || getDataScope("campaigns") === "all" || hasFeatureAccess("View All Campaigns");
  const management = useMemo(
    () => ({ isAdmin: profile?.role === "Admin", isSuperAdmin: Boolean(profile?.is_super_admin), viewAll }),
    [profile?.role, profile?.is_super_admin, viewAll],
  );
  const leadership = isLeadershipViewer(profile);
  const canCreate = !permissionsLoading && hasFeatureAccess("Create Campaigns");

  const data = useCampaignsTableData({
    orgId: organizationId, userId, ready: !permissionsLoading, management, leadership, canCreate,
  });
  const prefs = useCampaignsTablePrefs(userId, organizationId, !isImpersonating);

  const [filters, setFilters] = useState<CampaignFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<CampaignSort>(DEFAULT_SORT);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(RENDER_STEP);
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<CampaignRow | null>(null);
  const nowMs = data.lastDialedAsOf;

  const rows = data.list.rows;
  const metricsById = useMemo(() => {
    const out: Record<string, ReturnType<typeof resolveCampaignMetrics>> = {};
    for (const r of rows) out[r.id] = resolveCampaignMetrics(r, data.stats);
    return out;
  }, [rows, data.stats]);
  const filtered = useMemo(() => filterCampaigns(rows, filters), [rows, filters]);
  const sorted = useMemo(
    () => sortCampaigns(filtered, sort, { metrics: metricsById, lastDialed: data.lastDialed.map }),
    [filtered, sort, metricsById, data.lastDialed.map],
  );
  const shown = sorted.slice(0, limit);

  const updateFilters = (next: CampaignFilters) => { setFilters(next); setLimit(RENDER_STEP); };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDirFor(key) }));
  const resetView = () => { setFilters(DEFAULT_FILTERS); setSort(DEFAULT_SORT); setLimit(RENDER_STEP); };
  const openCreate = () => { if (!data.orgLocked) setCreateOpen(true); };
  const newCampaignButton = (
    <PermissionGate feature="Create Campaigns">
      <Button type="button" onClick={openCreate} disabled={data.orgLocked} className="h-9 gap-2 rounded-lg"
        title={data.orgLocked ? "This agency is suspended/archived. Reactivate to create campaigns." : undefined}>
        <Plus className="h-4 w-4" aria-hidden="true" />New Campaign
      </Button>
    </PermissionGate>
  );

  const rowProps = {
    rows: shown, metricsById, expandedId, onToggle: (id: string) => setExpandedId((cur) => (cur === id ? null : id)),
    duplicateFor: (r: CampaignRow) => duplicateEligibility(profile?.role, r, userId),
    orgLocked: data.orgLocked, lastDialed: data.lastDialed, assignees: data.assignees, nowMs, formatDate,
    onOpen: (id: string) => navigate(`/campaigns/${id}`), onDuplicate: (r: CampaignRow) => setDuplicateTarget(r),
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          {data.list.status === "ready" && (
            <span className="text-sm tabular-nums text-muted-foreground" aria-label={`${rows.length} campaigns`}>{rows.length}</span>
          )}
        </div>
        {newCampaignButton}
      </header>

      <CampaignsToolbar filters={filters} onFiltersChange={updateFilters} sort={sort}
        onSortKey={(key) => setSort({ key, dir: defaultDirFor(key) })}
        onToggleDir={() => setSort((s) => ({ ...s, dir: s.dir === "asc" ? "desc" : "asc" }))}
        showReset={!isDefaultView(filters, sort)} onReset={resetView}
        columnsControl={desktop ? <CampaignColumnsMenu prefs={prefs} /> : null} />

      {data.list.refreshFailed && <CampaignsNotice onRetry={data.list.retry}>Couldn't refresh campaigns.</CampaignsNotice>}
      {data.stats.status === "error" && <CampaignsNotice onRetry={data.retryStats}>Metrics unavailable.</CampaignsNotice>}
      {data.statsRefreshFailed && <CampaignsNotice onRetry={data.retryStats}>Couldn't refresh metrics.</CampaignsNotice>}

      {data.list.status === "loading" ? (
        <CampaignsSkeleton />
      ) : data.list.status === "error" ? (
        <CampaignsLoadError tooLarge={data.list.tooLarge} retryable={data.list.retryable} onRetry={data.list.retry} />
      ) : rows.length === 0 ? (
        <CampaignsEmpty action={newCampaignButton} />
      ) : sorted.length === 0 ? (
        <CampaignsFilteredEmpty onReset={resetView} />
      ) : desktop ? (
        <CampaignsTable {...rowProps} columns={visibleColumns(prefs.layout)} sort={sort} onSort={sortBy} />
      ) : (
        <CampaignStackedList {...rowProps} />
      )}

      {sorted.length > shown.length && (
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>Showing {shown.length} of {sorted.length}</span>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setLimit((l) => l + RENDER_STEP)}>
            Show more
          </Button>
        </div>
      )}

      <CreateCampaignModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={data.refreshAfterMutation}
        agents={data.createAgents.agents} agentsLoading={data.createAgents.loading} />
      <DuplicateCampaignDialog campaign={duplicateTarget} orgLocked={data.orgLocked}
        onClose={() => setDuplicateTarget(null)} onDuplicated={data.refreshAfterMutation} />
    </div>
  );
}
