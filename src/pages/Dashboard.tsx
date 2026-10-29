import React, { useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

import StatCards from "@/components/dashboard/StatCards";
import AgencyGroupInviteBanner from "@/components/dashboard/AgencyGroupInviteBanner";
import DashboardControls, { type DashboardTimeRange } from "@/components/dashboard/DashboardControls";
import { DashboardHiddenWidgets, DashboardLayoutEditorBar } from "@/components/dashboard/DashboardLayoutEditorBar";
import { DashboardWidgetFrame, SortableWidgetFrame } from "@/components/dashboard/ui/DashboardWidgetFrame";
import { DASHBOARD_WIDGET_META } from "@/components/dashboard/ui/dashboardWidgetMeta";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import LeaderboardWidget from "@/components/dashboard/widgets/LeaderboardWidget";
import MissedCallsWidget from "@/components/dashboard/widgets/MissedCallsWidget";
import ClientMilestonesWidget from "@/components/dashboard/widgets/ClientMilestonesWidget";
import DashboardDetailModal, { ModalType } from "@/components/dashboard/DashboardDetailModal";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { DASHBOARD_REFRESH_WAIT_MS, DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import type { DashboardModalOrigin, DashboardPerspective } from "@/lib/dashboard-scope";
import type { DashboardWidgetKey } from "@/lib/dashboard-widget-prefs";

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { MotionConfig } from "framer-motion";

/** Stat-card ids that map to a real detail-modal branch. */
const MODAL_TYPES = new Set<ModalType>([
  "callbacks", "appointments", "calls_today", "policies_sold", "missed_calls", "anniversaries", "premium_sold",
]);

const Dashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const userId = user?.id || "";
  const role = profile?.role || "Agent";

  // Perspective states
  const [adminViewMode, setAdminViewMode] = useState<DashboardPerspective>("my"); // Default to personal
  // Default period is Today (approved contract §3).
  const [timeRange, setTimeRange] = useState<DashboardTimeRange>("day");

  // No automatic refresh: one bounded Refresh asks the stat cards and every
  // visible widget for one load each (the Leaderboard widget through its request
  // gate) and waits for the work they actually started — never longer than
  // DASHBOARD_REFRESH_WAIT_MS. A section that sent nothing (spaced, held,
  // offline) reports at once and never holds up the others.
  const [refreshTracker] = useState(() => new DashboardRefreshTracker());
  const [refreshSignal, setRefreshSignal] = useState(0);
  const refreshSignalRef = useRef(0);
  const refreshDashboard = useCallback(async () => {
    const signal = refreshSignalRef.current + 1;
    refreshSignalRef.current = signal;
    setRefreshSignal(signal);
    // Waits for the sections on screen now (each registers while mounted).
    await refreshTracker.wait(signal, refreshTracker.mountedSections(), DASHBOARD_REFRESH_WAIT_MS);
  }, [refreshTracker]);

  const { data: stats, loading: statsLoading, section: statsSection } = useDashboardStats(
    userId, role, adminViewMode, timeRange, { refreshSignal, refreshTracker },
  );

  const layout = useDashboardLayout(userId);

  // Detail Modal. The origin decides its scope: a KPI card's modal matches the card,
  // a widget's modal matches the widget (plan rev 1, §2A).
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ type: ModalType; origin: DashboardModalOrigin } | null>(null);
  const openDetail = (type: ModalType, origin: DashboardModalOrigin) => {
    setDetail({ type, origin });
    setIsDetailModalOpen(true);
  };

  const handleCardClick = (type: string) => {
    // Validate rather than blind-cast: an unrecognised id would otherwise open the
    // modal with a type it has no branch for, rendering a permanently empty list.
    if (!MODAL_TYPES.has(type as ModalType)) return;
    openDetail(type as ModalType, "kpi");
  };

  const widgetDetails = (key: DashboardWidgetKey) => {
    const modalType = DASHBOARD_WIDGET_META[key].modalType;
    return modalType ? () => openDetail(modalType, "widget") : undefined;
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const renderWidget = (key: DashboardWidgetKey) => {
    const section = { userId, refreshSignal, refreshTracker };
    const list = { ...section, role, adminToggle: adminViewMode };
    switch (key) {
      case "callbacks":
        return <CallbacksWidget {...list} onOpenDetails={widgetDetails(key)} />;
      case "appointments":
        return <AppointmentsWidget {...list} />;
      case "goal_progress":
        return <GoalProgressWidget {...section} />;
      case "leaderboard":
        return <LeaderboardWidget {...section} organizationId={profile?.organization_id ?? null} />;
      case "missed_calls":
        return <MissedCallsWidget {...list} />;
      case "anniversaries":
        return <ClientMilestonesWidget {...list} organizationId={profile?.organization_id ?? null} onOpenDetails={widgetDetails(key)} />;
      default:
        return null;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <AgencyGroupInviteBanner />
        <DashboardControls
          role={role}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          perspective={adminViewMode}
          onPerspectiveChange={setAdminViewMode}
          showRefresh={!!userId}
          onRefresh={refreshDashboard}
          editMode={layout.editMode}
          onToggleEdit={() => layout.setEditMode(!layout.editMode)}
        />

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
              status={statsSection}
              onCardClick={handleCardClick}
            />
          </div>
        )}

        {layout.editMode && <DashboardLayoutEditorBar onSave={layout.saveLayout} onReset={layout.resetLayout} />}

        {/* Widget Grid */}
        {!layout.preferencesLoaded ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-card/40 border border-border/40 rounded-2xl animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : layout.editMode ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={layout.handleDragEnd}>
            <SortableContext items={layout.visibleWidgets} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {layout.visibleWidgets.map((key) => (
                  <SortableWidgetFrame key={key} id={key} onHide={layout.toggleHideWidget}>
                    {renderWidget(key)}
                  </SortableWidgetFrame>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {layout.visibleWidgets.map((key) => (
              <DashboardWidgetFrame key={key} widgetKey={key} editMode={false} onOpenDetails={widgetDetails(key)}>
                {renderWidget(key)}
              </DashboardWidgetFrame>
            ))}
          </div>
        )}

        {/* Hidden Widgets (edit mode only) */}
        {layout.editMode && <DashboardHiddenWidgets keys={layout.hiddenWidgetKeys} onRestore={layout.restoreWidget} />}

        {/* Dashboard Detail Modal */}
        <DashboardDetailModal
          performanceSnapshot={stats?.performance}
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          type={detail?.type ?? null}
          origin={detail?.origin ?? "kpi"}
          userId={userId}
          role={role}
          adminToggle={adminViewMode}
          timeRange={timeRange}
        />
      </div>
    </MotionConfig>
  );
};

export default Dashboard;
