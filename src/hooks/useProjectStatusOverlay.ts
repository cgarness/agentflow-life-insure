import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ProjectStatusOverlay } from "@/lib/project-status/types";

function toOverlayMap(rows: ProjectStatusOverlay[]) {
  return new Map(rows.map((r) => [r.item_key, r]));
}

export function useProjectStatusOverlay() {
  const { user } = useAuth();
  const [overlays, setOverlays] = useState<ProjectStatusOverlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("project_status_overlays")
      .select("*")
      .order("sort_order", { ascending: true });

    if (err) {
      setError(err.message);
      setOverlays([]);
    } else {
      setOverlays((data as ProjectStatusOverlay[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const overlayMap = toOverlayMap(overlays);

  const upsertOverlay = useCallback(
    async (payload: {
      item_key: string;
      section: string;
      status?: string | null;
      note?: string | null;
      sort_order?: number;
    }) => {
      const existing = overlayMap.get(payload.item_key);
      const row = {
        item_key: payload.item_key,
        section: payload.section,
        status: payload.status ?? existing?.status ?? null,
        note: payload.note ?? existing?.note ?? null,
        sort_order: payload.sort_order ?? existing?.sort_order ?? 0,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      };

      const { data, error: err } = await supabase
        .from("project_status_overlays")
        .upsert(row, { onConflict: "item_key" })
        .select()
        .maybeSingle();

      if (err) throw err;
      await refresh();
      return data as ProjectStatusOverlay | null;
    },
    [overlayMap, refresh, user?.id]
  );

  const batchUpdateSortOrder = useCallback(
    async (updates: { item_key: string; sort_order: number; section: string }[]) => {
      for (const u of updates) {
        const existing = overlayMap.get(u.item_key);
        await supabase.from("project_status_overlays").upsert(
          {
            item_key: u.item_key,
            section: u.section,
            sort_order: u.sort_order,
            status: existing?.status ?? null,
            note: existing?.note ?? null,
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_key" }
        );
      }
      await refresh();
    },
    [overlayMap, refresh, user?.id]
  );

  return {
    overlays,
    overlayMap,
    loading,
    error,
    refresh,
    upsertOverlay,
    batchUpdateSortOrder,
  };
}
