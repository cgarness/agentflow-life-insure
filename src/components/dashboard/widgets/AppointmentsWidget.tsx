import React from "react";
import { Calendar, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { DashboardEmptyState, DashboardList, DashboardListRow, DashboardRowSkeleton, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { DASHBOARD_TONES, NEUTRAL_PILL } from "@/components/dashboard/ui/dashboardTones";

interface AppointmentsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
}

/** Most appointments the widget reads; a full page says the list is a preview. */
const DAY_LIMIT = 8;

const STATUS_STYLES: Record<string, string> = {
  Scheduled: NEUTRAL_PILL,
  Confirmed: DASHBOARD_TONES.green.pill,
  Completed: DASHBOARD_TONES.blue.pill,
  "No Show": DASHBOARD_TONES.red.pill,
};

interface Appointment {
  id: string;
  title: string;
  contact_name: string | null;
  start_time: string;
  type: string;
  status: string;
}

/** One day's appointments; throws on a query error (a failure is never "clear"). */
async function loadDayAppointments(userId: string, isFiltered: boolean, dayStart: Date, signal: AbortSignal) {
  // Half-open [start, end): the exclusive end is the NEXT day's midnight, so an
  // appointment at exactly 00:00:00.000 tomorrow belongs to tomorrow — not to
  // both days, which the old inclusive `23:59:59.999` bound allowed.
  const nextDayStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  let q = supabase
    .from("appointments")
    .select("id, title, contact_name, start_time, type, status")
    .gte("start_time", dayStart.toISOString())
    .lt("start_time", nextDayStart.toISOString())
    .order("start_time", { ascending: true })
    .order("id", { ascending: true })
    .limit(DAY_LIMIT);

  if (isFiltered) q = q.eq("user_id", userId);

  const { data, error } = await q.abortSignal(signal);
  if (error) throw error;
  return data ?? [];
}

const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const AppointmentsWidget: React.FC<AppointmentsWidgetProps> = ({ userId, role, adminToggle, refreshSignal, refreshTracker }) => {
  const navigate = useNavigate();
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  // Today is part of the scope: after midnight yesterday's schedule is never kept as today's.
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // One load at a time; a failed refresh keeps this perspective's appointments and says so.
  const section = useDashboardSection<Appointment[]>({
    section: "appointments",
    userId,
    scope: `${isFiltered}|${dayStart.toISOString()}`,
    load: (signal) => loadDayAppointments(userId, isFiltered, dayStart, signal),
    refreshSignal,
    refreshTracker,
  });
  const appointments = section.data ?? [];
  const notice = <DashboardSectionNotice state={section} label="your schedule" className="mb-3" />;
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "appointments")} />;
  const openCalendar = () => navigate("/calendar");

  if (section.loading) return <DashboardRowSkeleton />;

  if (section.data === null) return <DashboardSectionUnavailable state={section} label="your schedule" />;

  if (appointments.length === 0) {
    return (
      <DashboardEmptyState
        tone="purple"
        icon={Calendar}
        title="Your schedule is clear for today"
        notice={<>{notice}{scopeNote}</>}
        action={
          <Button variant="outline" size="sm" onClick={openCalendar} className="rounded-xl border-dashed hover:border-solid">
            Schedule Appointment
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {notice}
      {scopeNote}
      <DashboardList label="Today's appointments">
        {appointments.map((appt) => {
          const name = appt.contact_name || appt.title;
          return (
            <DashboardListRow
              key={appt.id}
              tone="purple"
              leading={
                <span className={cn("flex h-10 w-14 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums", DASHBOARD_TONES.purple.soft, DASHBOARD_TONES.purple.text)}>
                  {formatTime(appt.start_time)}
                </span>
              }
              title={name}
              meta={appt.type}
              status={<DashboardStatusPill className={STATUS_STYLES[appt.status] ?? NEUTRAL_PILL}>{appt.status}</DashboardStatusPill>}
              actions={
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={openCalendar} aria-label={`Open ${name} in Calendar`}>
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
            />
          );
        })}
      </DashboardList>
      {appointments.length === DAY_LIMIT && (
        <p className="text-xs text-muted-foreground">Showing the first {DAY_LIMIT} appointments today. Open the calendar for the rest.</p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={openCalendar}
        className={cn("w-full mt-1 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-violet-500/5", DASHBOARD_TONES.purple.text)}
      >
        View Full Calendar
      </Button>
    </div>
  );
};

export default AppointmentsWidget;
