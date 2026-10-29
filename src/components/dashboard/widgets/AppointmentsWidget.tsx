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
import { DashboardEmptyState, DashboardList, DashboardListRow, DashboardRowSkeleton, DashboardStatusBadge, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { DashboardActionButton } from "@/components/dashboard/ui/DashboardActionButton";
import { DashboardPersonChip } from "@/components/dashboard/ui/DashboardPersonChip";
import { DASHBOARD_TONES, NEUTRAL_PILL, type DashboardStatusKey } from "@/components/dashboard/ui/dashboardTones";
import { useAuth } from "@/contexts/AuthContext";
import { EMPTY_PEOPLE, personLabel, type PeopleLookup, resolvePeople } from "@/lib/dashboard-people";

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

/** Appointment statuses with their shared badge (plan §4.1); anything else is a neutral pill. */
const STATUS_BADGES: Record<string, DashboardStatusKey> = {
  Scheduled: "scheduled", Confirmed: "confirmed", Completed: "completed", "No Show": "noShow", Cancelled: "cancelled",
};

interface Appointment {
  id: string;
  title: string;
  contact_name: string | null;
  start_time: string;
  type: string;
  status: string;
  user_id?: string | null;
  created_by?: string | null;
}

/** One day's appointments; throws on a query error (a failure is never "clear"). */
async function loadDayAppointments(userId: string, isFiltered: boolean, dayStart: Date, organizationId: string | null, signal: AbortSignal) {
  // Half-open [start, end): the exclusive end is the NEXT day's midnight, so an
  // appointment at exactly 00:00:00.000 tomorrow belongs to tomorrow — not to
  // both days, which the old inclusive `23:59:59.999` bound allowed.
  const nextDayStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  let q = supabase
    .from("appointments")
    .select("id, title, contact_name, start_time, type, status, user_id, created_by")
    .gte("start_time", dayStart.toISOString())
    .lt("start_time", nextDayStart.toISOString())
    .order("start_time", { ascending: true })
    .order("id", { ascending: true })
    .limit(DAY_LIMIT);

  if (isFiltered) q = q.eq("user_id", userId);

  const { data, error } = await q.abortSignal(signal);
  if (error) throw error;
  const rows = (data ?? []) as Appointment[];
  // Team view: who each appointment is assigned to — the workload owner, `user_id`, else the
  // scheduler when unassigned (#22). Presentation only; a failed lookup says "Name unavailable".
  const people = isFiltered || rows.length === 0
    ? EMPTY_PEOPLE
    : await resolvePeople(organizationId, rows.map((a) => a.user_id ?? a.created_by), signal);
  return { rows, people };
}

const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const AppointmentsWidget: React.FC<AppointmentsWidgetProps> = ({ userId, role, adminToggle, refreshSignal, refreshTracker }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const organizationId = profile?.organization_id ?? null;
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  // Today is part of the scope: after midnight yesterday's schedule is never kept as today's.
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // One load at a time; a failed refresh keeps this perspective's appointments and says so.
  const section = useDashboardSection<{ rows: Appointment[]; people: PeopleLookup }>({
    section: "appointments",
    userId,
    scope: `${isFiltered}|${dayStart.toISOString()}`,
    load: (signal) => loadDayAppointments(userId, isFiltered, dayStart, organizationId, signal),
    refreshSignal,
    refreshTracker,
  });
  const appointments = section.data?.rows ?? [];
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
              detail={!isFiltered && section.data ? (
                <DashboardPersonChip role="Assigned to" name={personLabel(section.data.people, appt.user_id ?? appt.created_by)} className="mt-1" />
              ) : undefined}
              status={STATUS_BADGES[appt.status]
                ? <DashboardStatusBadge status={STATUS_BADGES[appt.status]} label={appt.status} />
                : <DashboardStatusPill className={NEUTRAL_PILL}>{appt.status}</DashboardStatusPill>}
              actions={
                <DashboardActionButton variant="secondary" icon={CalendarDays} label={`Open ${name} in Calendar`} compact rowFocus onClick={openCalendar}>
                  Calendar
                </DashboardActionButton>
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
        className={cn("mt-1 w-full rounded-xl text-xs font-semibold hover:bg-violet-500/10 focus-visible:ring-violet-500/60", DASHBOARD_TONES.purple.text)}
      >
        View Full Calendar
      </Button>
    </div>
  );
};

export default AppointmentsWidget;
