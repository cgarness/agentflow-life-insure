import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { filterCampaignsForManagement, type CampaignManagementRole } from "@/lib/campaign-assignee-scope";
import { getCampaignCardStats, type CampaignCardStats } from "@/lib/campaign-card-stats";
import type { AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";
import { collectAssigneeIds, idsHash, type CampaignRow, type StatsView } from "@/lib/campaigns-table/model";
import {
  CAMPAIGNS_TABLE_QUERY_OPTIONS,
  CampaignsQueryError,
  fetchAssigneeProfiles,
  fetchCampaignLastDialed,
  fetchCampaignRows,
  fetchCreateModalAgents,
  fetchOrgStatus,
  type CreateModalAgent,
} from "@/lib/campaigns-table/queries";

export const CAMPAIGNS_TABLE_QUERY_ROOT = "campaignsTable";

interface Args {
  orgId: string | null;
  userId: string | null;
  /** Permissions resolved (PageGuard already waits; kept as defense in depth). */
  ready: boolean;
  management: CampaignManagementRole;
  leadership: boolean;
  canCreate: boolean;
}

export type LoadStatus = "loading" | "error" | "ready";
const EMPTY_ROWS: CampaignRow[] = [];
const EMPTY_AGENTS: CreateModalAgent[] = [];

/** Keys carry org + user so another identity's cache entry can never satisfy this viewer. */
function sameOwner(query: Query | undefined, orgId: string | null, userId: string | null): boolean {
  return !!query && query.queryKey[2] === orgId && query.queryKey[3] === userId;
}

export function useCampaignsTableData({ orgId, userId, ready, management, leadership, canCreate }: Args) {
  const queryClient = useQueryClient();
  const enabled = ready && !!orgId && !!userId;

  const listQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "list", orgId, userId],
    enabled,
    queryFn: ({ signal }) => {
      if (!orgId) throw new CampaignsQueryError("failed");
      return fetchCampaignRows(orgId, signal);
    },
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const rows = listQ.data ?? EMPTY_ROWS;
  // Management scope is applied at render with the CURRENT role inputs, never cached.
  const visibleRows = useMemo(
    () => (userId ? filterCampaignsForManagement(rows, userId, management) : EMPTY_ROWS),
    [rows, userId, management],
  );
  const visibleIds = useMemo(() => visibleRows.map((r) => r.id).sort(), [visibleRows]);
  const visibleHash = useMemo(() => idsHash(visibleIds), [visibleIds]);

  const statsQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "stats", orgId, userId, visibleHash],
    enabled: enabled && visibleIds.length > 0,
    queryFn: ({ signal }) => getCampaignCardStats(visibleIds, { signal }),
    placeholderData: (prev: Record<string, CampaignCardStats> | undefined, prevQuery) =>
      sameOwner(prevQuery as Query | undefined, orgId, userId) ? prev : undefined,
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const lastDialedQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "lastDialed", orgId, userId],
    enabled,
    queryFn: ({ signal }) => fetchCampaignLastDialed(signal),
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const assigneeIds = useMemo(() => (leadership ? collectAssigneeIds(visibleRows) : []), [leadership, visibleRows]);
  const assigneeHash = useMemo(() => idsHash(assigneeIds), [assigneeIds]);
  const assigneesQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "assignees", orgId, userId, assigneeHash],
    enabled: enabled && leadership && assigneeIds.length > 0,
    queryFn: ({ signal }) => fetchAssigneeProfiles(orgId!, assigneeIds, signal),
    placeholderData: (prev: AssigneeProfileMap | undefined, prevQuery) =>
      sameOwner(prevQuery as Query | undefined, orgId, userId) ? prev : undefined,
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const agentsQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "createAgents", orgId, userId],
    enabled: enabled && canCreate,
    queryFn: ({ signal }) => fetchCreateModalAgents(orgId!, signal),
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const orgStatusQ = useQuery({
    queryKey: [CAMPAIGNS_TABLE_QUERY_ROOT, "orgStatus", orgId, userId],
    enabled,
    queryFn: ({ signal }) => fetchOrgStatus(orgId!, signal),
    ...CAMPAIGNS_TABLE_QUERY_OPTIONS,
  });

  const listStatus: LoadStatus = listQ.data ? "ready"
    : !enabled ? (ready ? "error" : "loading")
      : listQ.isError ? "error" : "loading";
  const listTooLarge = listQ.error instanceof CampaignsQueryError && listQ.error.kind === "too_large";

  const statsData = statsQ.data;
  const statsPlaceholder = statsQ.isPlaceholderData;
  const statsFailed = statsQ.isError;
  const noVisible = visibleIds.length === 0;
  const stats = useMemo<StatsView>(() => (
    statsData && !statsPlaceholder ? { status: "ready", map: statsData }
      : statsPlaceholder ? { status: "loading", map: statsData ?? {} }
        : statsFailed ? { status: "error", map: {} }
          : noVisible ? { status: "ready", map: {} } : { status: "loading", map: {} }
  ), [statsData, statsPlaceholder, statsFailed, noVisible]);

  const lastDialedStatus: LoadStatus = lastDialedQ.data ? "ready" : lastDialedQ.isError ? "error" : "loading";
  const assigneesStatus: LoadStatus = assigneesQ.data && !assigneesQ.isPlaceholderData ? "ready"
    : assigneesQ.isError && !assigneesQ.data ? "error"
      : assigneeIds.length === 0 ? "ready" : "loading";

  const refreshAfterMutation = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === CAMPAIGNS_TABLE_QUERY_ROOT && q.queryKey[2] === orgId && q.queryKey[3] === userId
        && (q.queryKey[1] === "list" || q.queryKey[1] === "stats" || q.queryKey[1] === "lastDialed"),
    });
  }, [queryClient, orgId, userId]);

  return {
    list: {
      status: listStatus,
      rows: visibleRows,
      tooLarge: listTooLarge,
      refreshFailed: listQ.isRefetchError,
      /** False when the identity has no organization: nothing to retry. */
      retryable: enabled,
      retry: () => { if (enabled) void listQ.refetch(); },
    },
    stats,
    statsRefreshFailed: statsQ.isRefetchError,
    retryStats: () => void statsQ.refetch(),
    lastDialed: { status: lastDialedStatus, map: lastDialedQ.data ?? null, retry: () => void lastDialedQ.refetch() },
    /** Clock for relative "last dialed" copy: the moment that data was fetched. */
    lastDialedAsOf: lastDialedQ.dataUpdatedAt,
    // Identities render only for a CURRENT leadership viewer, whatever the cache holds.
    assignees: leadership ? { status: assigneesStatus, map: assigneesQ.data ?? {} } : null,
    createAgents: { agents: agentsQ.data ?? EMPTY_AGENTS, loading: agentsQ.isPending && enabled && canCreate },
    orgLocked: (orgStatusQ.data ?? "active") !== "active",
    refreshAfterMutation,
  };
}
