/**
 * useContactScope — Contacts Build 2.
 *
 * Owns the My / Team / Agency scope: the permission-gated available options
 * (from getDataScope("leads")), the recursive downline (self + descendants via
 * the canonical hierarchy_path), the persisted last-valid scope in
 * user_preferences.settings, and the fallback logic. Scope is shared across
 * Leads / Clients / Recruits and never widens past the permission maximum.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import type { ContactScope } from "@/lib/contactsFilters";

const SCOPE_PREF_KEY = "contactsScope";

export interface ScopeAgent {
  id: string;
  firstName: string;
  lastName: string;
}

export interface UseContactScopeReturn {
  scope: ContactScope;
  setScope: (s: ContactScope) => void;
  availableScopes: ContactScope[];
  maxScope: "own" | "team" | "all";
  /** Self + recursive downline (for the Team specific-agent dropdown). */
  teamAgents: ScopeAgent[];
  teamAgentIds: string[];
  hasDownline: boolean;
  /** True once permissions, downline, and the stored preference have all resolved. */
  ready: boolean;
  /** Preference load failed — Contacts stays usable on `mine`; surface non-destructively. */
  prefError: boolean;
}

/** Compute the permission-gated, downline-gated available scopes (order: mine, team, agency). */
export function computeAvailableScopes(
  maxScope: "own" | "team" | "all",
  hasDownline: boolean,
): ContactScope[] {
  const out: ContactScope[] = ["mine"];
  if ((maxScope === "team" || maxScope === "all") && hasDownline) out.push("team");
  if (maxScope === "all") out.push("agency");
  return out;
}

export function useContactScope(): UseContactScopeReturn {
  const { user } = useAuth();
  const { getDataScope, isLoading: permsLoading } = usePermissions();
  const maxScope = getDataScope("leads");

  const [scope, setScopeState] = useState<ContactScope>("mine");
  const [teamAgents, setTeamAgents] = useState<ScopeAgent[]>([]);
  const [downlineLoaded, setDownlineLoaded] = useState(false);
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [prefError, setPrefError] = useState(false);
  const correctedRef = useRef(false);

  const hasDownline = teamAgents.length > 1;
  // Memoized so consumers' query effects don't refetch on every render (stable refs).
  const teamAgentIds = useMemo(() => teamAgents.map((a) => a.id), [teamAgents]);
  const availableScopes = useMemo(
    () => computeAvailableScopes(maxScope, hasDownline),
    [maxScope, hasDownline],
  );
  const ready = !permsLoading && downlineLoaded && prefLoaded;

  // Persist a scope value, preserving all other user_preferences keys.
  const persist = useCallback(
    async (s: ContactScope) => {
      if (!user?.id) return;
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("settings")
          .eq("user_id", user.id)
          .maybeSingle();
        const current = ((data as { settings?: Record<string, unknown> } | null)?.settings) || {};
        await supabase.from("user_preferences").upsert(
          { user_id: user.id, settings: { ...current, [SCOPE_PREF_KEY]: s } } as never,
          { onConflict: "user_id" },
        );
      } catch (e) {
        console.error("[useContactScope] Failed to persist scope:", e);
      }
    },
    [user?.id],
  );

  const setScope = useCallback(
    (s: ContactScope) => {
      setScopeState(s);
      void persist(s);
    },
    [persist],
  );

  // Resolve self + recursive downline via the canonical hierarchy RPC.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_contact_scope_agents"); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cancelled) return;
      if (error) {
        console.error("[useContactScope] downline load failed:", error);
        setTeamAgents([]);
        setDownlineLoaded(true);
        return;
      }
      const rows = (data ?? []) as { id: string; first_name: string; last_name: string }[];
      setTeamAgents(rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name })));
      setDownlineLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Load the stored scope (do NOT persist here — avoids an update loop).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setPrefError(true);
        setScopeState("mine");
        setPrefLoaded(true);
        return;
      }
      const stored = ((data as { settings?: Record<string, unknown> } | null)?.settings)?.[SCOPE_PREF_KEY];
      setScopeState(stored === "mine" || stored === "team" || stored === "agency" ? stored : "mine");
      setPrefLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Once everything has resolved: if the stored scope is no longer authorized
  // (lost permission, or Team with no downline) fall back to mine and persist
  // the correction exactly once (no infinite loop).
  useEffect(() => {
    if (!ready) return;
    if (!availableScopes.includes(scope)) {
      setScopeState("mine");
      if (!correctedRef.current) {
        correctedRef.current = true;
        void persist("mine");
      }
    }
  }, [ready, availableScopes, scope, persist]);

  return {
    scope,
    setScope,
    availableScopes,
    maxScope,
    teamAgents,
    teamAgentIds,
    hasDownline,
    ready,
    prefError,
  };
}
