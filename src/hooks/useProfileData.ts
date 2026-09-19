/**
 * useProfileData — the hooks behind the Agent Profile and Team Profile tabs.
 *
 * Every hook here returns the SAME tri-state shape, because the whole point of this rebuild is that
 * the three states are never conflated:
 *
 *     { isLoading: true,  data: null,  error: null }   the request is in flight
 *     { isLoading: false, data: {...}, error: null }   success — including a truthful zero
 *     { isLoading: false, data: null,  error: Error }  FAILED — render "unavailable", never a 0
 *
 * `src/App.tsx` builds its QueryClient as a bare `new QueryClient()` with NO defaultOptions, so
 * react-query v5's own defaults apply everywhere: `staleTime: 0`, `refetchOnWindowFocus: true`,
 * `retry: 3`. That is how the page this replaces ended up re-running three unbounded table scans on
 * every tab focus. Each query below therefore sets its options EXPLICITLY. `src/App.tsx` is
 * deliberately not modified: changing a global default would silently alter every other surface.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { isOrganizationWideViewer } from "@/lib/effectiveViewer";
import { resolveUserTimeZone } from "@/lib/supabase-dialer-stats";
import {
  fetchOwnLicenses,
  fetchProfileBookStats,
  fetchTeamReadiness,
  fetchTeamRoster,
  type BookStats,
  type ProfileScope,
  type TeamReadinessStats,
  type TeamRoster,
} from "@/lib/profile/profile-queries";
import type { LicenseRow } from "@/components/settings/state-licenses/stateLicenseSchema";

/**
 * Lifetime aggregates do not change while someone reads their profile, so a five-minute stale
 * window and a single retry are generous. Window-focus refetching is off: returning to the tab is
 * not a reason to re-run an aggregate over a whole book of business.
 */
const PROFILE_QUERY_OPTIONS = {
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
  retry: 1,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function toAsyncState<T>(query: {
  data: T | undefined;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
}, enabled: boolean): AsyncState<T> {
  return {
    data: query.data ?? null,
    // While the identity is unresolved the surface is LOADING, never empty: an unscoped or
    // not-yet-scoped read must not be allowed to render as "no data".
    isLoading: !enabled || query.isPending,
    error: query.error ? (query.error as Error) : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** The lifetime book of business for one scope. `"self"` on the Agent tab, `"team"` on the Team tab. */
export function useProfileBookStats(scope: ProfileScope, enabled = true): AsyncState<BookStats> {
  const { viewer, ready } = useEffectiveViewer();
  // Captured once per mount so the query key cannot churn if the zone is recomputed.
  const timeZone = useMemo(() => resolveUserTimeZone(), []);

  const isEnabled = enabled && ready && !!viewer;

  const query = useQuery({
    queryKey: ["profile-book-stats", viewer?.viewerId ?? null, viewer?.organizationId ?? null, scope, timeZone],
    enabled: isEnabled,
    queryFn: () => fetchProfileBookStats(scope, timeZone),
    ...PROFILE_QUERY_OPTIONS,
  });

  return toAsyncState(query, isEnabled);
}

/** Team readiness and licence coverage. Counts only. */
export function useTeamReadiness(enabled = true): AsyncState<TeamReadinessStats> {
  const { viewer, ready } = useEffectiveViewer();
  const isEnabled = enabled && ready && !!viewer;

  const query = useQuery({
    queryKey: ["profile-team-readiness", viewer?.viewerId ?? null, viewer?.organizationId ?? null],
    enabled: isEnabled,
    queryFn: () => fetchTeamReadiness(),
    ...PROFILE_QUERY_OPTIONS,
  });

  return toAsyncState(query, isEnabled);
}

/**
 * The downline roster used by the preview card and the full organization tree.
 *
 * This resolves scope through `getAgentScopeIds`, which is STRICTLY SEQUENTIAL — rounds x batches x
 * pages, one network round trip each — so a deep organization takes a visible moment. It is
 * deliberately gated on `enabled`, which the page sets only when the Team tab is actually showing,
 * so the Agent Profile tab never waits on it.
 */
export function useTeamRoster(enabled = true): AsyncState<TeamRoster> {
  const { viewer, ready } = useEffectiveViewer();
  const isEnabled = enabled && ready && !!viewer?.viewerId && !!viewer?.organizationId;

  const query = useQuery({
    queryKey: ["profile-team-roster", viewer?.viewerId ?? null, viewer?.organizationId ?? null],
    enabled: isEnabled,
    queryFn: () => fetchTeamRoster(viewer!.viewerId, viewer!.organizationId!),
    ...PROFILE_QUERY_OPTIONS,
  });

  return toAsyncState(query, isEnabled);
}

/** The signed-in agent's own state licences — the canonical source, never profiles.licensed_states. */
export function useOwnLicenses(enabled = true): AsyncState<LicenseRow[]> {
  const { viewer, ready } = useEffectiveViewer();
  const isEnabled = enabled && ready && !!viewer?.viewerId && !!viewer?.organizationId;

  const query = useQuery({
    queryKey: ["profile-own-licenses", viewer?.viewerId ?? null, viewer?.organizationId ?? null],
    enabled: isEnabled,
    queryFn: () => fetchOwnLicenses(viewer!.viewerId, viewer!.organizationId!),
    ...PROFILE_QUERY_OPTIONS,
  });

  return toAsyncState(query, isEnabled);
}

/**
 * Is this viewer an organization-wide viewer?
 *
 * Gated on `isOrganizationWideViewer`, NEVER on `useOrganization().isSuperAdmin`, which is
 * `isSuperAdmin || isImpersonating` (src/hooks/useOrganization.ts:94) and would therefore widen a
 * "View As" session of an Agent back to the whole organization.
 */
export function useIsOrganizationWideViewer(): boolean {
  const { viewer } = useEffectiveViewer();
  return isOrganizationWideViewer(viewer);
}
