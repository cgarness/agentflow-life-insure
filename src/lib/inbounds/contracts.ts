import { z } from "zod";
export const INBOUNDS_ENABLED = import.meta.env.VITE_INBOUNDS_ROOM === "true";
export const ROOM_PATH = "/inbounds";
export const sessionSchema = z.object({
  session_id: z.string().uuid(),
  state: z.enum(["available", "paused", "offline"]),
  ready: z.boolean(),
  expires_at: z.string(),
});
export const callSchema = z.object({
  id: z.string().uuid(),
  contact_id: z.string().nullable(),
  contact_type: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  ended_at: z.string().nullable(),
  status: z.string().nullable(),
  duration: z.number().nullable(),
  voicemail_id: z.string().nullable(),
  created_at: z.string(),
});
export const roomSchema = z.object({
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  admin: z.boolean(),
  session: sessionSchema.nullable(),
  pending: callSchema.nullable(),
  presence: z.object({
    available: z.number(),
    busy: z.number(),
    paused: z.number(),
  }),
  stats: z.object({
    total: z.number(),
    answered: z.number(),
    missed: z.number(),
    voicemails: z.number(),
    pending: z.number(),
  }),
  outcomes: z.array(
    z.object({ id: z.string(), name: z.string(), count: z.number() }),
  ),
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      answered: z.number(),
      dispositioned: z.number(),
    }),
  ),
  missed: z.array(callSchema),
  voicemail_calls: z.array(callSchema),
});
export type RoomSnapshot = z.infer<typeof roomSchema>;
export type RoomCall = z.infer<typeof callSchema>;
export const wrapSchema = z.object({
  dispositionId: z.string().uuid("Select a disposition"),
  notes: z.string().max(10000),
  dueAt: z.string(),
});
export function localDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
export function canReceive(
  snapshot: RoomSnapshot | null,
  ready: boolean,
  callState: string,
) {
  return (
    !!snapshot &&
    ready &&
    snapshot.session?.state === "available" &&
    !snapshot.pending &&
    callState === "idle"
  );
}
/** A callback an automation opened for a missed inbound call. At most one exists per call. */
export const callbackSchema = z.object({
  id: z.string().uuid(),
  call_id: z.string().uuid(),
  caller_phone: z.string().nullable(),
  contact_id: z.string().nullable(),
  contact_type: z.enum(["lead", "client", "recruit"]).nullable(),
  contact_name: z.string().nullable(),
  status: z.enum(["open", "claimed"]),
  claimed_by: z.string().nullable(),
  claimed_by_name: z.string().nullable(),
  claimed_by_me: z.boolean(),
  can_claim: z.boolean(),
  missed_at: z.string(),
  due_at: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  voicemail_id: z.string().nullable(),
});
/** The list as the server orders it (open first, due soonest at the top), with counts that cover every waiting callback. */
export const callbackQueueSchema = z.object({
  admin: z.boolean(),
  /** False outside the Automations pilot: the agency has no callback list. */
  available: z.boolean(),
  open_count: z.number().int().nonnegative(),
  claimed_count: z.number().int().nonnegative(),
  items: z.array(callbackSchema),
});
export type InboundCallback = z.infer<typeof callbackSchema>;
export type CallbackQueue = z.infer<typeof callbackQueueSchema>;
