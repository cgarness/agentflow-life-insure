import React, { useState, useEffect } from "react";
import { Plus, List, LayoutGrid } from "lucide-react";
import { useCalendar, CalendarAppointment, CalAppointmentStatus } from "@/contexts/CalendarContext";
import MonthView from "@/components/calendar/MonthView";
import DayAgendaPanel from "@/components/calendar/DayAgendaPanel";
import ListView from "@/components/calendar/ListView";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import ContactModal from "@/components/contacts/ContactModal";
import { mockLeads } from "@/lib/mock-data";
import { Lead } from "@/lib/types";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const CalendarPage: React.FC = () => {
  const { appointments, addAppointment, updateAppointment, deleteAppointment } = useCalendar();
  const [view, setView] = useState<"month" | "list">("month");
  const [currentMonth, setCurrentMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEditing, setModalEditing] = useState<CalendarAppointment | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = useState<Date | undefined>(undefined);

  // Contact modal
  const [contactModalLead, setContactModalLead] = useState<Lead | null>(null);

  // Skeleton loading
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  const openSchedule = (defaultDate?: Date) => {
    setModalEditing(null);
    setModalDefaultDate(defaultDate);
    setModalOpen(true);
  };

  const openEdit = (a: CalendarAppointment) => {
    setModalEditing(a);
    setModalDefaultDate(undefined);
    setModalOpen(true);
  };

  const handleSave = (data: Omit<CalendarAppointment, "id">) => {
    if (modalEditing) {
      updateAppointment(modalEditing.id, data);
    } else {
      addAppointment(data);
    }
  };

  const handleStatusChange = (id: string, status: CalAppointmentStatus) => {
    updateAppointment(id, { status });
  };

  const handleOpenContact = (contactId: string) => {
    const lead = mockLeads.find(l => l.id === contactId);
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

  const dayAppointments = appointments.filter(a => sameDay(new Date(a.date), selectedDate));

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 rounded-md bg-muted animate-pulse" />
          <div className="flex gap-2">
            <div className="h-9 w-40 rounded-md bg-muted animate-pulse" />
            <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} className="h-20 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setView(view === "month" ? "list" : "month")}
            className="px-3 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors duration-150 flex items-center gap-2">
            {view === "month" ? <><List className="w-4 h-4" /> List View</> : <><LayoutGrid className="w-4 h-4" /> Month View</>}
          </button>
          <button onClick={() => openSchedule()} className="px-4 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2 transition-colors duration-150" style={{ backgroundColor: "#3B82F6" }}>
            <Plus className="w-4 h-4" /> Schedule Appointment
          </button>
        </div>
      </div>

      {/* Views */}
      {view === "month" ? (
        <div className="flex bg-card rounded-lg border border-border overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
          <div className="flex-1 flex flex-col p-4 min-h-0">
            <MonthView
              currentMonth={currentMonth}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              onToday={goToday}
              appointments={appointments}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onDayClick={d => {}}
              onEditAppointment={openEdit}
              onDeleteAppointment={deleteAppointment}
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
      ) : (
        <ListView
          appointments={appointments}
          onEdit={openEdit}
          onDelete={deleteAppointment}
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
        onDelete={modalEditing ? deleteAppointment : undefined}
        editing={modalEditing}
        defaultDate={modalDefaultDate}
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
