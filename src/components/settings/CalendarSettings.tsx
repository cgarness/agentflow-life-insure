import React, { useCallback, useEffect, useState } from "react";
import {
  CalendarDays, CalendarRange, List, LayoutGrid, Sun, Clock,
  Plus, MoreVertical, Lock, Pencil, Trash2, Mail, MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Types
interface AppointmentType {
  id: string;
  name: string;
  color: string;
  duration: number;
  locked: boolean;
}

interface WorkingDay {
  day: string;
  enabled: boolean;
  start: string;
  end: string;
}

interface GoogleCalendarItem {
  id: string;
  summary: string;
}

type GoogleSyncMode = "outbound_only" | "two_way";

interface GoogleSyncSettings {
  connected: boolean;
  calendarId: string;
  syncMode: GoogleSyncMode;
}

const PRESET_COLORS = ["#3B82F6", "#22C55E", "#EF4444", "#F97316", "#A855F7", "#EC4899", "#14B8A6", "#EAB308"];
const DURATION_OPTIONS = [15, 30, 45, 60, 90];
const BUFFER_OPTIONS = ["No Buffer", "5 Minutes", "10 Minutes", "15 Minutes", "30 Minutes"];

const TIME_OPTIONS = [
  "6:00 AM","6:30 AM","7:00 AM","7:30 AM","8:00 AM","8:30 AM","9:00 AM","9:30 AM",
  "10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM",
  "2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM",
  "6:00 PM","6:30 PM","7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM",
];

const REMINDER_OPTIONS = [
  "15 Minutes Before","30 Minutes Before","1 Hour Before","2 Hours Before","24 Hours Before","48 Hours Before",
];

const DEFAULT_APPOINTMENT_TYPES: AppointmentType[] = [
  { id: "1", name: "Sales Call", color: "#3B82F6", duration: 30, locked: true },
  { id: "2", name: "Follow Up", color: "#F97316", duration: 20, locked: true },
  { id: "3", name: "Recruit Interview", color: "#A855F7", duration: 45, locked: true },
  { id: "4", name: "Policy Review", color: "#22C55E", duration: 60, locked: true },
  { id: "5", name: "Policy Anniversary", color: "#EC4899", duration: 60, locked: true },
  { id: "6", name: "Other", color: "#64748B", duration: 30, locked: true },
];

const DEFAULT_WORKING_HOURS: WorkingDay[] = [
  { day: "Monday", enabled: true, start: "8:00 AM", end: "6:00 PM" },
  { day: "Tuesday", enabled: true, start: "8:00 AM", end: "6:00 PM" },
  { day: "Wednesday", enabled: true, start: "8:00 AM", end: "6:00 PM" },
  { day: "Thursday", enabled: true, start: "8:00 AM", end: "6:00 PM" },
  { day: "Friday", enabled: true, start: "8:00 AM", end: "6:00 PM" },
  { day: "Saturday", enabled: false, start: "8:00 AM", end: "6:00 PM" },
  { day: "Sunday", enabled: false, start: "8:00 AM", end: "6:00 PM" },
];

const timeToMinutes = (t: string) => {
  const [time, period] = t.split(" ");
  const [parsedH, m] = time.split(":").map(Number);
  let h = parsedH;
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + m;
};

const GOOGLE_SYNC_PREFERENCE_KEY = "calendar_google_sync_settings";

const CalendarSettings: React.FC = () => {
  const { user } = useAuth();
  // Card 1 - Default View
  const [defaultView, setDefaultView] = useState("Month");
  // Card 2 - First Day
  const [firstDay, setFirstDay] = useState("Sunday");
  // Card 3 - Appointment Types
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>(DEFAULT_APPOINTMENT_TYPES);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentType | null>(null);
  const [deleteType, setDeleteType] = useState<AppointmentType | null>(null);
  const [typeForm, setTypeForm] = useState({ name: "", color: "#3B82F6", duration: 30 });
  const [typeFormError, setTypeFormError] = useState("");
  // Card 4 - Scheduling Defaults
  const [bufferTime, setBufferTime] = useState("No Buffer");
  const [maxAgent, setMaxAgent] = useState(8);
  const [maxTeamLead, setMaxTeamLead] = useState(12);
  const [schedulingDirty, setSchedulingDirty] = useState(false);
  const [schedulingSaving, setSchedulingSaving] = useState(false);
  const [initialScheduling] = useState({ buffer: "No Buffer", agent: 8, lead: 12 });
  // Card 5 - Reminders
  const [emailReminder, setEmailReminder] = useState(false);
  const [emailReminderTime, setEmailReminderTime] = useState("24 Hours Before");
  const [smsReminder, setSmsReminder] = useState(false);
  const [smsReminderTime, setSmsReminderTime] = useState("24 Hours Before");
  // Card 6 - Confirmation
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [colorByAgent, setColorByAgent] = useState(false);
  // Card 7 - Working Hours
  const [workingHours, setWorkingHours] = useState<WorkingDay[]>(DEFAULT_WORKING_HOURS);
  const [workingHoursDirty, setWorkingHoursDirty] = useState(false);
  const [workingHoursSaving, setWorkingHoursSaving] = useState(false);

  // Card 8 - Google Calendar Integration
  const [googleSyncSettings, setGoogleSyncSettings] = useState<GoogleSyncSettings>({
    connected: false,
    calendarId: "",
    syncMode: "outbound_only",
  });
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarItem[]>([]);
  const [googlePrefsLoading, setGooglePrefsLoading] = useState(true);
  const [googlePrefsError, setGooglePrefsError] = useState<string | null>(null);
  const [googleActionLoading, setGoogleActionLoading] = useState(false);
  const [googleCalendarsLoading, setGoogleCalendarsLoading] = useState(false);
  const [googleCalendarsError, setGoogleCalendarsError] = useState<string | null>(null);
  const [googleSyncSaving, setGoogleSyncSaving] = useState(false);

  const invokeAuthedFunction = useCallback(async (name: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) throw new Error(error.message || `Failed calling ${name}`);
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const saveGoogleSyncSettings = async (nextSettings: GoogleSyncSettings, showToast = true) => {
    if (!user?.id) return false;

    setGoogleSyncSaving(true);
    try {
      const { error } = await supabase
        .from("user_preferences")
        .upsert(
          [{
            user_id: user.id,
            preference_key: GOOGLE_SYNC_PREFERENCE_KEY,
            preference_value: nextSettings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            updated_at: new Date().toISOString(),
          }],
          { onConflict: "user_id,preference_key" },
        );

      if (error) throw error;

      if (showToast) {
        toast({ title: "Google Calendar sync settings saved", className: "bg-[#22C55E] text-white border-0" });
      }
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({ title: "Unable to save Google sync settings", description: message, variant: "destructive" });
      return false;
    } finally {
      setGoogleSyncSaving(false);
    }
  };

  const loadGoogleCalendars = useCallback(async (): Promise<GoogleCalendarItem[]> => {
    setGoogleCalendarsLoading(true);
    setGoogleCalendarsError(null);
    try {
      const data = await invokeAuthedFunction("google-calendar-list");
      const calendars = Array.isArray(data?.calendars) ? data.calendars : [];
      setGoogleCalendars(calendars);
      return calendars;
    } catch (error: unknown) {
      setGoogleCalendarsError(error instanceof Error ? error.message : "Could not load Google calendars.");
      return [];
    } finally {
      setGoogleCalendarsLoading(false);
    }
  }, [invokeAuthedFunction]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("google_connected");
    const error = params.get("google_error");

    if (!connected && !error) return;

    if (connected === "1") {
      toast({ title: "Google Calendar connected", className: "bg-[#22C55E] text-white border-0" });
    }

    if (error) {
      toast({ title: "Google Calendar connection failed", description: error, variant: "destructive" });
    }

    params.delete("google_connected");
    params.delete("google_error");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }, []);

  useEffect(() => {
    const loadGoogleSyncSettings = async () => {
      if (!user?.id) {
        setGooglePrefsLoading(false);
        return;
      }

      setGooglePrefsLoading(true);
      setGooglePrefsError(null);

      try {
        const [{ data: prefData, error: prefError }, statusData] = await Promise.all([
          supabase
            .from("user_preferences")
            .select("preference_value")
            .eq("user_id", user.id)
            .eq("preference_key", GOOGLE_SYNC_PREFERENCE_KEY)
            .maybeSingle(),
          invokeAuthedFunction("google-calendar-status"),
        ]);

        if (prefError) throw prefError;

        const saved = prefData?.preference_value;
        const parsed = saved && typeof saved === "object" && !Array.isArray(saved)
          ? (saved as Partial<GoogleSyncSettings>)
          : {};

        const nextSettings: GoogleSyncSettings = {
          connected: !!statusData?.connected,
          calendarId: typeof statusData?.calendarId === "string"
            ? statusData.calendarId
            : typeof parsed.calendarId === "string"
              ? parsed.calendarId
              : "",
          syncMode: statusData?.syncMode === "two_way" || parsed.syncMode === "two_way"
            ? "two_way"
            : "outbound_only",
        };

        setGoogleSyncSettings(nextSettings);

        if (nextSettings.connected) {
          await loadGoogleCalendars();
        }
      } catch {
        setGooglePrefsError("Unable to load Google Calendar integration settings.");
      } finally {
        setGooglePrefsLoading(false);
      }
    };

    loadGoogleSyncSettings();
  }, [loadGoogleCalendars, user?.id]);

  const handleGoogleConnectToggle = async () => {
    if (!user?.id) {
      toast({ title: "You must be logged in to manage integration settings", variant: "destructive" });
      return;
    }

    setGoogleActionLoading(true);
    try {
      if (googleSyncSettings.connected) {
        await invokeAuthedFunction("google-calendar-disconnect");

        const nextSettings: GoogleSyncSettings = {
          ...googleSyncSettings,
          connected: false,
          calendarId: "",
        };

        const saved = await saveGoogleSyncSettings(nextSettings, false);
        if (!saved) return;

        setGoogleSyncSettings(nextSettings);
        setGoogleCalendars([]);
        toast({ title: "Google Calendar disconnected", className: "bg-[#22C55E] text-white border-0" });
        return;
      }

      const data = await invokeAuthedFunction("google-oauth-start");
      const authUrl = data?.authUrl;
      if (!authUrl || typeof authUrl !== "string") {
        throw new Error("OAuth URL was not returned by server");
      }

      window.location.assign(authUrl);
    } catch (error: unknown) {
      toast({
        title: "Google Calendar integration failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGoogleActionLoading(false);
    }
  };

  const handleGoogleCalendarChange = async (calendarId: string) => {
    const nextSettings: GoogleSyncSettings = {
      ...googleSyncSettings,
      calendarId,
    };

    setGoogleSyncSettings(nextSettings);

    if (nextSettings.connected) {
      await invokeAuthedFunction("google-calendar-configure", { calendarId, syncMode: nextSettings.syncMode });
    }
    await saveGoogleSyncSettings(nextSettings);
  };

  const handleGoogleSyncModeChange = async (syncMode: GoogleSyncMode) => {
    const nextSettings: GoogleSyncSettings = {
      ...googleSyncSettings,
      syncMode,
    };

    setGoogleSyncSettings(nextSettings);

    if (nextSettings.connected) {
      await invokeAuthedFunction("google-calendar-configure", {
        calendarId: nextSettings.calendarId || "primary",
        syncMode,
      });
    }
    await saveGoogleSyncSettings(nextSettings);
  };

  // Card 1 handlers
  const viewOptions = [
    { label: "Month", icon: CalendarDays },
    { label: "Week", icon: CalendarRange },
    { label: "Day", icon: Sun },
    { label: "List", icon: List },
  ];

  // Card 3 handlers
  const openAddModal = () => {
    setTypeForm({ name: "", color: "#3B82F6", duration: 30 });
    setTypeFormError("");
    setEditingType(null);
    setAddModalOpen(true);
  };

  const openEditModal = (t: AppointmentType) => {
    setTypeForm({ name: t.name, color: t.color, duration: t.duration });
    setTypeFormError("");
    setEditingType(t);
    setAddModalOpen(true);
  };

  const saveType = () => {
    if (!typeForm.name.trim()) {
      setTypeFormError("Name is required");
      return;
    }
    if (editingType) {
      setAppointmentTypes(prev => prev.map(t => t.id === editingType.id ? { ...t, name: typeForm.name, color: typeForm.color, duration: typeForm.duration } : t));
      toast({ title: "Appointment type updated", className: "bg-[#22C55E] text-white border-0" });
    } else {
      const newType: AppointmentType = { id: Date.now().toString(), name: typeForm.name, color: typeForm.color, duration: typeForm.duration, locked: false };
      setAppointmentTypes(prev => [...prev, newType]);
      toast({ title: "Appointment type added", className: "bg-[#22C55E] text-white border-0" });
    }
    setAddModalOpen(false);
  };

  const confirmDelete = () => {
    if (deleteType) {
      setAppointmentTypes(prev => prev.filter(t => t.id !== deleteType.id));
      toast({ title: "Appointment type deleted", className: "bg-[#22C55E] text-white border-0" });
      setDeleteType(null);
    }
  };

  // Card 4 handlers
  const handleSchedulingSave = () => {
    setSchedulingSaving(true);
    setTimeout(() => {
      setSchedulingSaving(false);
      setSchedulingDirty(false);
      toast({ title: "Scheduling defaults saved", className: "bg-[#22C55E] text-white border-0" });
    }, 800);
  };

  // Card 7 handlers
  const updateWorkingDay = (index: number, updates: Partial<WorkingDay>) => {
    setWorkingHours(prev => prev.map((d, i) => i === index ? { ...d, ...updates } : d));
    setWorkingHoursDirty(true);
  };

  const handleWorkingHoursSave = () => {
    setWorkingHoursSaving(true);
    setTimeout(() => {
      setWorkingHoursSaving(false);
      setWorkingHoursDirty(false);
      toast({ title: "Working hours saved", className: "bg-[#22C55E] text-white border-0" });
    }, 800);
  };

  const agentError = maxAgent < 1 || maxAgent > 50;
  const leadError = maxTeamLead < 1 || maxTeamLead > 50;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground">Calendar Settings</h3>
        <p className="text-sm text-muted-foreground mt-1">Control how your team's calendar looks and behaves</p>
      </div>

      {/* Card 1 — Default Calendar View */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Calendar View</CardTitle>
          <CardDescription>Choose the default view agents see when they open the calendar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {viewOptions.map(v => (
              <button
                key={v.label}
                onClick={() => {
                  setDefaultView(v.label);
                  toast({ title: "Default view saved", className: "bg-[#22C55E] text-white border-0" });
                }}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  defaultView === v.label
                    ? "border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]"
                    : "border-border bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                <v.icon className="w-5 h-5" />
                <span className="text-sm font-medium">{v.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — First Day of the Week */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">First Day of the Week</CardTitle>
          <CardDescription>Controls how the calendar grid is displayed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            {["Sunday", "Monday"].map(d => (
              <button
                key={d}
                onClick={() => {
                  setFirstDay(d);
                  toast({ title: "Setting saved", className: "bg-[#22C55E] text-white border-0" });
                }}
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                  firstDay === d
                    ? "border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]"
                    : "border-border bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                <span className="text-sm font-medium">{d}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Card 3 — Appointment Types */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Appointment Types</CardTitle>
            <CardDescription>Manage the types of appointments your team can schedule</CardDescription>
          </div>
          <Button onClick={openAddModal} size="sm" className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white">
            <Plus className="w-4 h-4 mr-1" /> Add Appointment Type
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border divide-y">
            {appointmentTypes.map(t => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{t.duration} min</span>
                  {t.locked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
                <TooltipProvider>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded hover:bg-accent"><MoreVertical className="w-4 h-4 text-muted-foreground" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditModal(t)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      {t.locked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuItem disabled className="opacity-50">
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </TooltipTrigger>
                          <TooltipContent>Default types cannot be deleted</TooltipContent>
                        </Tooltip>
                      ) : (
                        <DropdownMenuItem onClick={() => setDeleteType(t)} className="text-[#EF4444] focus:text-[#EF4444]">
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipProvider>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Card 4 — Scheduling Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduling Defaults</CardTitle>
          <CardDescription>Control default durations and buffer time between appointments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Buffer Time Between Appointments</Label>
            <p className="text-xs text-muted-foreground">Prevents back-to-back appointments from being scheduled without a break</p>
            <Select value={bufferTime} onValueChange={v => { setBufferTime(v); setSchedulingDirty(true); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUFFER_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Max Appointments Per Day</Label>
            <p className="text-xs text-muted-foreground">Caps the number of appointments that can be scheduled per agent per day</p>
            <div className="flex gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Agent</Label>
                <Input
                  type="number" min={1} max={50} value={maxAgent}
                  onChange={e => { setMaxAgent(Number(e.target.value)); setSchedulingDirty(true); }}
                  className={`w-24 ${agentError ? "border-[#EF4444] focus-visible:ring-[#EF4444]" : ""}`}
                />
                {agentError && <p className="text-xs text-[#EF4444]">Must be between 1 and 50</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Team Leader</Label>
                <Input
                  type="number" min={1} max={50} value={maxTeamLead}
                  onChange={e => { setMaxTeamLead(Number(e.target.value)); setSchedulingDirty(true); }}
                  className={`w-24 ${leadError ? "border-[#EF4444] focus-visible:ring-[#EF4444]" : ""}`}
                />
                {leadError && <p className="text-xs text-[#EF4444]">Must be between 1 and 50</p>}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleSchedulingSave}
              disabled={!schedulingDirty || schedulingSaving || agentError || leadError}
              className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white"
            >
              {schedulingSaving ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</span>
              ) : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 5 — Google Calendar Integration */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Google Calendar Integration</CardTitle>
              <CardDescription>Connect your Google Calendar and control how events sync.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={googleSyncSettings.connected ? "bg-[#22C55E] text-white" : "bg-muted text-muted-foreground"}>
                {googleSyncSettings.connected ? "Connected" : "Disconnected"}
              </Badge>
              {googleSyncSettings.connected ? (
                <Button
                  onClick={handleGoogleConnectToggle}
                  disabled={googleActionLoading || googlePrefsLoading}
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  {googleActionLoading ? "Working..." : "Disconnect"}
                </Button>
              ) : (
                <button
                  onClick={handleGoogleConnectToggle}
                  disabled={googleActionLoading || googlePrefsLoading}
                  className="inline-flex items-center gap-3 px-4 py-2.5 rounded-md border border-border bg-white text-sm font-medium text-[#3c4043] shadow-sm hover:shadow-md hover:bg-[#f8f9fa] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {googleActionLoading ? "Connecting..." : "Sign in with Google"}
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {googlePrefsLoading && <p className="text-sm text-muted-foreground">Loading integration settings...</p>}
          {googlePrefsError && <p className="text-sm text-[#EF4444]">{googlePrefsError}</p>}

          {!googlePrefsLoading && (
            <>
              <div className="space-y-2">
                <Label>Google Calendar</Label>
                <Select
                  value={googleSyncSettings.calendarId || undefined}
                  onValueChange={handleGoogleCalendarChange}
                  disabled={!googleSyncSettings.connected || googleCalendarsLoading || googleSyncSaving}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder={googleCalendarsLoading ? "Loading calendars..." : "Select calendar"} />
                  </SelectTrigger>
                  <SelectContent>
                    {googleCalendars.map(calendar => (
                      <SelectItem key={calendar.id} value={calendar.id}>{calendar.summary}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {googleCalendarsError && <p className="text-xs text-[#EF4444]">{googleCalendarsError}</p>}
              </div>

              <div className="space-y-2">
                <Label>Sync Mode</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={googleSyncSettings.syncMode === "outbound_only" ? "default" : "outline"}
                    disabled={!googleSyncSettings.connected || googleSyncSaving}
                    onClick={() => handleGoogleSyncModeChange("outbound_only")}
                    className={googleSyncSettings.syncMode === "outbound_only" ? "bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white" : ""}
                  >
                    Outbound-only
                  </Button>
                  <Button
                    type="button"
                    variant={googleSyncSettings.syncMode === "two_way" ? "default" : "outline"}
                    disabled={!googleSyncSettings.connected || googleSyncSaving}
                    onClick={() => handleGoogleSyncModeChange("two_way")}
                    className={googleSyncSettings.syncMode === "two_way" ? "bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white" : ""}
                  >
                    2-way Sync
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 6 — Appointment Reminders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appointment Reminders</CardTitle>
          <CardDescription>Automatically remind contacts before their appointment</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg px-4 py-2.5 text-xs text-muted-foreground">
            Reminders will activate when email and SMS are configured in Settings
          </div>
          {/* Email */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <Label>Email Reminders</Label>
              </div>
              <Switch checked={emailReminder} onCheckedChange={v => {
                setEmailReminder(v);
                toast({ title: "Email reminder setting saved", className: "bg-[#22C55E] text-white border-0" });
              }} />
            </div>
            {emailReminder && (
              <div className="ml-6">
                <Label className="text-xs text-muted-foreground">Send reminder</Label>
                <Select value={emailReminderTime} onValueChange={setEmailReminderTime}>
                  <SelectTrigger className="w-56 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{REMINDER_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Separator />
          {/* SMS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <Label>SMS Reminders</Label>
              </div>
              <Switch checked={smsReminder} onCheckedChange={v => {
                setSmsReminder(v);
                toast({ title: "SMS reminder setting saved", className: "bg-[#22C55E] text-white border-0" });
              }} />
            </div>
            {smsReminder && (
              <div className="ml-6">
                <Label className="text-xs text-muted-foreground">Send reminder</Label>
                <Select value={smsReminderTime} onValueChange={setSmsReminderTime}>
                  <SelectTrigger className="w-56 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{REMINDER_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 7 — Appointment Confirmation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appointment Confirmation</CardTitle>
          <CardDescription>Automatically send a confirmation to contacts when an appointment is created</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg px-4 py-2.5 text-xs text-muted-foreground">
            Activates when email is configured in Settings
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Send Confirmation Email on Appointment Created</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Contact receives an email confirmation immediately after an appointment is saved</p>
            </div>
            <Switch checked={sendConfirmation} onCheckedChange={v => {
              setSendConfirmation(v);
              toast({ title: "Confirmation setting saved", className: "bg-[#22C55E] text-white border-0" });
            }} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Calendar Color Coding</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Switch between coloring calendar events by appointment type or by assigned agent</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                {colorByAgent ? "Coloring by agent" : "Coloring by appointment type"}
              </p>
            </div>
            <Switch checked={colorByAgent} onCheckedChange={v => {
              setColorByAgent(v);
              toast({ title: "Color coding setting saved", className: "bg-[#22C55E] text-white border-0" });
            }} />
          </div>
        </CardContent>
      </Card>

      {/* Card 8 — Working Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Working Hours</CardTitle>
          <CardDescription>Set the days and times agents are available to be scheduled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border divide-y">
            {workingHours.map((wh, i) => {
              const timeError = wh.enabled && timeToMinutes(wh.end) <= timeToMinutes(wh.start);
              return (
                <div key={wh.day} className="flex items-center gap-4 px-4 py-3">
                  <span className="text-sm font-medium text-foreground w-28">{wh.day}</span>
                  <Switch checked={wh.enabled} onCheckedChange={v => updateWorkingDay(i, { enabled: v })} />
                  {wh.enabled ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Select value={wh.start} onValueChange={v => updateWorkingDay(i, { start: v })}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{TIME_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">to</span>
                      <Select value={wh.end} onValueChange={v => updateWorkingDay(i, { end: v })}>
                        <SelectTrigger className={`w-32 ${timeError ? "border-[#EF4444]" : ""}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{TIME_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                      {timeError && <span className="text-xs text-[#EF4444]">End time must be after start time</span>}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleWorkingHoursSave}
              disabled={!workingHoursDirty || workingHoursSaving}
              className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white"
            >
              {workingHoursSaving ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</span>
              ) : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Appointment Type Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? "Edit Appointment Type" : "Add Appointment Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                maxLength={40}
                placeholder="e.g. Onboarding Call"
                value={typeForm.name}
                onChange={e => { setTypeForm(f => ({ ...f, name: e.target.value })); setTypeFormError(""); }}
                className={typeFormError ? "border-[#EF4444] focus-visible:ring-[#EF4444]" : ""}
              />
              {typeFormError && <p className="text-xs text-[#EF4444]">{typeFormError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setTypeForm(f => ({ ...f, color: c }))}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${typeForm.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Default Duration</Label>
              <Select value={String(typeForm.duration)} onValueChange={v => setTypeForm(f => ({ ...f, duration: Number(v) }))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATION_OPTIONS.map(d => <SelectItem key={d} value={String(d)}>{d} min</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={saveType} className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white">
              {editingType ? "Save Changes" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteType} onOpenChange={() => setDeleteType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Appointment Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteType?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-[#EF4444] hover:bg-[#EF4444]/90 text-white">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CalendarSettings;
