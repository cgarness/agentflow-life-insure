import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useCommissionCalculatorContext } from "@/hooks/useCommissionCalculator";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { usePermissions } from "@/hooks/usePermissions";
import { isOrganizationWideViewer } from "@/lib/effectiveViewer";
import {
  agentDisplayName,
  NO_ASSIGNED_AGENT_MESSAGE,
  OTHERS_COMMISSION_PERMISSION,
  OWN_COMMISSION_PERMISSION,
  PREVIEW_UNAVAILABLE_MESSAGE,
  previewAccess,
  resolveCreditedLevel,
  type CreditedLevel,
  type PreviewAccess,
} from "@/lib/commission/policyPreview";
import { fetchCreditedAgentProfile, fetchCreditedOwner, fetchTeamScopeAgentIds } from "@/lib/commission/previewApi";
import type { ReadyCalculatorContext } from "@/lib/commission/types";

/**
 * Who the sale would credit: the signed-in user (a new manual client) or the STORED owner of a lead or
 * client, which is what the sale writers credit. `hint` is the caller's own view of the lead owner; it
 * only refreshes the read when it changes (e.g. a claim while the modal is open) and is never trusted.
 */
export type PreviewOwner = { kind: "self" } | { kind: "lead"; id: string; hint?: string | null } | { kind: "client"; id: string };

/** `identity` changes with the viewer and permission set; the panel starts over when it does. */
export type PolicyCommissionPreview =
  | { status: "hidden"; identity: string }
  | { status: "unavailable"; identity: string; message: string }
  | { status: "ready"; identity: string; context: ReadyCalculatorContext; level: CreditedLevel; agentName: string | null };

const STALE_MS = 60_000;
/**
 * The credited owner can be reassigned at any time, so it is never served from cache: it is re-read on
 * every mount (an owner cached by an earlier open is ignored until the fresh read returns), re-checked
 * while the panel stays open, on window focus, and every OWNER_RECHECK_MS. A failed re-check hides the
 * figures. The grid, Team scope and profile reads keep their shared cache (keyed per agent).
 */
export const OWNER_RECHECK_MS = 15_000;

export const policyCommissionPreviewKeys = {
  owner: (userId: string | null, orgId: string | null, kind: string | null, id: string | null, hint: string | null) =>
    ["commission-preview", "owner", userId, orgId, kind, id, hint] as const,
  teamScope: (userId: string | null, orgId: string | null) => ["commission-preview", "team-scope", userId, orgId] as const,
  agent: (userId: string | null, orgId: string | null, agentId: string | null) =>
    ["commission-preview", "agent", userId, orgId, agentId] as const,
};

/**
 * Fails closed: nothing is requested under "View As" or without a commission permission, and any
 * unresolved viewer, permission, owner, scope or profile read yields no figures.
 */
export function usePolicyCommissionPreview(owner: PreviewOwner | null): PolicyCommissionPreview {
  const { user, isImpersonating } = useAuth();
  const { viewer, key } = useEffectiveViewer();
  const { canSeeCommission, isLoading: permissionsLoading, error: permissionsError } = usePermissions();

  const userId = user?.id ?? null;
  const orgId = viewer?.organizationId ?? null;
  const signedIn = !!owner && !!viewer && !!userId && !isImpersonating && !viewer.isImpersonating && viewer.viewerId === userId;
  const permissionsReady = signedIn && !permissionsLoading && !permissionsError;
  const canSeeOwn = permissionsReady && canSeeCommission(OWN_COMMISSION_PERMISSION);
  const canSeeOthers = permissionsReady && canSeeCommission(OTHERS_COMMISSION_PERMISSION);
  const anyPermission = canSeeOwn || canSeeOthers;
  const identity = `${key ?? "none"}|${canSeeOwn ? 1 : 0}|${canSeeOthers ? 1 : 0}`;

  const context = useCommissionCalculatorContext(anyPermission);

  const [mountedAt] = useState(() => Date.now());
  const source = owner && owner.kind !== "self" ? owner : null;
  const hint = source?.kind === "lead" ? source.hint ?? null : null;
  const ownerQuery = useQuery({
    queryKey: policyCommissionPreviewKeys.owner(userId, orgId, source?.kind ?? null, source?.id ?? null, hint),
    queryFn: () => fetchCreditedOwner({ kind: source!.kind, id: source!.id }, orgId!),
    enabled: anyPermission && !!source && !!orgId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: OWNER_RECHECK_MS,
    retry: false,
  });
  const ownerVerified = ownerQuery.isSuccess && ownerQuery.dataUpdatedAt >= mountedAt;
  const creditedAgentId = owner?.kind === "self" ? userId : ownerVerified ? ownerQuery.data : null;

  const access: PreviewAccess =
    anyPermission && userId && creditedAgentId
      ? previewAccess({
          operatorId: userId,
          creditedAgentId,
          role: viewer!.role,
          organizationWide: isOrganizationWideViewer(viewer),
          canSeeOwn,
          canSeeOthers,
        })
      : { kind: "denied" };
  const needsTeamScope = access.kind === "other" && access.needsTeamScope;
  const teamQuery = useQuery({
    queryKey: policyCommissionPreviewKeys.teamScope(userId, orgId),
    queryFn: fetchTeamScopeAgentIds,
    enabled: needsTeamScope,
    staleTime: STALE_MS,
    retry: false,
  });
  const inScope = access.kind === "other" && (!needsTeamScope || (teamQuery.isSuccess && teamQuery.data.includes(creditedAgentId!)));
  const agentQuery = useQuery({
    queryKey: policyCommissionPreviewKeys.agent(userId, orgId, creditedAgentId),
    queryFn: () => fetchCreditedAgentProfile(creditedAgentId!, orgId!),
    enabled: inScope && !!orgId,
    staleTime: STALE_MS,
    retry: false,
  });

  const hidden: PolicyCommissionPreview = { status: "hidden", identity };
  const unavailable = (message = PREVIEW_UNAVAILABLE_MESSAGE): PolicyCommissionPreview => ({ status: "unavailable", identity, message });

  if (!anyPermission) return hidden;
  if (!context.data) return context.isError ? unavailable() : hidden;
  if (context.data.status !== "ready") return hidden;
  const grid = context.data;
  if (source) {
    if (ownerQuery.isError) return unavailable();
    if (!ownerVerified) return hidden;
    if (ownerQuery.data === null) return unavailable(NO_ASSIGNED_AGENT_MESSAGE);
  }
  if (access.kind === "denied" || !creditedAgentId) return hidden;
  if (access.kind === "own") {
    const level = resolveCreditedLevel(grid.commissionLevel, grid.grid.contractLevels, true);
    return { status: "ready", identity, context: grid, level, agentName: null };
  }
  if (needsTeamScope) {
    if (teamQuery.isError) return unavailable();
    if (!teamQuery.isSuccess || !inScope) return hidden;
  }
  if (agentQuery.isError) return unavailable();
  if (!agentQuery.isSuccess) return hidden;
  const profile = agentQuery.data;
  const agentName = profile && profile.id === creditedAgentId ? agentDisplayName(profile) : null;
  if (!profile || !agentName) return unavailable();
  const level = resolveCreditedLevel(profile.commissionLevel, grid.grid.contractLevels, false);
  return { status: "ready", identity, context: grid, level, agentName };
}

/** Preview-only inputs: never required to save, never persisted, never part of a sale payload. */
export interface PreviewSelection {
  productId: string;
  term: string;
  /** null = untouched, so the panel shows the (valid-only) prefill. */
  age: string | null;
}

const EMPTY_SELECTION: PreviewSelection = { productId: "", term: "", age: null };

/**
 * Resets are derived on the render where the scope changes, never one commit later: a new viewer or
 * permission set (`identity`) or a different grid starts over. A product the current policy type,
 * carrier or grid revision no longer offers — or a term it no longer supports — is cleared, never
 * resurrected. Inputs survive while the panel is temporarily hidden (e.g. a refetch).
 */
export function usePreviewSelection(
  identity: string,
  gridId: string | null,
  productIds: string[] | null,
  termsFor: (productId: string) => number[],
) {
  const [state, setState] = useState({ identity, gridId, selection: EMPTY_SELECTION });
  let next = state;
  if (next.identity !== identity) next = { identity, gridId, selection: EMPTY_SELECTION };
  else if (gridId && next.gridId !== gridId) next = { identity, gridId, selection: next.gridId ? EMPTY_SELECTION : next.selection };
  if (productIds) {
    const { productId, term } = next.selection;
    if (productId && !productIds.includes(productId)) {
      next = { ...next, selection: { ...next.selection, productId: "", term: "" } };
    } else if (productId && term && !termsFor(productId).includes(Number(term))) {
      next = { ...next, selection: { ...next.selection, term: "" } };
    }
  }
  if (next !== state) setState(next);
  const update = (patch: Partial<PreviewSelection>) =>
    setState((current) => ({ ...current, selection: { ...current.selection, ...patch } }));
  return [next.selection, update] as const;
}
