import React, { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { useCalendar, CalendarAppointment, CalAppointmentStatus, CalAppointmentType } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import MonthView from "@/components/calendar/MonthView";
import WeekView from "@/components/calendar/WeekView";
import DayView from "@/components/calendar/DayView";
import DayAgendaPanel from "@/components/calendar/DayAgendaPanel";
import ListView from "@/components/calendar/ListView";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import ContactModal from "@/components/contacts/ContactModal";
import { mockLeads } from "@/lib/mock-data";
import { Lead } from "@/lib/types";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type ViewType = "month" | "week" | "day" | "list";
const VIEWS: { key: ViewType; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "list", label: "List" },
];

const VALID_TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Policy Anniversary", "Other"];
const VALID_STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];

const CalendarPage: React.FC = () => {
  const { addAppointment, updateAppointment } = useCalendar();
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [view, setView] = useState<ViewType>("month");
  const [currentMonth, setCurrentMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalEditing, setModalEditing] = useState<CalendarAppointment | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = useState<Date | undefined>(undefined);
  const [modalDefaultTime, setModalDefaultTime] = useState<string | undefined>(undefined);

  const [contactModalLead, setContactModalLead] = useState<Lead | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    const startOfMonth = new Date(year, month, 1).toISOString();
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .gte('start_time', startOfMonth)
      .lte('start_time', endOfMonth)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching appointments:', error);
      setLoading(false);
      return;
    }

    const mapped: CalendarAppointment[] = (data || []).map((appt: any) => {
      const startDate = new Date(appt.start_time);
      const endDate = appt.end_time ? new Date(appt.end_time) : startDate;
      const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return {
        id: appt.id,
        title: appt.title,
        type: VALID_TYPES.includes(appt.type) ? appt.type : "Other",
        status: VALID_STATUSES.includes(appt.status) ? appt.status : "Scheduled",
        date: new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
        startTime: formatTime(startDate),
        endTime: formatTime(endDate),
        contactName: appt.contact_name || "",
        contactId: appt.contact_id || "",
        agent: "",
        notes: appt.notes || "",
      } as CalendarAppointment;
    });

    setAppointments(mapped);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const openSchedule = (defaultDate?: Date, defaultTime?: string) => {
    setModalEditing(null);
    setModalDefaultDate(defaultDate);
    setModalDefaultTime(defaultTime);
    setModalOpen(true);
  };

  const openEdit = (a: CalendarAppointment) => {
    setModalEditing(a);
    setModalDefaultDate(undefined);
    setModalDefaultTime(undefined);
    setModalOpen(true);
  };

  const handleCreateAppointment = async (appt: {
    title: string;
    contact_name: string;
    type: string;
    start_time: string;
    end_time?: string;
    notes?: string;
  }) => {
    const { error } = await supabase.from('appointments').insert([appt]);
    if (error) {
      toast({ title: "Failed to save appointment", variant: "destructive" });
      return;
    }
    toast({ title: "Appointment scheduled" });
    fetchAppointments();
  };

  const handleSave = (data: Omit<CalendarAppointment, "id">) => {
    if (modalEditing) {
      updateAppointment(modalEditing.id, data);
    } else {
      // Save to Supabase
      const startDate = new Date(data.date);
      const timeParts = data.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (timeParts) {
        let hours = parseInt(timeParts[1]);
        const minutes = parseInt(timeParts[2]);
        const ampm = timeParts[3].toUpperCase();
        if (ampm === "PM" && hours !== 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
        startDate.setHours(hours, minutes, 0, 0);
      }
      const endDate = new Date(data.date);
      const endParts = data.endTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (endParts) {
        let hours = parseInt(endParts[1]);
        const minutes = parseInt(endParts[2]);
        const ampm = endParts[3].toUpperCase();
        if (ampm === "PM" && hours !== 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
        endDate.setHours(hours, minutes, 0, 0);
      }
      handleCreateAppointment({
        title: data.title,
        contact_name: data.contactName,
        type: data.type,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        notes: data.notes,
      });
      addAppointment(data);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId);

    if (error) {
      console.error('Error deleting appointment:', error);
      toast({ title: "Failed to delete appointment", variant: "destructive" });
      return;
    }
    toast({ title: "Appointment deleted" });
    fetchAppointments();
  };

  const handleStatusChange = (id: string, status: CalAppointmentStatus) => {
    updateAppointment(id, { status });
  };

  const handleOpenContact = (contactId: string) => {
    const lead = (mockLeads ?? []).find(l => l.id === contactId);
    if (lead) setContactModalLead(lead);
  };

  const prevMonth = () => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
    setCurrentMonth(d);
    const t = new Date(); t.setHours(0,0,0,0);
    setSelectedDate(t);
  };

  const safeAppointments = appointments ?? [];
  const dayAppointments = safeAppointments.filter(a => {
    try { return sameDay(new Date(a.date), selectedDate); } catch { return false; }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <div className="flex items-center gap-3">
          {/* Segmented view toggle */}
          <div className="flex items-center rounded-lg overflow-hidden border border-border">
            {VIEWS.map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  view === v.key
                    ? "text-white"
                    : "text-muted-foreground hover:text-foreground bg-transparent"
                }`}
                style={view === v.key ? { backgroundColor: "#3B82F6" } : undefined}>
                {v.label}
              </button>
            ))}
          </div>
          <button onClick={() => openSchedule()} className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2 transition-colors duration-150" style={{ backgroundColor: "#3B82F6" }}>
            <Plus className="w-4 h-4" /> Schedule Appointment
          </button>
        </div>
      </div>

      {/* Views */}
      {view === "month" && (
        <div className="flex bg-card rounded-lg border border-border overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
          <div className="flex-1 flex flex-col p-4 min-h-0">
            <MonthView
              currentMonth={currentMonth}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              onToday={goToday}
              appointments={safeAppointments}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onDayClick={() => {}}
              onEditAppointment={openEdit}
              onDeleteAppointment={handleDeleteAppointment}
              onStatusChange={handleStatusChange}
              onOpenContact={handleOpenContact}
            />
          </div>
          <DayAgendaPanel
            selectedDate={selectedDate}
            appointments={dayAppointments}
            onAdd={() => openSchedule(selectedDate)}
            onEdit={openEdit}
            onStatusChange={handleStatusChange}
            onOpenContact={handleOpenContact}
          />
        </div>
      )}

      {view === "week" && (
        <div className="bg-card rounded-lg border border-border overflow-hidden p-4" style={{ height: "calc(100vh - 180px)" }}>
          <WeekView
            appointments={safeAppointments}
            onEditAppointment={openEdit}
            onDeleteAppointment={handleDeleteAppointment}
            onStatusChange={handleStatusChange}
            onOpenContact={handleOpenContact}
            onScheduleAt={(date, time) => openSchedule(date, time)}
          />
        </div>
      )}

      {view === "day" && (
        <div className="bg-card rounded-lg border border-border overflow-hidden p-4" style={{ height: "calc(100vh - 180px)" }}>
          <DayView
            appointments={safeAppointments}
            onEditAppointment={openEdit}
            onDeleteAppointment={handleDeleteAppointment}
            onStatusChange={handleStatusChange}
            onOpenContact={handleOpenContact}
            onScheduleAt={(date, time) => openSchedule(date, time)}
          />
        </div>
      )}

      {view === "list" && (
        <ListView
          appointments={safeAppointments}
          onEdit={openEdit}
          onDelete={handleDeleteAppointment}
          onStatusChange={handleStatusChange}
          onOpenContact={handleOpenContact}
          onSchedule={() => openSchedule()}
        />
      )}

      {/* Schedule/Edit Modal */}
      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={modalEditing ? handleDeleteAppointment : undefined}
        editing={modalEditing}
        defaultDate={modalDefaultDate}
        defaultTime={modalDefaultTime}
      />

      {/* Contact Modal */}
      {contactModalLead && (
        <ContactModal
          lead={contactModalLead}
          onClose={() => setContactModalLead(null)}
          onUpdate={async () => {}}
          onDelete={async () => {}}
        />
      )}
    </div>
  );
};

export default CalendarPage;
