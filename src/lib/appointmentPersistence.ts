import { supabase } from "@/integrations/supabase/client";
import { localDateTimeToIso } from "@/lib/calendar/localDateTime";

export interface BookingPayload {
  title: string; start_time: string; end_time?: string | null; notes?: string | null;
  contact_id?: string | null; contact_name?: string; user_id?: string; type?: string; status?: string; sync_source?: string;
}

export function bookingTimes(date: string, start: string, end?: string): { start_time: string; end_time: string | null } {
  const start_time = localDateTimeToIso(date, start), end_time = end ? localDateTimeToIso(date, end) : null;
  if (!start_time || (end && !end_time) || (end_time && Date.parse(end_time) <= Date.parse(start_time))) throw new Error("Invalid appointment date or time — nothing was saved");
  return { start_time, end_time };
}

/** The draft owns this UUID until a confirmed save; a new intentional booking gets a new UUID. */
export async function persistAppointment(requestId: string, payload: BookingPayload) {
  if (!requestId) throw new Error("Booking identity missing. Reopen the appointment form.");
  const { data, error } = await (supabase as any).rpc("create_appointment_once", { p_request_id: requestId, p_appointment: payload });
  if (error) throw new Error(error.message);
  if (!data?.id || data.booking_request_id !== requestId) throw new Error("Appointment save was not confirmed. Retry with this form open.");
  return data;
}
