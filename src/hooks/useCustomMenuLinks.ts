import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export type CustomMenuLinkOpenMode = "new_tab" | "in_frame";

export interface CustomMenuLinkRow {
  id: string;
  label: string;
  url: string;
  sort_order: number;
  organization_id: string | null;
  open_mode: CustomMenuLinkOpenMode;
}

function normalizeOpenMode(v: string | null | undefined): CustomMenuLinkOpenMode {
  return v === "in_frame" ? "in_frame" : "new_tab";
}

/**
 * @param options.enabled Query-level gate, default true. The Sidebar passes `!isImpersonating`:
 * custom links target `/app-link/:id`, a route the "View As" guard refuses, so the sidebar hides
 * them while impersonating — and hiding a row is no reason to have FETCHED it. Disabling the query
 * (rather than filtering the result) means no `custom_menu_links` read is issued at all under
 * "View As", consistent with the rest of the shell's no-query posture.
 */
export function useCustomMenuLinks(options?: { enabled?: boolean }) {
  const { organizationId } = useOrganization();
  const callerEnabled = options?.enabled !== false;

  return useQuery({
    queryKey: ["custom_menu_links", organizationId],
    enabled: callerEnabled && !!organizationId,
    queryFn: async (): Promise<CustomMenuLinkRow[]> => {
      const { data, error } = await supabase
        .from("custom_menu_links")
        .select("id,label,url,sort_order,organization_id,open_mode")
        .eq("organization_id", organizationId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        ...row,
        sort_order: row.sort_order ?? 0,
        open_mode: normalizeOpenMode(row.open_mode as string | undefined),
      }));
    },
  });
}
