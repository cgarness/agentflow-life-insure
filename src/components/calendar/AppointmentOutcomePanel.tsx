import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { canRecordAppointmentOutcome } from "@/lib/appointmentOutcomeGate";
import { AppointmentOutcomeError, OUTCOME_NOT_SAVED, recordAppointmentOutcome, type AppointmentOutcomeResult } from "@/lib/appointmentOutcome";

/**
 * Held / No show for a started, originally open slot (D4 §4). One request id per open of the panel; a replay of the
 * same request is a no-op on the server. Mounted by the AppointmentModal (a protected file: the mount awaits approval).
 */
export function AppointmentOutcomePanel({ appointment, onRecorded }: {
  appointment: { id: string; status: string | null; startTime: string | null };
  onRecorded: (result: AppointmentOutcomeResult) => void;
}) {
  const requestId = useRef<string>(crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canRecordAppointmentOutcome(appointment)) return null;
  const record = async (outcome: "held" | "no_show") => {
    setSending(true); setMessage(null);
    try {
      onRecorded(await recordAppointmentOutcome({ requestId: requestId.current, appointmentId: appointment.id,
                                                  expectedStart: appointment.startTime!, outcome }));
    } catch (error) {
      setMessage(error instanceof AppointmentOutcomeError ? error.message : OUTCOME_NOT_SAVED);
    } finally { setSending(false); }
  };
  return (
    <div className="space-y-1.5" aria-label="Appointment outcome">
      <p className="text-xs text-muted-foreground">Did this appointment happen?</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={sending} onClick={() => void record("held")}>Held</Button>
        <Button type="button" size="sm" variant="outline" disabled={sending} onClick={() => void record("no_show")}>No show</Button>
      </div>
      {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
