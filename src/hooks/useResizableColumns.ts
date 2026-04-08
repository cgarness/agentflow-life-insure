import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseResizableColumnsOptions {
  storageKey: string;
  defaultWidths: Record<string, number>;
  userId?: string;
}

export function useResizableColumns({ storageKey, defaultWidths, userId }: UseResizableColumnsOptions) {
  const [widths, setWidths] = useState<Record<string, number>>({ ...defaultWidths });
  const widthsRef = useRef<Record<string, number>>({ ...defaultWidths });
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  // Load widths from Supabase on mount
  useEffect(() => {
    if (!userId) return;

    const loadWidths = async () => {
      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("settings")
          .eq("user_id", userId)
          .maybeSingle();

        if (error || !data?.settings) return;

        const allSettings = data.settings as Record<string, any>;
        const saved = allSettings[storageKey];
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
          setWidths(prev => ({ ...prev, ...saved as Record<string, number> }));
        }
      } catch {
        // Silently fall back to defaults
      }
    };

    loadWidths();
  }, [userId, storageKey]);

  // Upsert widths to Supabase
  const saveWidths = useCallback(async (currentWidths: Record<string, number>) => {
    if (!userId) return;
    try {
      // Fetch existing so we don't wipe out other settings
      const { data } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle();

      const existingSettings = (data?.settings as Record<string, any>) || {};
      const newSettings = {
        ...existingSettings,
        [storageKey]: currentWidths
      };

      await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: userId,
            settings: newSettings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
    } catch {
      // Fail silently
    }
  }, [userId, storageKey]);

  const onMouseDown = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startWidth: widthsRef.current?.[key] || defaultWidths?.[key] || 100 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = ev.clientX - resizing.current.startX;
      const newWidth = Math.max(60, resizing.current.startWidth + diff);
      setWidths(prev => ({ ...prev, [resizing.current!.key]: newWidth }));
    };

    const onMouseUp = () => {
      resizing.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Save to Supabase on resize end
      saveWidths(widthsRef.current);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [defaultWidths, saveWidths]);

  const getWidth = useCallback((key: string) => widths?.[key] || defaultWidths?.[key] || 100, [widths, defaultWidths]);

  return { getWidth, onMouseDown };
}
