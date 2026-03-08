import React, { useState, useEffect, useCallback } from "react";
import { Plus, Phone, MessageSquare, Mail, User, ChevronDown, Pencil, Calendar as CalIcon, RefreshCw } from "lucide-react";
import { CalendarAppointment, CalAppointmentStatus, CalAppointmentType, APPOINTMENT_TYPE_COLORS, APPOINTMENT_STATUS_COLORS } from "@/contexts/CalendarContext";
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

type AppointmentSyncMeta = {
  externalEventId: string | null;
  syncSource: string;
  externalProvider: string | null;
};

const timeStringToDate = (baseDate: Date, time: string) => {
  const date = new Date(baseDate);
  const parts = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!parts) return date;

  let hours = parseInt(parts[1]);
  const minutes = parseInt(parts[2]);
  const ampm = parts[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const CalendarPage: React.FC = () => {
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [appointmentMetaById, setAppointmentMetaById] = useState<Record<string, AppointmentSyncMeta>>({});
  const [view, setView] = useState<ViewType>("month");
  const [currentMonth, setCurrentMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDate, setSelectedDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [loading, setLoading] = useState(true);

  // Google Calendar sync state
  const [googleConnected, setGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalEditing, setModalEditing] = useState<CalendarAppointment | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = useState<Date | undefined>(undefined);
  const [modalDefaultTime, setModalDefaultTime] = useState<string | undefined>(undefined);

  const [contactModalLead, setContactModalLead] = useState<Lead | null>(null);

  // FIX 1 — Contact search state (Supabase)
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string; name: string; phone: string; email: string }>>([]);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string; phone: string; email: string } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // FIX 2 — Create new contact flow
  const [creatingNew, setCreatingNew] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // FIX 1 — Search contacts from Supabase leads table
  const searchContacts = async (query: string) => {
    setContactSearch(query);
    setSelectedContact(null);
    if (query.length < 2) { setContactResults([]); return; }
    setSearchLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
      .limit(8);
    if (!error && data) {
      setContactResults(data.map(l => ({
        id: l.id,
        name: `${l.first_name} ${l.last_name}`,
        phone: l.phone || "",
        email: l.email || "",
      })));
    }
    setSearchLoading(false);
  };

  const resetContactState = () => {
    setSelectedContact(null);
    setCreatingNew(false);
    setContactSearch("");
    setContactResults([]);
    setNewFirstName("");
    setNewLastName("");
  };

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

    const nextMeta: Record<string, AppointmentSyncMeta> = {};
    const mapped: CalendarAppointment[] = (data || []).map((appt: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const startDate = new Date(appt.start_time);
      const endDate = appt.end_time ? new Date(appt.end_time) : startDate;
      const formatTime = (d: Date) =>
        d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      nextMeta[appt.id] = {
        externalEventId: appt.external_event_id ?? null,
      };

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
    setAppointmentMetaById(nextMeta);
    setLoading(false);
  }, [year, month]);

  const warnExternalSyncFailed = () => {
    toast({
      title: "Saved locally, but Google sync failed",
      description: "This appointment was saved in AgentFlow. Please retry sync from Calendar settings.",
      variant: "destructive",
    });
  };

  const syncAppointmentToGoogle = async (payload: {
    action: "create" | "update" | "delete";
    appointmentId: string;
    title?: string;
    notes?: string;
    startTime?: string;
    endTime?: string;
    attendeeEmail?: string | null;
    externalEventId?: string | null;
  }) => {
    try {
      const { error } = await supabase.functions.invoke("google-calendar-sync-appointment", {
        body: {
          action: payload.action,
          appointment_id: payload.appointmentId,
          title: payload.title,
          notes: payload.notes,
          start_time: payload.startTime,
          end_time: payload.endTime,
          attendee_email: payload.attendeeEmail,
          external_event_id: payload.externalEventId,
        },
      });

      if (error) {
        console.error("External calendar sync failed", error);
        warnExternalSyncFailed();
      }
    } catch (error) {
      console.error("External calendar sync threw", error);
      warnExternalSyncFailed();
    }
  };

  const resolveAttendeeEmail = async (contactId?: string, fallbackEmail?: string | null) => {
    if (fallbackEmail) return fallbackEmail;
    if (!contactId) return null;

    const { data } = await supabase
      .from("leads")
      .select("email")
      .eq("id", contactId)
      .maybeSingle();

    return data?.email || null;
  };

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const openSchedule = (defaultDate?: Date, defaultTime?: string) => {
    setModalEditing(null);
    setModalDefaultDate(defaultDate);
    setModalDefaultTime(defaultTime);
    resetContactState();
    setModalOpen(true);
  };

  const openEdit = (a: CalendarAppointment) => {
    setModalEditing(a);
    setModalDefaultDate(undefined);
    setModalDefaultTime(undefined);
    setModalOpen(true);
  };

  const handleSave = async (data: Omit<CalendarAppointment, "id">) => {
    const startDate = timeStringToDate(new Date(data.date), data.startTime);
    const endDate = timeStringToDate(new Date(data.date), data.endTime);

    let contactId = selectedContact?.id || data.contactId || "";
    let attendeeEmail: string | null = selectedContact?.email || null;

    if (!modalEditing && creatingNew && newFirstName.trim() && newLastName.trim()) {
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert([{ first_name: newFirstName.trim(), last_name: newLastName.trim() }])
        .select()
        .single();

      if (leadError || !newLead) {
        toast({ title: "Failed to create contact", variant: "destructive" });
        return;
      }
      contactId = newLead.id;
      attendeeEmail = newLead.email || null;
    }

    const localPayload = {
      title: data.title,
      contact_name: data.contactName,
      contact_id: contactId || null,
      type: data.type,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      notes: data.notes,
      status: data.status,
      sync_source: "internal",
    };

    if (modalEditing) {
      const existingMeta = appointmentMetaById[modalEditing.id];
      const { error } = await supabase
        .from("appointments")
        .update(localPayload)
        .eq("id", modalEditing.id);

      if (error) {
        toast({ title: "Failed to update appointment", variant: "destructive" });
        return;
      }

      toast({ title: "Appointment updated" });
      await fetchAppointments();

      await syncAppointmentToGoogle({
        action: "update",
        appointmentId: modalEditing.id,
        title: data.title,
        notes: data.notes,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        attendeeEmail: await resolveAttendeeEmail(contactId, attendeeEmail),
        externalEventId: existingMeta?.externalEventId,
      });
      return;
    }

    const { data: inserted, error } = await supabase
      .from('appointments')
      .insert([localPayload])
      .select('id')
      .single();

    if (error || !inserted) {
      toast({ title: "Failed to save appointment", variant: "destructive" });
      return;
    }

    toast({ title: "Appointment scheduled" });
    await fetchAppointments();

    await syncAppointmentToGoogle({
      action: "create",
      appointmentId: inserted.id,
      title: data.title,
      notes: data.notes,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      attendeeEmail: await resolveAttendeeEmail(contactId, attendeeEmail),
    });
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    const externalEventId = appointmentMetaById[appointmentId]?.externalEventId;
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
    await fetchAppointments();

    await syncAppointmentToGoogle({
      action: "delete",
      appointmentId,
      externalEventId,
    });
  };

  const handleStatusChange = async (id: string, status: CalAppointmentStatus) => {
    const { error } = await supabase
      .from("appointments")
      .update({ status, sync_source: "internal" })
      .eq("id", id);

    if (error) {
      toast({ title: "Failed to update status", variant: "destructive" });
      return;
    }

    await fetchAppointments();
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

  // Whether the AppointmentModal should open (editing, or contact selected/creating)
  const shouldShowAppointmentModal = modalOpen && (
    !!modalEditing ||
    !!selectedContact ||
    (creatingNew && !!newFirstName.trim() && !!newLastName.trim())
  );

  // Whether to show the contact search pre-step
  const shouldShowContactSearch = modalOpen && !modalEditing && !selectedContact && !creatingNew;

  // Whether to show the create new contact form
  const shouldShowCreateForm = modalOpen && !modalEditing && creatingNew && !selectedContact;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isToday = (() => {
    const n = new Date();
    return selectedDate.getFullYear() === n.getFullYear() && selectedDate.getMonth() === n.getMonth() && selectedDate.getDate() === n.getDate();
  })();
  const dateLabel = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

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
          {/* FIX 3 — Custom agenda panel with Call/Text/Email action buttons */}
          <div className="w-[340px] shrink-0 bg-card border-l border-border flex flex-col h-full">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{dateLabel}</h3>
                  {isToday && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: "#3B82F6" }}>Today</span>}
                </div>
                <button onClick={() => openSchedule(selectedDate)} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dayAppointments.length > 0 ? `${dayAppointments.length} appointment${dayAppointments.length !== 1 ? "s" : ""}` : "No appointments"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {dayAppointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CalIcon className="w-8 h-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No appointments</p>
                  <p className="text-xs text-muted-foreground mt-1">Click + to schedule one</p>
                </div>
              ) : (
                dayAppointments.map(a => {
                  const typeColor = APPOINTMENT_TYPE_COLORS[a.type];
                  const statusColor = APPOINTMENT_STATUS_COLORS[a.status];
                  return (
                    <div key={a.id} className="relative bg-accent/50 rounded-lg p-3 group" style={{ borderLeft: `3px solid ${typeColor}` }}>
                      <div className="text-sm text-muted-foreground">{a.startTime} – {a.endTime}</div>
                      <div className="text-base font-bold text-foreground mt-0.5">{a.title}</div>
                      {/* FIX 3 — Call, Text, Email action buttons */}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => toast({ title: "Opening dialer..." })}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 sidebar-transition"
                        >
                          <Phone className="w-3 h-3" /> Call
                        </button>
                        <button
                          onClick={() => toast({ title: "Opening SMS..." })}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-success/10 text-success text-xs font-medium hover:bg-success/20 sidebar-transition"
                        >
                          <MessageSquare className="w-3 h-3" /> Text
                        </button>
                        <button
                          onClick={() => toast({ title: "Opening email..." })}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-info/10 text-info text-xs font-medium hover:bg-info/20 sidebar-transition"
                        >
                          <Mail className="w-3 h-3" /> Email
                        </button>
                      </div>
                      {a.contactName && (
                        <div className="flex items-center gap-1 mt-1.5 text-sm">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          {a.contactId ? (
                            <button onClick={() => handleOpenContact(a.contactId)} className="hover:underline transition-colors duration-150" style={{ color: "#14B8A6" }}>{a.contactName}</button>
                          ) : (
                            <span className="text-foreground">{a.contactName}</span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: typeColor + "33", color: typeColor }}>{a.type}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: statusColor + "33", color: statusColor }}>{a.status}</span>
                      </div>
                      <button onClick={() => openEdit(a)} className="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center bg-accent text-muted-foreground hover:text-foreground transition-colors duration-150 opacity-0 group-hover:opacity-100">
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
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

      {/* FIX 1 & 2 — Contact Search Step for New Appointments */}
      {(shouldShowContactSearch || shouldShowCreateForm) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setModalOpen(false); resetContactState(); }} />
          <div className="relative w-full max-w-[480px] bg-card border border-border rounded-lg shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {creatingNew ? "Create New Contact" : "Select Contact"}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {creatingNew ? "Enter the new contact's name" : "Search for an existing contact or create a new one"}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {!creatingNew ? (
                <>
                  <div className="relative">
                    <label className="text-sm font-medium text-foreground block mb-1">Search Contact</label>
                    <input
                      value={contactSearch}
                      onChange={e => searchContacts(e.target.value)}
                      placeholder="Type a name to search leads..."
                      className="w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150"
                      autoFocus
                    />
                    {searchLoading && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
                    {/* Search results dropdown */}
                    {contactResults.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {contactResults.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedContact(c);
                              setContactResults([]);
                              setContactSearch("");
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors duration-150 flex items-center justify-between"
                          >
                            <span>{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {contactSearch.length >= 2 && !searchLoading && contactResults.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">No matching contacts found</p>
                    )}
                  </div>
                  {/* Create New Contact option */}
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingNew(true);
                      const parts = contactSearch.trim().split(/\s+/);
                      setNewFirstName(parts[0] || "");
                      setNewLastName(parts.slice(1).join(" ") || "");
                      setContactResults([]);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors duration-150 border border-dashed border-border hover:bg-accent/50"
                  >
                    <Plus className="w-4 h-4" style={{ color: "#3B82F6" }} />
                    <span style={{ color: "#3B82F6" }}>Create New Contact</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
                      <input
                        value={newFirstName}
                        onChange={e => setNewFirstName(e.target.value)}
                        className="w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150"
                        placeholder="First name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
                      <input
                        value={newLastName}
                        onChange={e => setNewLastName(e.target.value)}
                        className="w-full h-9 px-3 rounded-md bg-background text-sm text-foreground border border-border focus:ring-2 focus:ring-ring focus:outline-none transition-all duration-150"
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!newFirstName.trim() || !newLastName.trim()}
                      onClick={() => {
                        // Proceed to appointment form — contact will be created on final save
                      }}
                      className="px-4 py-2 rounded-md text-sm font-medium text-white transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: "#3B82F6" }}
                    >
                      Continue to Appointment
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingNew(false); setNewFirstName(""); setNewLastName(""); }}
                      className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground border border-border hover:bg-accent transition-colors duration-150"
                    >
                      Back to Search
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end p-5 border-t border-border">
              <button
                onClick={() => { setModalOpen(false); resetContactState(); }}
                className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground border border-border hover:bg-accent transition-colors duration-150"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule/Edit Modal — opens after contact selected or when editing */}
      <AppointmentModal
        open={shouldShowAppointmentModal}
        onClose={() => { setModalOpen(false); resetContactState(); }}
        onSave={handleSave}
        onDelete={modalEditing ? handleDeleteAppointment : undefined}
        editing={modalEditing}
        defaultDate={modalDefaultDate}
        defaultTime={modalDefaultTime}
        prefillContactName={selectedContact?.name || (creatingNew ? `${newFirstName} ${newLastName}`.trim() : undefined)}
        prefillContactId={selectedContact?.id}
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
