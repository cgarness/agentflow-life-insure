import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Pencil,
  GripVertical,
  Eye,
  EyeOff,
  Phone,
  Calendar,
  Target,
  Trophy,
  PhoneMissed,
  Gift,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

import StatCards from "@/components/dashboard/StatCards";
import AgencyGroupInviteBanner from "@/components/dashboard/AgencyGroupInviteBanner";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import LeaderboardWidget from "@/components/dashboard/widgets/LeaderboardWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";
import AnniversariesWidget from "@/components/dashboard/widgets/AnniversariesWidget";
import DashboardDetailModal, { ModalType } from "@/components/dashboard/DashboardDetailModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import {
  DASHBOARD_WIDGET_KEYS,
  type DashboardWidgetKey,
  defaultWidgetPreferences,
  normalizeWidgetPreferences,
  restorableWidgetKeys,
  serializeWidgetPreferences,
  visibleWidgetKeys,
} from "@/lib/dashboard-widget-prefs";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";

// Canonical key list + normalization live in `@/lib/dashboard-widget-prefs` so the
// order, the labels and the persistence layer cannot drift apart.
const DEFAULT_WIDGET_ORDER = DASHBOARD_WIDGET_KEYS;

const WIDGET_LABELS: Record<string, string> = {
  callbacks: "Callbacks",
  // Approved name (decision D6). The persisted key stays `appointments`; the
  // normalizer also accepts a legacy `schedule` key without duplicating the widget.
  appointments: "Schedule",
  goal_progress: "Goal Progress",
  leaderboard: "Leaderboard",
  missed_calls: "Missed Calls",
  anniversaries: "Anniversaries",
};

/** Stat-card ids that map to a real detail-modal branch. */
const MODAL_TYPES = new Set<ModalType>([
  "callbacks",
  "appointments",
  "calls_today",
  "policies_sold",
  "missed_calls",
  "anniversaries",
  "premium_sold",
]);

/** Widgets whose header opens a detail view, and the modal type it opens. */
const WIDGET_MODAL_TYPES: Record<string, ModalType> = {
  callbacks: "callbacks",
  appointments: "appointments",
  missed_calls: "missed_calls",
  anniversaries: "anniversaries",
};

/** Widget keys whose header is clickable — the rest must not advertise clickability. */
const OPENS_DETAIL_MODAL = new Set<string>(Object.keys(WIDGET_MODAL_TYPES));

const WIDGET_ICONS: Record<string, React.ElementType> = {
  callbacks: Phone,
  appointments: Calendar,
  goal_progress: Target,
  leaderboard: Trophy,
  missed_calls: PhoneMissed,
  anniversaries: Gift,
};

const WIDGET_COLORS: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  callbacks: { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/20", gradient: "premium-gradient-blue" },
  appointments: { bg: "bg-violet-500/10", text: "text-violet-500", border: "border-violet-500/20", gradient: "premium-gradient-violet" },
  goal_progress: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20", gradient: "premium-gradient-emerald" },
  leaderboard: { bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/20", gradient: "premium-gradient-amber" },
  missed_calls: { bg: "bg-red-500/10", text: "text-red-500", border: "border-red-500/20", gradient: "bg-gradient-to-br from-red-500 to-rose-600" },
  anniversaries: { bg: "bg-pink-500/10", text: "text-pink-500", border: "border-pink-500/20", gradient: "bg-gradient-to-br from-pink-500 to-rose-400" },
};

// Sortable widget wrapper for edit mode
const SortableWidget: React.FC<{
  id: DashboardWidgetKey;
  editMode: boolean;
  onToggleHide: (id: DashboardWidgetKey) => void;
  children: React.ReactNode;
}> = ({ id, editMode, onToggleHide, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = WIDGET_ICONS[id] || Target;
  const colors = WIDGET_COLORS[id] || { bg: "bg-muted", text: "text-muted-foreground", border: "border-border", gradient: "bg-muted" };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`glass-card rounded-2xl border ${colors.border} transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5`}
    >
      {/* Widget header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b ${colors.border} bg-gradient-to-r ${colors.bg} to-transparent rounded-t-2xl`}>
        <div className="flex items-center gap-3">
          {editMode && (
            <button
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 hover:bg-white/10 rounded-md transition-colors"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.gradient} shadow-lg shadow-black/5`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h3 className={`text-sm font-bold tracking-tight text-foreground uppercase`}>
            {WIDGET_LABELS[id]}
          </h3>
        </div>
        {editMode && (
          <button
            onClick={() => onToggleHide(id)}
            className="text-muted-foreground hover:text-foreground p-1.5 hover:bg-white/5 rounded-full transition-colors"
          >
            <EyeOff className="w-4 h-4" />
          </button>
        )}
      </div>
      {/* Widget content */}
      <div className="p-6">{children}</div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const userId = user?.id || "";
  const role = profile?.role || "Agent";

  // Perspective states
  const [adminViewMode, setAdminViewMode] = useState<"team" | "my">("my"); // Default to personal
  // Default period is Today (approved contract §3).
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month" | "year">("day");

  // Dynamic Theme Config (Local to Toggle)
  const perspectiveColor = adminViewMode === "team" ? "emerald-600" : "blue-600";
  const perspectiveShadow = adminViewMode === "team" ? "shadow-emerald-600/20" : "shadow-blue-600/20";

  const { data: stats, loading: statsLoading } = useDashboardStats(
    userId,
    role,
    adminViewMode,
    timeRange
  );

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<DashboardWidgetKey[]>(() => defaultWidgetPreferences().order);
  const [hiddenWidgets, setHiddenWidgets] = useState<DashboardWidgetKey[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Detail Modal
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailModalType, setDetailModalType] = useState<ModalType | null>(null);

  const handleCardClick = (type: string) => {
    // Validate rather than blind-cast: an unrecognised id would otherwise open the
    // modal with a type it has no branch for, rendering a permanently empty list.
    if (!MODAL_TYPES.has(type as ModalType)) return;
    setDetailModalType(type as ModalType);
    setIsDetailModalOpen(true);
  };

  const handleWidgetClick = (key: string) => {
    const modalType = WIDGET_MODAL_TYPES[key];
    if (!modalType) return;
    setDetailModalType(modalType);
    setIsDetailModalOpen(true);
  };

  // Widget refs for scrolling
  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
  const visibleWidgets = visibleWidgetKeys(prefs);

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

  const renderWidget = (key: string) => {
    switch (key) {
      case "callbacks":
        return (
          <CallbacksWidget
            userId={userId}
            role={role}
            adminToggle={adminViewMode}
          />
        );
      case "appointments":
        return (
          <AppointmentsWidget
            userId={userId}
            role={role}
            adminToggle={adminViewMode}
          />
        );
      case "goal_progress":
        return <GoalProgressWidget userId={userId} />;
      case "leaderboard":
        return <LeaderboardWidget userId={userId} />;
      case "missed_calls":
        return (
          <MissedCallsWidget
            userId={userId}
            role={role}
            adminToggle={adminViewMode}
          />
        );
      case "anniversaries":
        return (
          <AnniversariesWidget
            userId={userId}
            role={role}
            adminToggle={adminViewMode}
          />
        );
      default:
        return null;
    }
  };

  // Derived from `order` (not from `hidden` directly) so the restore list can only
  // ever contain keys the grid knows how to render.
  const hiddenWidgetKeys = restorableWidgetKeys(prefs);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <AgencyGroupInviteBanner />
      {/* Controls Row: Filters, Perspective & Edit Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-4">
          <div className="inline-flex p-1 bg-card shadow-sm rounded-2xl border border-border/40">
            <Tabs value={timeRange} onValueChange={(v: any) => setTimeRange(v)} className="w-auto">
              <TabsList className="bg-transparent h-9 p-0 gap-1">
                {["day", "week", "month", "year"].map((t) => (
                  <TabsTrigger 
                    key={t}
                    value={t} 
                    className={`rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm`}
                  >
                    {t}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {(role === "Admin" || role === "Team Leader") && (
            <div className="flex items-center gap-2 bg-card shadow-sm px-3 py-1.5 rounded-2xl border border-border/40">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">Perspective</span>
              <button
                onClick={() =>
                  setAdminViewMode(adminViewMode === "team" ? "my" : "team")
                }
                className={`px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all text-white border-2 shadow-lg ${perspectiveShadow} ${
                  adminViewMode === "team" 
                    ? "bg-emerald-600 border-emerald-500" 
                    : "bg-blue-600 border-blue-500"
                }`}
              >
                {adminViewMode === "team" ? "Team Overview" : "Personal Stats"}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode(!editMode)}
            className={`transition-all rounded-xl h-10 px-4 bg-card shadow-sm border-border ${
              editMode ? "text-primary border-primary bg-primary/5" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <Pencil className="h-3.5 w-3.5 mr-2 text-primary" />
            <span className="text-xs font-semibold">{editMode ? "Done Editing" : "Customize Layout"}</span>
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      {userId && (
        <div className="relative">
          <StatCards
            role={role}
            userId={userId}
            adminToggle={adminViewMode}
            timeRange={timeRange}
            stats={stats}
            loading={statsLoading}
            onCardClick={handleCardClick}
          />
        </div>
      )}

      {/* Edit Mode Header */}
      {editMode && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl"
        >
          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          <span className="text-sm font-bold text-yellow-500 uppercase tracking-wider">
            Layout Editor Active
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={saveLayout} className="bg-yellow-600 hover:bg-yellow-700 text-white border-0 rounded-lg">
              Save Changes
            </Button>
            <Button variant="outline" size="sm" onClick={resetLayout} className="border-yellow-500/20 hover:bg-yellow-500/10 rounded-lg">
              Reset Default
            </Button>
          </div>
        </motion.div>
      )}

      {/* Widget Grid */}
      {!preferencesLoaded ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 bg-card/40 backdrop-blur-sm border border-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : editMode ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleWidgets}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {visibleWidgets.map((key) => (
                <div
                  key={key}
                  ref={(el) => {
                    widgetRefs.current[key] = el;
                  }}
                >
                  <SortableWidget
                    id={key}
                    editMode={editMode}
                    onToggleHide={toggleHideWidget}
                  >
                    {renderWidget(key)}
                  </SortableWidget>
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {visibleWidgets.map((key) => {
            const Icon = WIDGET_ICONS[key] || Target;
            const colors = WIDGET_COLORS[key] || { bg: "bg-muted", text: "text-muted-foreground", border: "border-border", gradient: "bg-muted" };
            return (
              <div
                key={key}
                ref={(el) => {
                  widgetRefs.current[key] = el;
                }}
                className={`glass-card rounded-2xl border ${colors.border} transition-shadow duration-200 hover:shadow-2xl hover:shadow-primary/5 group`}
              >
                {/* Only the header opens the detail view. Previously the whole card
                    (including the widget body) carried the onClick, so every button
                    inside every widget bubbled up and opened the modal. */}
                <div
                  className={`flex items-center gap-3 px-6 py-4 border-b ${colors.border} bg-gradient-to-r ${colors.bg} to-transparent rounded-t-2xl ${
                    OPENS_DETAIL_MODAL.has(key) ? "cursor-pointer" : ""
                  }`}
                  onClick={() => handleWidgetClick(key)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.gradient} shadow-lg shadow-black/5 transition-transform duration-200 group-hover:scale-110`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className={`text-sm font-bold tracking-tight text-foreground uppercase`}>
                    {WIDGET_LABELS[key]}
                  </h3>
                </div>
                <div className="p-6">{renderWidget(key)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hidden Widgets (edit mode only) */}
      {editMode && hiddenWidgetKeys.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Hidden Widgets
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {hiddenWidgetKeys.map((key) => {
              const Icon = WIDGET_ICONS[key] || Target;
              return (
                <div
                  key={key}
                  className="bg-card rounded-lg border border-border p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">
                      {WIDGET_LABELS[key]}
                    </span>
                  </div>
                  <button
                    onClick={() => restoreWidget(key)}
                    className="text-primary hover:text-primary/80"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dashboard Detail Modal */}
      <DashboardDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        type={detailModalType}
        userId={userId}
        role={role}
        adminToggle={adminViewMode}
        timeRange={timeRange}
      />
    </div>
  );
};

export default Dashboard;
