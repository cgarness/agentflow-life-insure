import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Bell, 
  Phone, 
  X, 
  ExternalLink, 
  Clock, 
  AlarmClock 
} from "lucide-react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCalendar, CalendarAppointment } from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

// Web Audio API chime generator (matching WinCelebration style)
function playReminderChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [440.00, 554.37, 659.25]; // A4, C#5, E5 (Major triad)
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.6);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.6);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (e) {
    console.warn("Audio not supported", e);
  }
}

const AGENT_REMINDER_TIME_KEY = "agent_reminder_time";
const AGENT_REMINDER_SOUND_KEY = "agent_reminder_sound";

const ReminderPopup: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { appointments } = useCalendar();
  
  const [leadTimeMinutes, setLeadTimeMinutes] = useState(10);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [activeReminders, setActiveReminders] = useState<CalendarAppointment[]>([]);
  const [currentReminder, setCurrentReminder] = useState<CalendarAppointment | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  
  // Track which appointments have been shown to avoid duplicates
  // Map of apptId -> timestamp of when it was shown/dismissed (or next snooze time)
  const reminderStateRef = useRef<Record<string, { shown: boolean, snoozeUntil: number | null }>>({});

  // Load preferences
  useEffect(() => {
    if (!user?.id) return;
    
    const loadPrefs = async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", user.id)
        .maybeSingle();
        
      if (data?.settings) {
        const settings = data.settings as any;
        if (settings[AGENT_REMINDER_TIME_KEY] !== undefined) {
          setLeadTimeMinutes(Number(settings[AGENT_REMINDER_TIME_KEY]));
        }
        if (settings[AGENT_REMINDER_SOUND_KEY] !== undefined) {
          setSoundEnabled(settings[AGENT_REMINDER_SOUND_KEY] === true || settings[AGENT_REMINDER_SOUND_KEY] === "true");
        }
      }
    };
    
    loadPrefs();
  }, [user?.id]);

  const checkReminders = useCallback(() => {
    const now = Date.now();
    const newReminders: CalendarAppointment[] = [];
    
    appointments.forEach(appt => {
      if (!appt.start_time) return;
      
      // Only remind for appointments belonging to the current user
      if (appt.user_id !== user?.id) return;
      
      const startTime = new Date(appt.start_time).getTime();
      const leadTimeMs = leadTimeMinutes * 60 * 1000;
      const triggerTime = startTime - leadTimeMs;
      
      const state = reminderStateRef.current[appt.id] || { shown: false, snoozeUntil: null };
      
      // Trigger if:
      // 1. Current time is past trigger time
      // 2. Appointment isn't in the past (allow 30 min buffer)
      // 3. Not shown yet OR snooze interval has passed
      const isPastTrigger = now >= triggerTime;
      const isTooOld = now > startTime + (30 * 60 * 1000);
      const readyForShow = !state.shown || (state.snoozeUntil && now >= state.snoozeUntil);
      
      if (isPastTrigger && !isTooOld && readyForShow) {
        newReminders.push(appt);
        // Mark as "about to be shown" to avoid multiple triggers before state updates
        reminderStateRef.current[appt.id] = { ...state, shown: true, snoozeUntil: null };
      }
    });
    
    if (newReminders.length > 0) {
      setActiveReminders(prev => [...prev, ...newReminders]);
      if (soundEnabled) {
        playReminderChime();
      }
    }
  }, [appointments, leadTimeMinutes, soundEnabled]);

  // Periodic check
  useEffect(() => {
    const timer = setInterval(checkReminders, 30000); // Check every 30 seconds
    // Initial check
    checkReminders();
    return () => clearInterval(timer);
  }, [checkReminders]);

  // Handle showing the next reminder in queue
  useEffect(() => {
    if (!currentReminder && activeReminders.length > 0) {
      setCurrentReminder(activeReminders[0]);
      setActiveReminders(prev => prev.slice(1));
      setIsOpen(true);
    }
  }, [activeReminders, currentReminder]);

  const handleDismiss = () => {
    setIsOpen(false);
    setTimeout(() => setCurrentReminder(null), 200);
  };

  const handleSnooze = () => {
    if (currentReminder) {
      // Snooze for 5 minutes
      const snoozeUntil = Date.now() + 5 * 60 * 1000;
      reminderStateRef.current[currentReminder.id] = { shown: true, snoozeUntil };
    }
    handleDismiss();
  };

  const handleCall = async () => {
    if (currentReminder?.contactId) {
      try {
        const { data, error } = await supabase
          .from("leads")
          .select("phone")
          .eq("id", currentReminder.contactId)
          .single();
          
        if (error) throw error;
        
        const event = new CustomEvent("quick-call", {
          detail: {
            phone: data?.phone || "",
            contactId: currentReminder.contactId,
            name: currentReminder.contactName
          }
        });
        window.dispatchEvent(event);
        handleDismiss();
      } catch (err) {
        console.error("Error fetching phone for call:", err);
        // Fallback: trigger with no phone but name/id
        const event = new CustomEvent("quick-call", {
          detail: {
            phone: "0000000000", // placeholder to trigger dialer open
            contactId: currentReminder.contactId,
            name: currentReminder.contactName
          }
        });
        window.dispatchEvent(event);
        handleDismiss();
      }
    }
  };

  const handleViewContact = () => {
    if (currentReminder?.contactId) {
      navigate(`/contacts?contact=${currentReminder.contactId}`);
      handleDismiss();
    }
  };

  if (!currentReminder) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-[425px] border-primary/20 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-primary animate-ring" />
            </div>
            <div>
              <DialogTitle className="text-xl">Appointment Reminder</DialogTitle>
              <DialogDescription>
                Starts in {Math.max(0, Math.round((new Date(currentReminder.start_time!).getTime() - Date.now()) / 60000))} minutes
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <div className="p-4 rounded-xl bg-accent/50 border border-border">
            <h4 className="font-bold text-foreground text-lg">{currentReminder.title}</h4>
            <div className="flex flex-col gap-2 mt-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                <span className="font-medium text-foreground">{currentReminder.contactName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{currentReminder.startTime} - {currentReminder.endTime}</span>
              </div>
              {currentReminder.notes && (
                <div className="mt-2 text-sm text-muted-foreground bg-background/50 p-2 rounded italic">
                  "{currentReminder.notes}"
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-col sm:space-x-0">
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button 
              onClick={handleCall}
              className="bg-success hover:bg-success/90 text-white font-semibold"
            >
              <Phone className="w-4 h-4 mr-2" />
              Call Now
            </Button>
            <Button 
              variant="outline" 
              onClick={handleViewContact}
              className="border-primary/20 hover:bg-primary/5 text-primary"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              View Contact
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-2 w-full mt-2">
            <Button 
              variant="ghost" 
              onClick={handleSnooze}
              className="text-muted-foreground hover:text-foreground"
            >
              <AlarmClock className="w-4 h-4 mr-2" />
              Snooze (5m)
            </Button>
            <Button 
              variant="ghost" 
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4 mr-2" />
              Dismiss
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <style>{`
        @keyframes ring {
          0%, 100% { transform: rotate(0); }
          10%, 30%, 50%, 70%, 90% { transform: rotate(-10deg); }
          20%, 40%, 60%, 80% { transform: rotate(10deg); }
        }
        .animate-ring {
          animation: ring 1s ease-in-out infinite;
          transform-origin: top;
        }
      `}</style>
    </Dialog>
  );
};

const User = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export default ReminderPopup;
