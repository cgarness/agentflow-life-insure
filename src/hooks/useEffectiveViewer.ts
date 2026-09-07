/**
 * useEffectiveViewer — the shared accessor for "who is looking at this data", composed once.
 *
 * Identity comes from `useAuth().profile`, which `AuthContext` already swaps for the impersonated
 * profile while "View As" is active. It NEVER comes from `useAuth().user`, which always holds the
 * real authenticated Supabase session user — reading that for scope is what silently widens a
 * "View As" session back to the Super Admin.
 *
 * Organization and role come from `useOrganization()`, which is likewise impersonation-aware. The
 * one field it does not expose is an effective viewer id, which is precisely the gap that made
 * pages reach for `user.id`; this hook closes it.
 *
 * `viewer === null` means the identity is NOT yet resolved. Consumers must render a loading state,
 * never an empty result and never an unscoped query.
 */

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { buildEffectiveViewer, effectiveViewerKey, type EffectiveViewer } from "@/lib/effectiveViewer";

export interface UseEffectiveViewerReturn {
  /** The effective viewer, or `null` while unresolved. */
  viewer: EffectiveViewer | null;
  /** True once the viewer is fully resolved. */
  ready: boolean;
  /**
   * Stable identity key for the clear-and-guard pattern. Under "View As" the organization changes
   * IN PLACE with no remount, so consumers derive their reset from this key on the SAME render the
   * identity changes rather than from an effect (which would be one commit too late).
   */
  key: string | null;
}

export function useEffectiveViewer(): UseEffectiveViewerReturn {
  const { profile, isImpersonating } = useAuth();
  const { organizationId, role } = useOrganization();

  const viewer = useMemo(
    () =>
      buildEffectiveViewer({
        viewerId: profile?.id ?? null,
        role: role ?? profile?.role ?? null,
        organizationId: organizationId ?? profile?.organization_id ?? null,
        isImpersonating: isImpersonating === true,
      }),
    [profile?.id, profile?.role, profile?.organization_id, role, organizationId, isImpersonating],
  );

  return useMemo(
    () => ({ viewer, ready: viewer !== null, key: effectiveViewerKey(viewer) }),
    [viewer],
  );
}
