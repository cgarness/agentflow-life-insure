import React, { useEffect, useState } from "react";
import DashboardControls, { type DashboardTimeRange } from "@/components/dashboard/DashboardControls";
import StatCards from "@/components/dashboard/StatCards";
import { DashboardWidgetFrame } from "@/components/dashboard/ui/DashboardWidgetFrame";
import CallbacksWidget from "@/components/dashboard/widgets/CallbacksWidget";
import AppointmentsWidget from "@/components/dashboard/widgets/AppointmentsWidget";
import type { StatData } from "@/hooks/useDashboardStats";

export default function DashboardScene({ epoch }: { epoch: number }) {
  const [period, setPeriod] = useState<DashboardTimeRange>("day");
  useEffect(() => {
    setPeriod("day"); if (!epoch) return;
    const a = setTimeout(() => setPeriod("month"), 1600);
    const b = setTimeout(() => setPeriod("day"), 4500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [epoch]);
  const monthly = period === "month";
  const stats: StatData = { callsToday: monthly ? 836 : 42, callsYesterday: monthly ? 724 : 35,
    leadsToday: 0, leadsYesterday: 0, policiesThisMonth: monthly ? 18 : 2, policiesLastMonth: monthly ? 14 : 1,
    appointmentsToday: monthly ? 24 : 4, appointmentsYesterday: monthly ? 20 : 3, callsThisMonth: 836, winsThisMonth: 18,
    premiumThisMonth: monthly ? 26400 : 2400, premiumLastMonth: monthly ? 21840 : 1200,
    talkTimeMinutes: 0, prevLabel: `previous full ${period}` };
  return <div className="flex h-full flex-col gap-5 p-6">
    <DashboardControls role="Agent" timeRange={period} onTimeRangeChange={setPeriod} perspective="my" onPerspectiveChange={() => {}}
      showRefresh={false} onRefresh={async () => {}} editMode={false} onToggleEdit={() => {}} />
    <StatCards role="Agent" userId="demo-agent" adminToggle="my" timeRange={period} stats={stats} />
    <div className="grid flex-1 grid-cols-2 gap-5">
      <DashboardWidgetFrame widgetKey="callbacks" editMode={false}><CallbacksWidget userId="demo-agent" role="Agent" adminToggle="my" /></DashboardWidgetFrame>
      <DashboardWidgetFrame widgetKey="appointments" editMode={false}><AppointmentsWidget userId="demo-agent" role="Agent" adminToggle="my" /></DashboardWidgetFrame>
    </div>
  </div>;
}
