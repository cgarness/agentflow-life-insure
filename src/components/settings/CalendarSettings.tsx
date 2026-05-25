import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CalendarRange, List, LayoutGrid, Sun,
  Plus, Pencil, Trash2, Lock, Mail, MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { useAppointmentTypes } from "@/hooks/useAppointmentTypes";
import { AppointmentTypeRecord } from "@/lib/calendar/appointmentTypes";
import { appointmentTypeFormSchema } from "@/components/settings/calendar/appointmentTypeSchema";

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

const AGENT_REMINDER_TIME_OPTIONS = [
  { label: "At time of event", value: 0 },
  { label: "1 minute before", value: 1 },
  { label: "2 minutes before", value: 2 },
  { label: "5 minutes before", value: 5 },
  { label: "10 minutes before", value: 10 },
  { label: "15 minutes before", value: 15 },
  { label: "30 minutes before", value: 30 },
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
const AGENT_REMINDER_TIME_KEY = "agent_reminder_time";
const AGENT_REMINDER_SOUND_KEY = "agent_reminder_sound";

const CalendarSettings: React.FC = () => {
  const { user, profile } = useAuth();
  const { organizationId, isSuperAdmin } = useOrganization();
  const { registerDirty } = useUnsavedChanges();
  const canManageAppointmentTypes = profile?.role === "Admin" || isSuperAdmin === true;
  // Card 1 - Default View
  const [defaultView, setDefaultView] = useState("Month");
  // Card 2 - First Day
  const [firstDay, setFirstDay] = useState("Sunday");
  // Card 3 - Appointment Types (live from public.appointment_types)
  const { types: appointmentTypes, loading: appointmentTypesLoading, error: appointmentTypesError, reload: reloadAppointmentTypes } = useAppointmentTypes({ includeInactive: true });
  const visibleAppointmentTypes = useMemo(
    () => appointmentTypes.filter((t) => t.isActive),
    [appointmentTypes]
  );
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<AppointmentTypeRecord | null>(null);
  const [deactivateType, setDeactivateType] = useState<AppointmentTypeRecord | null>(null);
  const [typeForm, setTypeForm] = useState({ name: "", color: "#3B82F6", duration_minutes: 30 });
  const [typeFormError, setTypeFormError] = useState("");
  const [typeFormSaving, setTypeFormSaving] = useState(false);
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

  // Card 9 - Agent Reminders
  const [agentReminderTime, setAgentReminderTime] = useState(10);
  const [agentReminderSound, setAgentReminderSound] = useState(true);
  const [agentRemindersDirty, setAgentRemindersDirty] = useState(false);
  const [agentRemindersSaving, setAgentRemindersSaving] = useState(false);

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
      // 1. Fetch current settings to merge
      const { data: current } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", user.id)
        .maybeSingle();

      const newSettings = {
        ...(current?.settings as object || {}),
        [GOOGLE_SYNC_PREFERENCE_KEY]: nextSettings
      };

      const { error } = await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            settings: newSettings as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
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
            .select("settings")
            .eq("user_id", user.id)
            .maybeSingle(),
          invokeAuthedFunction("google-calendar-status"),
        ]);

        if (prefError) throw prefError;

        const settings = prefData?.settings as any;
        const saved = settings?.[GOOGLE_SYNC_PREFERENCE_KEY];
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

  useEffect(() => {
    const loadAgentReminderSettings = async () => {
      if (!user?.id) return;

      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("settings")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        const settings = data?.settings as any;
        if (settings) {
          if (settings[AGENT_REMINDER_TIME_KEY] !== undefined) {
            setAgentReminderTime(Number(settings[AGENT_REMINDER_TIME_KEY]));
          }
          if (settings[AGENT_REMINDER_SOUND_KEY] !== undefined) {
            setAgentReminderSound(settings[AGENT_REMINDER_SOUND_KEY] === true || settings[AGENT_REMINDER_SOUND_KEY] === "true");
          }
        }
      } catch (err) {
        console.error("Error loading agent reminder settings:", err);
      }
    };

    loadAgentReminderSettings();
  }, [user?.id]);

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

  // Card 3 handlers — appointment types persist in public.appointment_types.
  const openAddModal = () => {
    setTypeForm({ name: "", color: "#3B82F6", duration_minutes: 30 });
    setTypeFormError("");
    setEditingType(null);
    setAddModalOpen(true);
  };

  const openEditModal = (t: AppointmentTypeRecord) => {
    if (t.isLocked) return;
    setTypeForm({ name: t.name, color: t.color, duration_minutes: t.durationMinutes });
    setTypeFormError("");
    setEditingType(t);
    setAddModalOpen(true);
  };

  const friendlyDbError = (msg: string | undefined): string => {
    if (!msg) return "Please try again.";
    if (msg.includes("appointment_types_org_lower_name_active_unique") || msg.includes("duplicate key")) {
      return "An appointment type with this name already exists.";
    }
    return msg;
  };

  const saveType = async () => {
    if (!canManageAppointmentTypes || !organizationId) {
      toast({ title: "Not permitted", variant: "destructive" });
      return;
    }
    const parsed = appointmentTypeFormSchema.safeParse({
      name: typeForm.name,
      color: typeForm.color,
      duration_minutes: typeForm.duration_minutes,
    });
    if (!parsed.success) {
      setTypeFormError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setTypeFormSaving(true);
    try {
      if (editingType) {
        if (editingType.isLocked) {
          setTypeFormError("Locked defaults cannot be edited.");
          return;
        }
        const { error } = await supabase
          .from("appointment_types")
          .update({
            name: parsed.data.name,
            color: parsed.data.color,
            duration_minutes: parsed.data.duration_minutes,
          })
          .eq("id", editingType.id)
          .eq("organization_id", organizationId);
        if (error) {
          setTypeFormError(friendlyDbError(error.message));
          return;
        }
        toast({ title: "Appointment type updated", className: "bg-[#22C55E] text-white border-0" });
      } else {
        const nextSortOrder = appointmentTypes.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 10;
        const { error } = await supabase
          .from("appointment_types")
          .insert([{
            organization_id: organizationId,
            name: parsed.data.name,
            color: parsed.data.color,
            duration_minutes: parsed.data.duration_minutes,
            sort_order: nextSortOrder,
            is_default: false,
            is_locked: false,
            is_active: true,
            created_by: user?.id ?? null,
          }]);
        if (error) {
          setTypeFormError(friendlyDbError(error.message));
          return;
        }
        toast({ title: "Appointment type added", className: "bg-[#22C55E] text-white border-0" });
      }
      setAddModalOpen(false);
      await reloadAppointmentTypes();
    } finally {
      setTypeFormSaving(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateType || !canManageAppointmentTypes || !organizationId) return;
    if (deactivateType.isLocked) {
      toast({ title: "Locked defaults cannot be deactivated", variant: "destructive" });
      setDeactivateType(null);
      return;
    }
    const { error } = await supabase
      .from("appointment_types")
      .update({ is_active: false })
      .eq("id", deactivateType.id)
      .eq("organization_id", organizationId);
    if (error) {
      toast({ title: "Unable to deactivate", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Appointment type deactivated", className: "bg-[#22C55E] text-white border-0" });
      await reloadAppointmentTypes();
    }
    setDeactivateType(null);
  };

  // Card 7 handlers (working hours controls are disabled — persistence not yet built)
  const updateWorkingDay = (index: number, updates: Partial<WorkingDay>) => {
    setWorkingHours(prev => prev.map((d, i) => i === index ? { ...d, ...updates } : d));
    setWorkingHoursDirty(true);
  };

  const handleAgentRemindersSave = async () => {
    if (!user?.id) return;
    setAgentRemindersSaving(true);
    try {
      // 1. Fetch current settings to merge
      const { data: current } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", user.id)
        .maybeSingle();

      const newSettings = {
        ...(current?.settings as object || {}),
        [AGENT_REMINDER_TIME_KEY]: agentReminderTime,
        [AGENT_REMINDER_SOUND_KEY]: agentReminderSound
      };

      const { error } = await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            settings: newSettings as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;

      setAgentRemindersDirty(false);
      registerDirty("calendar-settings", false);
      toast({ title: "Reminder settings saved", className: "bg-[#22C55E] text-white border-0" });
    } catch (err) {
      console.error("Error saving agent reminders:", err);
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Unable to save settings", description: message, variant: "destructive" });
    } finally {
      setAgentRemindersSaving(false);
    }
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
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">Default Calendar View</CardTitle>
          <CardDescription>Choose the default view agents see when they open the calendar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {viewOptions.map(v => (
              <button
                key={v.label}
                disabled
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-not-allowed ${
                  defaultView === v.label
                    ? "border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <v.icon className="w-5 h-5" />
                <span className="text-sm font-medium">{v.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">Coming soon — this setting is not active yet.</p>
        </CardContent>
      </Card>

      {/* Card 2 — First Day of the Week */}
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">First Day of the Week</CardTitle>
          <CardDescription>Controls how the calendar grid is displayed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            {["Sunday", "Monday"].map(d => (
              <button
                key={d}
                disabled
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 cursor-not-allowed ${
                  firstDay === d
                    ? "border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span className="text-sm font-medium">{d}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">Coming soon — this setting is not active yet.</p>
        </CardContent>
      </Card>

      {/* Card 3 — Appointment Types */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Appointment Types</CardTitle>
            <CardDescription>Manage the types of appointments your team can schedule. Default types are locked and cannot be renamed or removed.</CardDescription>
          </div>
          {canManageAppointmentTypes && (
            <Button
              onClick={openAddModal}
              size="sm"
              className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white"
            >
              <Plus className="w-4 h-4 mr-1" /> Add Appointment Type
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {appointmentTypesError && (
            <p className="text-xs text-[#EF4444] mb-3">{appointmentTypesError}</p>
          )}
          {appointmentTypesLoading ? (
            <p className="text-sm text-muted-foreground">Loading appointment types...</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {visibleAppointmentTypes.map(t => {
                const canMutate = canManageAppointmentTypes && !t.isLocked;
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-sm font-medium text-foreground">{t.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{t.durationMinutes} min</span>
                      {t.isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Locked default" />}
                    </div>
                    {canMutate && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(t)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          aria-label="Edit appointment type"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeactivateType(t)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          aria-label="Deactivate appointment type"
                          title="Deactivate"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleAppointmentTypes.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No appointment types yet.
                </div>
              )}
            </div>
          )}
          {!canManageAppointmentTypes && (
            <p className="text-xs text-muted-foreground mt-3">Only Admins can add, edit, or deactivate appointment types.</p>
          )}
        </CardContent>
      </Card>

      {/* Card 4 — Scheduling Defaults */}
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">Scheduling Defaults</CardTitle>
          <CardDescription>Control default durations and buffer time between appointments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Buffer Time Between Appointments</Label>
            <p className="text-xs text-muted-foreground">Prevents back-to-back appointments from being scheduled without a break</p>
            <Select value={bufferTime} disabled>
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
                <Input type="number" min={1} max={50} value={maxAgent} disabled className="w-24" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Team Leader</Label>
                <Input type="number" min={1} max={50} value={maxTeamLead} disabled className="w-24" />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Coming soon — this setting is not active yet.</p>
          <div className="flex justify-end">
            <Button disabled className="bg-[#3B82F6]/50 text-white cursor-not-allowed">Save</Button>
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
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">Appointment Reminders</CardTitle>
          <CardDescription>Automatically remind contacts before their appointment</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg px-4 py-2.5 text-xs text-muted-foreground">
            Contact reminders are not active yet. Personal agent reminders are available below.
          </div>
          {/* Email */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <Label>Email Reminders</Label>
              </div>
              <Switch checked={emailReminder} disabled />
            </div>
          </div>
          <Separator />
          {/* SMS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <Label>SMS Reminders</Label>
              </div>
              <Switch checked={smsReminder} disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 7 — Appointment Confirmation */}
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">Appointment Confirmation</CardTitle>
          <CardDescription>Automatically send a confirmation to contacts when an appointment is created</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg px-4 py-2.5 text-xs text-muted-foreground">
            Confirmation emails and calendar color coding are not active yet.
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Send Confirmation Email on Appointment Created</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Contact receives an email confirmation immediately after an appointment is saved</p>
            </div>
            <Switch checked={sendConfirmation} disabled />
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
            <Switch checked={colorByAgent} disabled />
          </div>
        </CardContent>
      </Card>

      {/* Card 8 — Working Hours */}
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="text-base">Working Hours</CardTitle>
          <CardDescription>Set the days and times agents are available to be scheduled</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border divide-y">
            {workingHours.map((wh) => (
              <div key={wh.day} className="flex items-center gap-4 px-4 py-3">
                <span className="text-sm font-medium text-foreground w-28">{wh.day}</span>
                <Switch checked={wh.enabled} disabled />
                {wh.enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Select value={wh.start} disabled>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{TIME_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">to</span>
                    <Select value={wh.end} disabled>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{TIME_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Coming soon — this setting is not active yet.</p>
          <div className="flex justify-end">
            <Button disabled className="bg-[#3B82F6]/50 text-white cursor-not-allowed">Save</Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 9 — Personal Appointment Reminders */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Appointment Reminders</CardTitle>
          <CardDescription>Configure popups and alerts for your upcoming appointments and callbacks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Reminder Lead Time</Label>
                <p className="text-xs text-muted-foreground">How many minutes before an appointment should we show the popup?</p>
              </div>
              <Select 
                value={String(agentReminderTime)} 
                onValueChange={v => {
                  setAgentReminderTime(Number(v));
                  setAgentRemindersDirty(true);
                  registerDirty("calendar-settings", true);
                }}
              >
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGENT_REMINDER_TIME_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Separator />
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Sound Notification</Label>
                <p className="text-xs text-muted-foreground">Play a chime when the reminder popup appears</p>
              </div>
              <Switch 
                checked={agentReminderSound} 
                onCheckedChange={v => {
                  setAgentReminderSound(v);
                  setAgentRemindersDirty(true);
                  registerDirty("calendar-settings", true);
                }} 
              />
            </div>
          </div>
          
          <div className="flex justify-end">
            <Button
              onClick={handleAgentRemindersSave}
              disabled={!agentRemindersDirty || agentRemindersSaving}
              className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white"
            >
              {agentRemindersSaving ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</span>
              ) : "Save Settings"}
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
              <Select value={String(typeForm.duration_minutes)} onValueChange={v => setTypeForm(f => ({ ...f, duration_minutes: Number(v) }))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{DURATION_OPTIONS.map(d => <SelectItem key={d} value={String(d)}>{d} min</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)} disabled={typeFormSaving}>Cancel</Button>
            <Button onClick={saveType} disabled={typeFormSaving} className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white">
              {typeFormSaving ? "Saving..." : editingType ? "Save Changes" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivateType} onOpenChange={() => setDeactivateType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Appointment Type</AlertDialogTitle>
            <AlertDialogDescription>
              Deactivate "{deactivateType?.name}"? Existing appointments using this type are preserved, but it will no longer appear in the scheduling dropdown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} className="bg-[#EF4444] hover:bg-[#EF4444]/90 text-white">Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CalendarSettings;
