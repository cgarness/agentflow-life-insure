import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { supabase } from "@/integrations/supabase/client";
import {
  type DashboardWidgetKey,
  defaultWidgetPreferences,
  normalizeWidgetPreferences,
  restorableWidgetKeys,
  serializeWidgetPreferences,
  visibleWidgetKeys,
} from "@/lib/dashboard-widget-prefs";

/**
 * The Dashboard's widget order / hidden set and its persistence in
 * `user_preferences.settings` (`dashboard_widget_order` / `dashboard_hidden_widgets`).
 * Moved unchanged from `pages/Dashboard.tsx` (plan §8): same reads, same
 * read-modify-write saves, same error handling and toasts.
 */
export function useDashboardLayout(userId: string) {
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<DashboardWidgetKey[]>(() => defaultWidgetPreferences().order);
  const [hiddenWidgets, setHiddenWidgets] = useState<DashboardWidgetKey[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const loadPrefs = async () => {
      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("settings")
          .eq("user_id", userId)
          .maybeSingle();

        // A returned error is NOT "no preferences" — say so instead of silently
        // showing defaults and letting the next save overwrite a real saved layout.
        if (error) {
          console.error("[Dashboard] Failed to load layout preferences:", error);
          toast.error("Could not load your saved layout. Showing the default.");
          return;
        }

        const settings = (data?.settings as Record<string, any>) ?? {};
        // Normalization is the safety net for removed / renamed / duplicated /
        // non-string keys, and it appends any widget the saved order predates.
        const prefs = normalizeWidgetPreferences(
          settings.dashboard_widget_order,
          settings.dashboard_hidden_widgets,
        );
        setWidgetOrder(prefs.order);
        setHiddenWidgets(prefs.hidden);
      } catch (err) {
        console.error("[Dashboard] Failed to load layout preferences:", err);
      } finally {
        setPreferencesLoaded(true);
      }
    };
    loadPrefs();
  }, [userId]);

  // Unsaved changes guard
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editMode]);

  const prefs = { order: widgetOrder, hidden: hiddenWidgets };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = widgetOrder.indexOf(active.id as DashboardWidgetKey);
      const newIndex = widgetOrder.indexOf(over.id as DashboardWidgetKey);
      if (oldIndex < 0 || newIndex < 0) return;
      setWidgetOrder(arrayMove(widgetOrder, oldIndex, newIndex));
    }
  };

  const toggleHideWidget = (id: DashboardWidgetKey) => {
    setHiddenWidgets((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  const restoreWidget = (id: DashboardWidgetKey) => {
    setHiddenWidgets((prev) => prev.filter((k) => k !== id));
    if (!widgetOrder.includes(id)) {
      setWidgetOrder((prev) => [...prev, id]);
    }
  };

  const saveLayout = async () => {
    try {
      const { data, error: readError } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle();

      // Read-modify-write on a shared settings blob: if the read failed we do not
      // know what else is in there, so writing would drop other preferences.
      if (readError) {
        console.error("[Dashboard] Failed to read preferences before save:", readError);
        toast.error("Failed to save layout");
        return;
      }

      const existingSettings = (data?.settings as Record<string, any>) || {};
      const newSettings = {
        ...existingSettings,
        ...serializeWidgetPreferences({ order: widgetOrder, hidden: hiddenWidgets }),
      };

      // supabase-js RESOLVES with `{ error }` rather than throwing, so the previous
      // code's `catch` never fired for a database error and the success toast was
      // unconditional. Inspect the error explicitly.
      const { error: writeError } = await supabase.from("user_preferences").upsert(
        {
          user_id: userId,
          settings: newSettings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (writeError) {
        console.error("[Dashboard] Failed to save layout:", writeError);
        toast.error("Failed to save layout");
        return;   // stay in edit mode so the change is not silently lost
      }

      toast.success("Dashboard layout saved");
      setEditMode(false);
    } catch (err) {
      console.error("[Dashboard] Failed to save layout:", err);
      toast.error("Failed to save layout");
    }
  };

  const resetLayout = async () => {
    try {
      const { data, error: readError } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle();

      if (readError) {
        console.error("[Dashboard] Failed to read preferences before reset:", readError);
        toast.error("Failed to reset layout");
        return;
      }

      if (data?.settings) {
        const settings = { ...(data.settings as Record<string, any>) };
        delete settings.dashboard_widget_order;
        delete settings.dashboard_hidden_widgets;

        const { error: writeError } = await supabase.from("user_preferences").upsert(
          {
            user_id: userId,
            settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        // Same false-success bug as saveLayout: the result must be inspected, or the
        // UI claims a reset that never persisted and reappears on the next load.
        if (writeError) {
          console.error("[Dashboard] Failed to reset layout:", writeError);
          toast.error("Failed to reset layout");
          return;
        }
      }

      const defaults = defaultWidgetPreferences();
      setWidgetOrder(defaults.order);
      setHiddenWidgets(defaults.hidden);
      setEditMode(false);
      toast.success("Layout reset to default");
    } catch (err) {
      console.error("[Dashboard] Failed to reset layout:", err);
      toast.error("Failed to reset layout");
    }
  };

  return {
    editMode,
    setEditMode,
    preferencesLoaded,
    visibleWidgets: visibleWidgetKeys(prefs),
    // Derived from `order` (not from `hidden` directly) so the restore list can only
    // ever contain keys the grid knows how to render.
    hiddenWidgetKeys: restorableWidgetKeys(prefs),
    handleDragEnd,
    toggleHideWidget,
    restoreWidget,
    saveLayout,
    resetLayout,
  };
}
