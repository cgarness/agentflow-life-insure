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
import DashboardDetailModal, { ModalType } from "@/components/dashboard/DashboardDetailModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const firstName = profile?.first_name || "Agent";

  // Missed calls (today, from Supabase)
  const [missedCalls, setMissedCalls] = useState<any[]>([]);
  const [missedCallsLoading, setMissedCallsLoading] = useState(true);

  // Admin toggle
  const [adminViewMode, setAdminViewMode] = useState<"team" | "my">("team");

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<string[]>(DEFAULT_WIDGET_ORDER);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month" | "year">("month");

  // Daily briefing
  const [showBriefing, setShowBriefing] = useState(false);
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [tipLoading, setTipLoading] = useState(false);

  // Detail Modal
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailModalType, setDetailModalType] = useState<ModalType | null>(null);

  const handleCardClick = (type: string) => {
    setDetailModalType(type as ModalType);
    setIsDetailModalOpen(true);
  };

  const handleWidgetClick = (key: string) => {
    const supportedTypes: Record<string, ModalType> = {
      callbacks: "callbacks",
      appointments: "appointments",
      missed_calls: "missed_calls",
      anniversaries: "anniversaries",
    };

    if (supportedTypes[key]) {
      setDetailModalType(supportedTypes[key]);
      setIsDetailModalOpen(true);
    }
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
      } finally {
        setPreferencesLoaded(true);
      }
    };
    loadPrefs();
  }, [userId]);

  // Daily briefing check and pre-fetch
  useEffect(() => {
    if (!userId) return;
    
    // Use local date for briefing logic to avoid UTC mismatch
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const storageKey = `agentflow_briefing_${userId}_${today}`;
    const isDismissed = localStorage.getItem(storageKey) === "dismissed";
    
    if (!isDismissed) {
      setShowBriefing(true);
      // Pre-fetch the tip if it's not already cached
      fetchAiTip(today);
    }
  }, [userId]);

  const fetchAiTip = async (dateStr: string) => {
    const cacheKey = `agentflow_tip_${dateStr}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setAiTip(cached);
      return;
    }

    setTipLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-tip", {
        body: { firstName },
      });
      if (error) throw error;
      const tip = data?.tip || "Make every call count today! 💪";
      setAiTip(tip);
      localStorage.setItem(cacheKey, tip);
    } catch (e) {
      console.error("Failed to pre-fetch AI tip:", e);
    } finally {
      setTipLoading(false);
    }
  };

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
    const today = new Date().toLocaleDateString('en-CA');
    const storageKey = `agentflow_briefing_${userId}_${today}`;
    localStorage.setItem(storageKey, "dismissed");
    setShowBriefing(false);
  }, [userId]);

  const openBriefing = useCallback(() => {
    const today = new Date().toLocaleDateString('en-CA');
    fetchAiTip(today);
    setShowBriefing(true);
  }, [firstName]);

  // Listen for custom event to reopen briefing from TopBar
  useEffect(() => {
    window.addEventListener("open-daily-briefing", openBriefing);
    return () => window.removeEventListener("open-daily-briefing", openBriefing);
  }, [openBriefing]);

  // Fetch today's missed calls directly from Supabase
  useEffect(() => {
    const fetchMissedCalls = async () => {
      setMissedCallsLoading(true);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('calls')
        .select('id, contact_name, contact_phone, started_at, agent_id')
        .eq('is_missed', true)
        .gte('started_at', todayStart.toISOString())
        .order('started_at', { ascending: false })
        .limit(10);
      if (!error && data) {
        setMissedCalls(data.map(c => ({
          id: c.id,
          name: c.contact_name || `Unknown (${c.contact_phone})`,
          phone: c.contact_phone,
          time: new Date(c.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })));
      }
      setMissedCallsLoading(false);
    };
    fetchMissedCalls();
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
        if (missedCallsLoading) {
          return (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-muted animate-pulse rounded" />
              ))}
            </div>
          );
        }
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
    <div className="p-6 space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-700">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-background to-background border border-primary/10 p-8 shadow-2xl shadow-primary/5">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-60 h-60 bg-violet-500/5 rounded-full blur-3xl" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-3xl md:text-4xl font-bold tracking-tight text-foreground"
            >
              Good Morning, {firstName} 👋
            </motion.h1>
              <motion.p 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="text-muted-foreground mt-2 text-lg"
              >
                Welcome back to AgentFlow. Here's what's happening.
              </motion.p>
              
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-6 inline-flex p-1 bg-muted/40 backdrop-blur-md rounded-2xl border border-white/5"
              >
                <Tabs value={timeRange} onValueChange={(v: any) => setTimeRange(v)} className="w-auto">
                  <TabsList className="bg-transparent h-9 p-0 gap-1">
                    <TabsTrigger value="day" className="rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Day</TabsTrigger>
                    <TabsTrigger value="week" className="rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Week</TabsTrigger>
                    <TabsTrigger value="month" className="rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Month</TabsTrigger>
                    <TabsTrigger value="year" className="rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Year</TabsTrigger>
                  </TabsList>
                </Tabs>
              </motion.div>
            </div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-between flex-1 gap-4"
          >
            <div>
              {role === "Admin" && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground font-medium">Viewing Perspective:</span>
                  <button
                    onClick={() =>
                      setAdminViewMode(adminViewMode === "team" ? "my" : "team")
                    }
                    className="px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-all border border-primary/20 shadow-sm"
                  >
                    {adminViewMode === "team"
                      ? "Team Overview → Switch to Personal"
                      : "Personal Stats → Switch to Team"}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setEditMode(!editMode)}
                className="bg-background/50 backdrop-blur-sm border-white/10 hover:bg-background/80 transition-all rounded-xl"
              >
                <Pencil className="h-4 w-4 mr-2 text-primary" />
                {editMode ? "Cancel Editing" : "Customize"}
              </Button>
              {!editMode && (
                <Button
                  size="lg"
                  onClick={() => setShowBriefing(true)}
                  className="rounded-xl shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30"
                >
                  Today's Briefing
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Daily Briefing Modal */}
      {showBriefing && userId && (
        <DailyBriefingModal
          userId={userId}
          firstName={firstName}
          role={role}
          aiTip={aiTip}
          tipLoading={tipLoading}
          onClose={dismissBriefing}
          onDismiss={dismissBriefing}
          onScrollTo={scrollToWidget}
        />
      )}

      {/* Stat Cards */}
      {userId && (
        <div className="relative">
          <StatCards
            role={role}
            userId={userId}
            adminToggle={adminViewMode}
            timeRange={timeRange}
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
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                ref={(el) => {
                  widgetRefs.current[key] = el;
                }}
                className={`glass-card rounded-2xl border ${colors.border} transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5 group cursor-pointer`}
                onClick={() => handleWidgetClick(key)}
              >
                <div className={`flex items-center gap-3 px-6 py-4 border-b ${colors.border} bg-gradient-to-r ${colors.bg} to-transparent rounded-t-2xl`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.gradient} shadow-lg shadow-black/5 transition-transform duration-300 group-hover:scale-110`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className={`text-sm font-bold tracking-tight text-foreground uppercase`}>
                    {WIDGET_LABELS[key]}
                  </h3>
                </div>
                <div className="p-6">{renderWidget(key)}</div>
              </motion.div>
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
