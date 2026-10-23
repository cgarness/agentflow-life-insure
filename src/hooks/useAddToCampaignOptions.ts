import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ADD_TO_CAMPAIGN_COLUMNS,
  managementRoleFor,
  selectAddToCampaignOptions,
  type AddToCampaignOption,
  type AddToCampaignRow,
} from "@/components/contacts/addToCampaignOptions";

export type AddToCampaignOptionsStatus = "loading" | "error" | "unavailable" | "ready";

interface Args {
  open: boolean;
  orgId: string | null;
  userId: string | null;
  profileRole: string | null;
  isSuperAdmin: boolean;
}

interface Loaded {
  /** `${orgId}:${userId}` the rows were read for. */
  key: string;
  status: "error" | "ready";
  rows: AddToCampaignRow[];
}

const EMPTY_ROWS: AddToCampaignRow[] = [];

/** Raw Active campaigns in the organization; RLS stays the authority on which rows return. */
async function fetchActiveCampaignRows(orgId: string, signal: AbortSignal): Promise<AddToCampaignRow[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select(ADD_TO_CAMPAIGN_COLUMNS)
    .eq("organization_id", orgId)
    .eq("status", "Active")
    .order("name")
    .abortSignal(signal);
  if (error) throw error;
  return data ?? [];
}

/**
 * Campaign options for the Add to Campaign picker. Every open is a fresh read. A result is
 * shown only for the identity it was read for: close, org/user change and retry abort the
 * in-flight read, and a stored result for another identity is masked as loading at render.
 */
export function useAddToCampaignOptions({ open, orgId, userId, profileRole, isSuperAdmin }: Args) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = orgId && userId ? `${orgId}:${userId}` : null;

  useEffect(() => {
    setLoaded(null);
    if (!open || !orgId || !userId) return;
    const controller = new AbortController();
    const requestKey = `${orgId}:${userId}`;
    fetchActiveCampaignRows(orgId, controller.signal).then(
      (rows) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, status: "ready", rows });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, status: "error", rows: EMPTY_ROWS });
      },
    );
    return () => controller.abort();
  }, [open, orgId, userId, attempt]);

  const current = loaded && loaded.key === key ? loaded : null;
  const status: AddToCampaignOptionsStatus = !key ? "unavailable" : current ? current.status : "loading";
  const rows = current?.status === "ready" ? current.rows : EMPTY_ROWS;

  // Role scope is applied at render with the CURRENT inputs; a filtered set is never stored.
  const options = useMemo<AddToCampaignOption[]>(
    () => (userId ? selectAddToCampaignOptions(rows, userId, managementRoleFor(profileRole, isSuperAdmin)) : []),
    [rows, userId, profileRole, isSuperAdmin],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, options, retry };
}
