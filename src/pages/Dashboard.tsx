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
import DailyBriefingModal from "@/components/dashboard/DailyBriefingModal";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import LeaderboardWidget from "@/components/dashboard/widgets/LeaderboardWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";
import AnniversariesWidget from "@/components/dashboard/widgets/AnniversariesWidget";

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

const DEFAULT_WIDGET_ORDER = [
  "callbacks",
  "appointments",
  "goal_progress",
  "leaderboard",
  "missed_calls",
  "anniversaries",
];

const WIDGET_LABELS: Record<string, string> = {
  callbacks: "Callbacks",
  appointments: "Appointments",
  goal_progress: "Goal Progress",
  leaderboard: "Leaderboard",
  missed_calls: "Missed Calls",
  anniversaries: "Anniversaries",
};

const WIDGET_ICONS: Record<string, React.ElementType> = {
  callbacks: Phone,
  appointments: Calendar,
  goal_progress: Target,
  leaderboard: Trophy,
  missed_calls: PhoneMissed,
  anniversaries: Gift,
};

const WIDGET_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  callbacks: { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/20" },
  appointments: { bg: "bg-violet-500/10", text: "text-violet-500", border: "border-violet-500/20" },
  goal_progress: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" },
  leaderboard: { bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/20" },
  missed_calls: { bg: "bg-red-500/10", text: "text-red-500", border: "border-red-500/20" },
  anniversaries: { bg: "bg-pink-500/10", text: "text-pink-500", border: "border-pink-500/20" },
};

// Sortable widget wrapper for edit mode
const SortableWidget: React.FC<{
  id: string;
  editMode: boolean;
  onToggleHide: (id: string) => void;
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
  const colors = WIDGET_COLORS[id] || { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card rounded-xl border shadow-sm ${colors.border}`}
    >
      {/* Widget header */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${colors.border} ${colors.bg} rounded-t-xl`}>
        <div className="flex items-center gap-2">
          {editMode && (
            <button
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colors.bg}`}>
            <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
          </div>
          <h3 className={`text-sm font-semibold ${colors.text}`}>
            {WIDGET_LABELS[id]}
          </h3>
        </div>
        {editMode && (
          <button
            onClick={() => onToggleHide(id)}
            className="text-muted-foreground hover:text-foreground"
          >
            <EyeOff className="w-4 h-4" />
          </button>
        )}
      </div>
      {/* Widget content */}
      <div className="p-5">{children}</div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const userId = user?.id || "";
  const role = profile?.role || "Agent";
  const firstName = profile?.first_name || "Agent";

  // Admin toggle
  const [adminViewMode, setAdminViewMode] = useState<"team" | "my">("team");

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<string[]>(DEFAULT_WIDGET_ORDER);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([]);

  // Daily briefing
  const [showBriefing, setShowBriefing] = useState(false);

  // Widget refs for scrolling
  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load widget preferences
  useEffect(() => {
    if (!userId) return;
    const loadPrefs = async () => {
      try {
        const { data: orderPref } = await supabase
          .from("user_preferences")
          .select("preference_value")
          .eq("user_id", userId)
          .eq("preference_key", "dashboard_widget_order")
          .single();

        const { data: hiddenPref } = await supabase
          .from("user_preferences")
          .select("preference_value")
          .eq("user_id", userId)
          .eq("preference_key", "dashboard_hidden_widgets")
          .single();

        if (orderPref?.preference_value) {
          const val = orderPref.preference_value;
          if (Array.isArray(val)) setWidgetOrder(val as string[]);
        }
        if (hiddenPref?.preference_value) {
          const val = hiddenPref.preference_value;
          if (Array.isArray(val)) setHiddenWidgets(val as string[]);
        }
      } catch {
        // use defaults
      }
    };
    loadPrefs();
  }, [userId]);

  // Daily briefing check
  useEffect(() => {
    if (!userId) return;
    const today = new Date().toISOString().split("T")[0];
    const storageKey = `agentflow_briefing_${userId}_${today}`;
    const isDismissed = localStorage.getItem(storageKey) === "dismissed";
    if (!isDismissed) setShowBriefing(true);
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

  const dismissBriefing = useCallback(() => {
    const today = new Date().toISOString().split("T")[0];
    const storageKey = `agentflow_briefing_${userId}_${today}`;
    localStorage.setItem(storageKey, "dismissed");
    setShowBriefing(false);
  }, [userId]);

  const closeBriefing = useCallback(() => {
    setShowBriefing(false);
  }, []);

  const scrollToWidget = useCallback((widgetId: string) => {
    const el = widgetRefs.current[widgetId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const visibleWidgets = widgetOrder.filter(
    (k) => !hiddenWidgets.includes(k)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = widgetOrder.indexOf(active.id as string);
      const newIndex = widgetOrder.indexOf(over.id as string);
      setWidgetOrder(arrayMove(widgetOrder, oldIndex, newIndex));
    }
  };

  const toggleHideWidget = (id: string) => {
    setHiddenWidgets((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  const restoreWidget = (id: string) => {
    setHiddenWidgets((prev) => prev.filter((k) => k !== id));
    if (!widgetOrder.includes(id)) {
      setWidgetOrder((prev) => [...prev, id]);
    }
  };

  const saveLayout = async () => {
    try {
      await supabase.from("user_preferences").upsert(
        [{
          user_id: userId,
          preference_key: "dashboard_widget_order",
          preference_value: widgetOrder as unknown as Json,
        }],
        { onConflict: "user_id,preference_key" }
      );
      await supabase.from("user_preferences").upsert(
        [{
          user_id: userId,
          preference_key: "dashboard_hidden_widgets",
          preference_value: hiddenWidgets as unknown as Json,
        }],
        { onConflict: "user_id,preference_key" }
      );
      toast.success("Dashboard layout saved");
      setEditMode(false);
    } catch {
      toast.error("Failed to save layout");
    }
  };

  const resetLayout = async () => {
    try {
      await supabase
        .from("user_preferences")
        .delete()
        .eq("user_id", userId)
        .eq("preference_key", "dashboard_widget_order");
      await supabase
        .from("user_preferences")
        .delete()
        .eq("user_id", userId)
        .eq("preference_key", "dashboard_hidden_widgets");
      setWidgetOrder(DEFAULT_WIDGET_ORDER);
      setHiddenWidgets([]);
      setEditMode(false);
      toast.success("Layout reset to default");
    } catch {
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

  const hiddenWidgetKeys = hiddenWidgets.filter((k) =>
    DEFAULT_WIDGET_ORDER.includes(k)
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditMode(!editMode)}
        >
          <Pencil className="h-4 w-4 mr-2" />
          {editMode ? "Cancel" : "Edit Dashboard"}
        </Button>
      </div>

      {/* Daily Briefing */}
      {showBriefing && userId && (
        <DailyBriefingModal
          userId={userId}
          firstName={firstName}
          role={role}
          onClose={closeBriefing}
          onDismiss={dismissBriefing}
          onScrollTo={scrollToWidget}
        />
      )}

      {/* Stat Cards */}
      {userId && (
        <StatCards
          role={role}
          userId={userId}
          adminToggle={adminViewMode}
        />
      )}

      {/* Admin Toggle Pill */}
      {role === "Admin" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Viewing:</span>
          <button
            onClick={() =>
              setAdminViewMode(adminViewMode === "team" ? "my" : "team")
            }
            className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            {adminViewMode === "team"
              ? "Team Totals | Switch to My Stats"
              : "My Stats | Switch to Team Totals"}
          </button>
        </div>
      )}

      {/* Edit Mode Header */}
      {editMode && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium px-2 py-1 rounded bg-yellow-100 text-yellow-800">
            Editing Layout
          </span>
          <Button size="sm" onClick={saveLayout}>
            Save Layout
          </Button>
          <Button variant="outline" size="sm" onClick={resetLayout}>
            Reset to Default
          </Button>
        </div>
      )}

      {/* Widget Grid */}
      {editMode ? (
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {visibleWidgets.map((key) => {
            const Icon = WIDGET_ICONS[key] || Target;
            const colors = WIDGET_COLORS[key] || { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" };
            return (
              <div
                key={key}
                ref={(el) => {
                  widgetRefs.current[key] = el;
                }}
                className={`bg-card rounded-xl border shadow-sm ${colors.border}`}
              >
                <div className={`flex items-center gap-2 px-5 py-3 border-b ${colors.border} ${colors.bg} rounded-t-xl`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colors.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
                  </div>
                  <h3 className={`text-sm font-semibold ${colors.text}`}>
                    {WIDGET_LABELS[key]}
                  </h3>
                </div>
                <div className="p-5">{renderWidget(key)}</div>
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
    </div>
  );
};

export default Dashboard;
