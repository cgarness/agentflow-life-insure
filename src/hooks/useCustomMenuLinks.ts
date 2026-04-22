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

export function useCustomMenuLinks() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["custom_menu_links", organizationId],
    enabled: !!organizationId,
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
