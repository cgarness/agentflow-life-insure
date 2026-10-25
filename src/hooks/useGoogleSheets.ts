import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sheetsApi } from "@/lib/google-sheets/api";
import type { ConnectionStatus, SheetSourceRow, SheetsContext } from "@/lib/google-sheets/schema";
import { isBusy } from "@/lib/google-sheets/status";

/**
 * Settings → Google Sheets data. Identity is the REAL signed-in user and their organization (the
 * connection and sources belong to them; Settings is withheld during View As). Every query key carries
 * org + user, nothing runs while impersonating or before identity resolves, and RLS returns only the
 * user's own rows. Polls every 10 s while an import/check is running, otherwise every 60 s (visible tab). These are
 * AgentFlow reads only: nothing here asks Google for spreadsheet data.
 */
export function useGoogleSheets() {
  const { user, realProfile, isImpersonating } = useAuth();
  const userId = user?.id ?? null;
  const orgId = realProfile?.organization_id ?? null;
  const ready = Boolean(userId && orgId && !isImpersonating);
  const key = ["google-sheets", orgId, userId] as const;
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: [...key, "status"],
    enabled: ready,
    queryFn: () => sheetsApi<ConnectionStatus>("status"),
    staleTime: 30_000,
    // Monitoring state (setting up → active) is part of status: refresh it while real-time sync applies.
    refetchInterval: (q) => {
      const rt = (q.state.data as ConnectionStatus | undefined)?.realtime;
      return rt && rt.mode !== "off" && Object.keys(rt.sources ?? {}).length > 0 ? 60_000 : false;
    },
  });

  const sources = useQuery({
    queryKey: [...key, "sources"],
    enabled: ready,
    queryFn: async (): Promise<SheetSourceRow[]> => {
      const { data, error } = await (supabase as any)
        .from("google_sheets_sources")
        .select("*")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SheetSourceRow[];
    },
    refetchInterval: (q) => (isBusy((q.state.data as SheetSourceRow[] | undefined) ?? []) ? 10_000 : 60_000),
  });

  const context = useQuery({
    queryKey: [...key, "context"],
    enabled: ready && status.data?.eligible === true && status.data?.connection?.status === "connected",
    queryFn: () => sheetsApi<SheetsContext>("context"),
    staleTime: 60_000,
  });

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["google-sheets", orgId, userId] }), [qc, orgId, userId]);

  return { ready, identityKey: ready ? `${orgId}:${userId}` : null, status, sources, context, refresh };
}
