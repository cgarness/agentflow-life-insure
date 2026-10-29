import React from "react";
import { Plus } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { DashboardWidgetKey } from "@/lib/dashboard-widget-prefs";
import { DASHBOARD_WIDGET_META } from "@/components/dashboard/ui/dashboardWidgetMeta";

/** "Layout Editor Active" banner with Save / Reset — moved from `pages/Dashboard.tsx` unchanged. */
export const DashboardLayoutEditorBar: React.FC<{ onSave: () => void; onReset: () => void }> = ({ onSave, onReset }) => (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex flex-wrap items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl"
  >
    <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse motion-reduce:animate-none" />
    <span className="text-sm font-bold text-yellow-600 dark:text-yellow-500 uppercase tracking-wider">
      Layout Editor Active
    </span>
    <div className="ml-auto flex gap-2">
      <Button size="sm" onClick={onSave} className="bg-yellow-600 hover:bg-yellow-700 text-white border-0 rounded-lg">
        Save Changes
      </Button>
      <Button variant="outline" size="sm" onClick={onReset} className="border-yellow-500/20 hover:bg-yellow-500/10 rounded-lg">
        Reset Default
      </Button>
    </div>
  </motion.div>
);

/** Hidden widgets that can be restored (edit mode only). */
export const DashboardHiddenWidgets: React.FC<{
  keys: DashboardWidgetKey[];
  onRestore: (key: DashboardWidgetKey) => void;
}> = ({ keys, onRestore }) => {
  if (keys.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Hidden Widgets</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {keys.map((key) => {
          const { icon: Icon, label } = DASHBOARD_WIDGET_META[key];
          return (
            <div key={key} className="bg-card rounded-lg border border-border p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm text-foreground">{label}</span>
              </div>
              <button
                type="button"
                onClick={() => onRestore(key)}
                aria-label={`Show ${label} widget`}
                className="rounded-md p-1 text-primary hover:text-primary/80"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
